import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db";
import { authenticate, AuthError, createNonce, verifySignin, type AuthConfig } from "./auth";
import { canonicalJson, digestOf } from "./canonical";
import { signUrl, verifyUrl } from "./sign";
import type { Approval, MetaStore, StoredDocument } from "./store";

export interface FacilityRoles {
  originator: string;
  riskAgent: string;
  evidenceHash: string;
}

export interface ChainReader {
  facility(chainId: number, address: string): Promise<FacilityRoles>;
}

export interface MetaDeps {
  store: MetaStore;
  chain: ChainReader;
  db: Db;
  auth: AuthConfig;
  secret: Uint8Array;
  documentsDir: string;
  maxFileBytes: number;
}

class MetaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const JSON_LIMIT = 100_000;
const LINK_TTL = 300;
const MAGIC: Record<string, (bytes: Uint8Array) => boolean> = {
  "application/pdf": (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  "image/png": (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
const DRAFT_TEXT: Record<string, number> = { company: 120, route: 120, financingType: 60 };
const DRAFT_NUMBER: Record<string, [number, number]> = {
  operatingHistoryYears: [0, 100],
  verifiedAssets: [0, 1_000_000],
  buyerConcentrationPct: [0, 100],
  documentCoverage: [0, 100],
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > JSON_LIMIT) throw new MetaError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MetaError(400, "INVALID_REQUEST", "The request body must be JSON.");
  }
  if (!isObject(parsed)) throw new MetaError(400, "INVALID_REQUEST", "The request body must be a JSON object.");
  return parsed;
}

function parseDraft(body: Record<string, unknown>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (!(key in DRAFT_TEXT) && !(key in DRAFT_NUMBER)) throw new MetaError(400, "INVALID_REQUEST", `Unknown field ${key}.`);
  }
  for (const [key, max] of Object.entries(DRAFT_TEXT)) {
    const value = body[key];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new MetaError(400, "INVALID_REQUEST", `${key} must be a non-empty string of at most ${max} characters.`);
    content[key] = value.trim();
  }
  for (const [key, [min, max]] of Object.entries(DRAFT_NUMBER)) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new MetaError(400, "INVALID_REQUEST", `${key} must be a number between ${min} and ${max}.`);
    content[key] = value;
  }
  return content;
}

function cleanName(name: unknown): string {
  if (typeof name !== "string") throw new MetaError(400, "INVALID_REQUEST", "name is required.");
  const base = name.split(/[\\/]/).pop()!.replace(/[^\w.\- ]/g, "_").trim();
  if (base.length === 0 || base.length > 120) throw new MetaError(400, "INVALID_REQUEST", "name must be 1 to 120 characters.");
  return base;
}

export function createMetaRoutes(deps: MetaDeps) {
  const { store, chain, db, auth, secret } = deps;
  const now = () => auth.now();

  async function rolesOf(chainId: number, facility: string): Promise<FacilityRoles> {
    try {
      const roles = await chain.facility(chainId, facility);
      return { originator: roles.originator.toLowerCase(), riskAgent: roles.riskAgent.toLowerCase(), evidenceHash: roles.evidenceHash.toLowerCase() };
    } catch (error) {
      throw new MetaError(503, "METADATA_UNAVAILABLE", `The facility could not be read from the chain: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  function facilityOf(chainId: string, address: string) {
    const id = Number(chainId);
    if (!auth.chains.includes(id)) throw new MetaError(404, "UNSUPPORTED_CHAIN", `Chain ${chainId} is not supported.`);
    const facility = address.toLowerCase();
    if (db.events({ chainId: id, facility }).length === 0) throw new MetaError(404, "FACILITY_NOT_FOUND", `No facility ${facility} on chain ${id}.`);
    return { chainId: id, facility };
  }

  function session(request: Request): string {
    const address = authenticate(store, auth, request.headers.get("authorization"));
    if (!address) throw new MetaError(401, "UNAUTHENTICATED", "Sign in first.");
    return address;
  }

  const viewer = (request: Request) => authenticate(store, auth, request.headers.get("authorization"));

  async function originatorOnly(request: Request, chainId: number, facility: string) {
    const address = session(request);
    const roles = await rolesOf(chainId, facility);
    if (address !== roles.originator) throw new MetaError(403, "FORBIDDEN", "Only the facility originator may do this.");
    return { address, roles };
  }

  function documentUrl(document: StoredDocument) {
    const link = signUrl(secret, "download", document.id, now(), LINK_TTL);
    return `/v1/downloads/${document.id}?exp=${link.exp}&sig=${link.sig}`;
  }

  function present(approval: Approval, roles: FacilityRoles) {
    const content = JSON.parse(approval.canonical) as { metadata: unknown; underwriting: unknown };
    return {
      schemaVersion: 1,
      chainId: approval.chainId,
      facility: approval.facility,
      status: "approved",
      version: approval.version,
      approvalId: approval.id,
      reviewer: approval.reviewer,
      approvedAt: approval.createdAt,
      digest: approval.digest,
      anchored: roles.evidenceHash === approval.digest.toLowerCase(),
      onchainEvidenceHash: roles.evidenceHash,
      metadata: content.metadata,
      underwriting: content.underwriting,
    };
  }

  async function handle(request: Request, url: URL): Promise<Response | null> {
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;

    if (path === "/v1/auth/nonce" && method === "POST") {
      const body = await readJson(request);
      const issued = createNonce(store, auth, { address: String(body.address ?? ""), chainId: Number(body.chainId) });
      return reply({ schemaVersion: 1, nonce: issued.nonce, expiresAt: issued.expiresAt, message: issued.message });
    }
    if (path === "/v1/auth/verify" && method === "POST") {
      const body = await readJson(request);
      const opened = await verifySignin(store, auth, { message: String(body.message ?? ""), signature: String(body.signature ?? "") });
      return reply({ schemaVersion: 1, ...opened });
    }

    const upload = path.match(/^\/v1\/uploads\/([0-9a-f]{32})$/);
    if (upload && method === "PUT") {
      if (!verifyUrl(secret, "upload", upload[1], url.searchParams.get("exp"), url.searchParams.get("sig"), now())) throw new MetaError(403, "INVALID_SIGNATURE", "The upload link is invalid or expired.");
      const document = store.document(upload[1]);
      if (!document) throw new MetaError(404, "DOCUMENT_NOT_FOUND", "Unknown document.");
      if (document.status !== "pending") throw new MetaError(409, "ALREADY_STORED", "This upload slot was already used.");
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > deps.maxFileBytes) throw new MetaError(413, "PAYLOAD_TOO_LARGE", "The file is too large.");
      if (bytes.length !== document.size) throw new MetaError(400, "SIZE_MISMATCH", "The file size differs from the declared size.");
      if (!MAGIC[document.mime]?.(bytes)) throw new MetaError(400, "TYPE_MISMATCH", "The file content does not match the declared type.");
      const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
      const folder = join(deps.documentsDir, String(document.chainId), document.facility);
      mkdirSync(folder, { recursive: true });
      const target = join(folder, document.id);
      await Bun.write(target, bytes);
      const stored = store.markStored(document.id, { sha256, path: target });
      return reply({ schemaVersion: 1, id: stored.id, sha256, size: stored.size, version: stored.version }, 201);
    }

    const download = path.match(/^\/v1\/downloads\/([0-9a-f]{32})$/);
    if (download && method === "GET") {
      if (!verifyUrl(secret, "download", download[1], url.searchParams.get("exp"), url.searchParams.get("sig"), now())) throw new MetaError(403, "INVALID_SIGNATURE", "The download link is invalid or expired.");
      const document = store.document(download[1]);
      if (!document || document.status !== "stored" || !document.path) throw new MetaError(404, "DOCUMENT_NOT_FOUND", "Unknown document.");
      return new Response(Bun.file(document.path), { headers: { "content-type": document.mime, "content-disposition": `inline; filename="${document.name}"`, "cache-control": "private, max-age=60", "x-content-type-options": "nosniff" } });
    }

    const scoped = path.match(/^\/v1\/facilities\/(\d+)\/(0x[0-9a-fA-F]{40})\/(metadata\/versions|underwriting\/approve|metadata|documents\/upload-url|documents)$/);
    if (!scoped) return null;
    const target = scoped[3];
    const isRead = method === "GET" && (target === "metadata" || target === "documents");
    const isWrite = method === "POST" && (target === "metadata/versions" || target === "underwriting/approve" || target === "documents/upload-url");
    if (!isRead && !isWrite) throw new MetaError(405, "METHOD_NOT_ALLOWED", "Method not allowed for this route.");
    const { chainId, facility } = facilityOf(scoped[1], scoped[2]);

    if (target === "metadata/versions") {
      const { address } = await originatorOnly(request, chainId, facility);
      const content = parseDraft(await readJson(request));
      const created = store.addDraft({ chainId, facility, author: address, content, createdAt: iso(now()) });
      return reply({ schemaVersion: 1, chainId, facility, version: created.version, author: created.author, createdAt: created.createdAt }, 201);
    }

    if (target === "underwriting/approve") {
      const address = session(request);
      const roles = await rolesOf(chainId, facility);
      if (address !== roles.riskAgent) throw new MetaError(403, "FORBIDDEN", "Only the reviewer may approve underwriting.");
      const body = await readJson(request);
      const version = body.version;
      const grade = body.grade;
      const note = body.note ?? "";
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new MetaError(400, "INVALID_REQUEST", "version must be a positive integer.");
      if (typeof grade !== "string" || !/^[A-E][+-]?$/.test(grade)) throw new MetaError(400, "INVALID_REQUEST", "grade must be A to E with an optional + or -.");
      if (typeof note !== "string" || note.length > 500) throw new MetaError(400, "INVALID_REQUEST", "note must be at most 500 characters.");
      const draft = store.draft(chainId, facility, version);
      if (!draft) throw new MetaError(404, "VERSION_NOT_FOUND", `No draft version ${version}.`);
      const content = { schemaVersion: 1, chainId, facility, version, metadata: draft.content, underwriting: { grade, note, reviewedAt: iso(now()) }, reviewer: address };
      const created = store.addApproval({ chainId, facility, version, reviewer: address, canonical: canonicalJson(content), digest: digestOf(content), grade, createdAt: iso(now()) });
      return reply({ schemaVersion: 1, id: created.id, version, reviewer: address, grade, digest: created.digest, canonical: created.canonical, createdAt: created.createdAt }, 201);
    }

    if (target === "metadata") {
      const approval = store.latestApproval(chainId, facility);
      if (!approval) throw new MetaError(404, "METADATA_NOT_FOUND", "No approved underwriting record for this facility.");
      return reply(present(approval, await rolesOf(chainId, facility)));
    }

    if (target === "documents/upload-url") {
      await originatorOnly(request, chainId, facility);
      const body = await readJson(request);
      const name = cleanName(body.name);
      if (typeof body.mime !== "string" || !(body.mime in MAGIC)) throw new MetaError(400, "UNSUPPORTED_TYPE", "Only pdf, png, and jpeg files are accepted.");
      if (body.visibility !== "public" && body.visibility !== "restricted") throw new MetaError(400, "INVALID_REQUEST", "visibility must be public or restricted.");
      if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 1) throw new MetaError(400, "INVALID_REQUEST", "size must be a positive integer.");
      if (body.size > deps.maxFileBytes) throw new MetaError(413, "PAYLOAD_TOO_LARGE", `Files may be at most ${deps.maxFileBytes} bytes.`);
      const id = randomBytes(16).toString("hex");
      const address = session(request);
      store.addDocument({ id, chainId, facility, name, mime: body.mime, size: body.size, visibility: body.visibility, uploader: address, createdAt: iso(now()) });
      const link = signUrl(secret, "upload", id, now(), LINK_TTL);
      return reply({ schemaVersion: 1, documentId: id, uploadUrl: `/v1/uploads/${id}?exp=${link.exp}&sig=${link.sig}`, expiresAt: link.exp });
    }

    const documents = store.documents(chainId, facility);
    const address = viewer(request);
    let privileged = false;
    if (address && documents.some((document) => document.visibility === "restricted")) {
      const roles = await rolesOf(chainId, facility);
      privileged = address === roles.originator || address === roles.riskAgent || db.events({ chainId, facility, account: address }).length > 0;
    }
    const items = documents.map((document) => ({
      id: document.id,
      name: document.name,
      mime: document.mime,
      size: document.size,
      sha256: document.sha256,
      version: document.version,
      visibility: document.visibility,
      restricted: document.visibility === "restricted",
      uploadedAt: document.createdAt,
      url: document.visibility === "public" || privileged ? documentUrl(document) : null,
    }));
    return reply({ schemaVersion: 1, chainId, facility, manifestVersion: documents.length, items });
  }

  return async (request: Request, url: URL): Promise<Response | null> => {
    try {
      return await handle(request, url);
    } catch (error) {
      if (error instanceof MetaError) return reply({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof AuthError) return reply({ error: { code: error.code, message: error.message } }, error.code === "INVALID_REQUEST" || error.code === "UNSUPPORTED_CHAIN" ? 400 : 401);
      return reply({ error: { code: "INTERNAL", message: "Unexpected error." } }, 500);
    }
  };
}
