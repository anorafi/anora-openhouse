import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openDb, type Db } from "../db";
import { normalizeLog, type IndexedEvent } from "../events";
import { makeLog } from "../testing";
import type { AuthConfig } from "./auth";
import { digestOf } from "./canonical";
import { createMetaRoutes, type ChainReader, type FacilityRoles } from "./service";
import { openMetaStore, type MetaStore } from "./store";

const FACTORY = "0x9F356D8eEf33a04F2F0628B80441D3Ed8Ebd4B52";
const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const CHAIN = 421614;
const originator = privateKeyToAccount(generatePrivateKey());
const reviewer = privateKeyToAccount(generatePrivateKey());
const provider = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const ZERO = `0x${"0".repeat(64)}`;

let store: MetaStore;
let db: Db;
let roles: FacilityRoles;
let time: number;
let dir: string;
let routes: (request: Request, url: URL) => Promise<Response | null>;

const auth = (): AuthConfig => ({ domain: "openhouse.anora.finance", chains: [CHAIN], now: () => time, nonceTtl: 300, sessionTtl: 3600 });
const chain: ChainReader = { facility: async (_chainId, address) => (address.toLowerCase() === FACILITY.toLowerCase() ? roles : Promise.reject(new Error("no such facility"))) };

const ev = (name: string, args: Record<string, unknown>, address: string, blockNumber: number): IndexedEvent => ({
  ...normalizeLog(CHAIN, makeLog(name, args, { address, blockNumber }))!,
  observedAt: "2026-09-30T00:00:00.000Z",
});

const send = async (path: string, init: RequestInit = {}) => {
  const url = new URL(`http://127.0.0.1:8105${path}`);
  const response = await routes(new Request(url, init), url);
  if (!response) throw new Error(`unrouted ${path}`);
  return response;
};
const json = async (response: Response) => (await response.json()) as Record<string, any>;
const post = (path: string, body: unknown, token?: string) =>
  send(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

async function login(account: typeof originator): Promise<string> {
  const nonce = await json(await post("/v1/auth/nonce", { address: account.address, chainId: CHAIN }));
  const signature = await account.signMessage({ message: nonce.message });
  const session = await json(await post("/v1/auth/verify", { message: nonce.message, signature }));
  return session.token;
}

const F = `/v1/facilities/${CHAIN}/${FACILITY}`;
const draft = { company: "PT Nusantara Teh Lestari", route: "Indonesia to Singapore", financingType: "Export receivables", operatingHistoryYears: 9, verifiedAssets: 22, buyerConcentrationPct: 46, documentCoverage: 1.18 };
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(() => {
  store = openMetaStore(":memory:");
  db = openDb(":memory:");
  db.upsertEvents([
    ev("FacilityCreated", { facility: FACILITY, originator: originator.address, name: "Rice 01", limit: 10_000_000n, firstLoss: 3_000_000n }, FACTORY, 100),
    ev("Deposited", { provider: provider.address, tranche: 0, assets: 6_000_000n, shares: 6_000_000n }, FACILITY, 101),
  ]);
  roles = { originator: originator.address.toLowerCase(), riskAgent: reviewer.address.toLowerCase(), evidenceHash: ZERO };
  time = 1_800_000_000;
  const base = join(process.env.HOME!, ".cache/claude-work");
  mkdirSync(base, { recursive: true });
  dir = mkdtempSync(join(base, "meta-test-"));
  routes = createMetaRoutes({ store, chain, db, auth: auth(), secret: new Uint8Array(32).fill(3), documentsDir: dir, maxFileBytes: 1024 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sign-in routes", () => {
  test("issue a session for a valid signature and reject a bad one", async () => {
    expect(await login(originator)).toMatch(/^[0-9a-f]{64}$/);
    const nonce = await json(await post("/v1/auth/nonce", { address: originator.address, chainId: CHAIN }));
    const bad = await post("/v1/auth/verify", { message: nonce.message, signature: await stranger.signMessage({ message: nonce.message }) });
    expect(bad.status).toBe(401);
    expect((await json(bad)).error.code).toBe("INVALID_SIGNATURE");
  });
});

describe("metadata versions", () => {
  test("only the facility originator may add a draft", async () => {
    const anonymous = await post(`${F}/metadata/versions`, draft);
    expect(anonymous.status).toBe(401);
    const forbidden = await post(`${F}/metadata/versions`, draft, await login(stranger));
    expect(forbidden.status).toBe(403);
    expect((await json(forbidden)).error.code).toBe("FORBIDDEN");
    const created = await post(`${F}/metadata/versions`, draft, await login(originator));
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({ version: 1, author: originator.address.toLowerCase() });
  });

  test("rejects drafts with missing or out of range fields", async () => {
    const token = await login(originator);
    expect((await post(`${F}/metadata/versions`, { ...draft, company: "" }, token)).status).toBe(400);
    expect((await post(`${F}/metadata/versions`, { ...draft, buyerConcentrationPct: 140 }, token)).status).toBe(400);
    expect((await post(`${F}/metadata/versions`, { ...draft, surprise: "x" }, token)).status).toBe(400);
  });

  test("answers 404 for a facility the indexer does not know", async () => {
    const token = await login(originator);
    const other = await post(`/v1/facilities/${CHAIN}/0x0000000000000000000000000000000000000001/metadata/versions`, draft, token);
    expect(other.status).toBe(404);
  });
});

describe("underwriting approval", () => {
  test("only the risk agent may approve, and an approval needs an existing draft", async () => {
    const owner = await login(originator);
    await post(`${F}/metadata/versions`, draft, owner);
    expect((await post(`${F}/underwriting/approve`, { version: 1, grade: "A", note: "ok" }, owner)).status).toBe(403);
    const review = await login(reviewer);
    expect((await post(`${F}/underwriting/approve`, { version: 9, grade: "A", note: "ok" }, review)).status).toBe(404);
    expect((await post(`${F}/underwriting/approve`, { version: 1, grade: "Z", note: "ok" }, review)).status).toBe(400);
    const approved = await post(`${F}/underwriting/approve`, { version: 1, grade: "A", note: "ok" }, review);
    expect(approved.status).toBe(201);
    const body = await json(approved);
    expect(body.digest).toBe(digestOf(JSON.parse(body.canonical)));
    expect(JSON.parse(body.canonical)).toMatchObject({ version: 1, reviewer: reviewer.address.toLowerCase(), metadata: draft, underwriting: { grade: "A", note: "ok" } });
  });

  test("the public read has no record before approval, then shows digest and anchoring", async () => {
    expect((await send(`${F}/metadata`)).status).toBe(404);
    const owner = await login(originator);
    await post(`${F}/metadata/versions`, draft, owner);
    const review = await login(reviewer);
    const approved = await json(await post(`${F}/underwriting/approve`, { version: 1, grade: "A", note: "ok" }, review));

    const notAnchored = await json(await send(`${F}/metadata`));
    expect(notAnchored).toMatchObject({ status: "approved", digest: approved.digest, anchored: false, version: 1, reviewer: reviewer.address.toLowerCase() });
    expect(notAnchored.metadata).toEqual(draft);
    expect(notAnchored.underwriting.grade).toBe("A");

    roles = { ...roles, evidenceHash: approved.digest };
    expect((await json(await send(`${F}/metadata`))).anchored).toBe(true);
  });

  test("a later approval becomes the latest and unanchors, while the first version stays intact", async () => {
    const owner = await login(originator);
    const review = await login(reviewer);
    await post(`${F}/metadata/versions`, draft, owner);
    const first = await json(await post(`${F}/underwriting/approve`, { version: 1, grade: "A", note: "ok" }, review));
    roles = { ...roles, evidenceHash: first.digest };
    await post(`${F}/metadata/versions`, { ...draft, verifiedAssets: 30 }, owner);
    const second = await json(await post(`${F}/underwriting/approve`, { version: 2, grade: "B", note: "changed" }, review));
    const latest = await json(await send(`${F}/metadata`));
    expect(latest).toMatchObject({ version: 2, digest: second.digest, anchored: false });
    expect(store.draft(CHAIN, FACILITY.toLowerCase(), 1)?.content).toEqual(draft);
    expect(store.approvals(CHAIN, FACILITY.toLowerCase())).toHaveLength(2);
  });

  test("reports an explicit error when the chain cannot be read", async () => {
    const owner = await login(originator);
    const review = await login(reviewer);
    await post(`${F}/metadata/versions`, draft, owner);
    await post(`${F}/underwriting/approve`, { version: 1, grade: "A", note: "ok" }, review);
    roles = undefined as never;
    const failing = createMetaRoutes({ store, chain: { facility: async () => Promise.reject(new Error("rpc down")) }, db, auth: auth(), secret: new Uint8Array(32).fill(3), documentsDir: dir, maxFileBytes: 1024 });
    const url = new URL(`http://127.0.0.1:8105${F}/metadata`);
    const response = (await failing(new Request(url), url))!;
    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("METADATA_UNAVAILABLE");
  });
});

const requestUpload = (token: string, body: Record<string, unknown>) => post(`${F}/documents/upload-url`, body, token);

describe("documents", () => {
  test("stores an upload, hashes it, and lists it in a versioned manifest", async () => {
    const owner = await login(originator);
    const slot = await json(await requestUpload(owner, { name: "invoice.pdf", mime: "application/pdf", size: pdf.length, visibility: "public" }));
    expect(slot.uploadUrl).toContain("/v1/uploads/");
    const stored = await send(slot.uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: pdf });
    expect(stored.status).toBe(201);
    const sha = new Bun.CryptoHasher("sha256").update(pdf).digest("hex");
    expect(await json(stored)).toMatchObject({ sha256: sha, version: 1 });

    const listed = await json(await send(`${F}/documents`));
    expect(listed.manifestVersion).toBe(1);
    expect(listed.items[0]).toMatchObject({ name: "invoice.pdf", sha256: sha, visibility: "public", restricted: false });
    const download = await send(listed.items[0].url);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(pdf);
  });

  test("only the originator may request an upload slot, and only for allowed types and sizes", async () => {
    expect((await requestUpload(await login(stranger), { name: "a.pdf", mime: "application/pdf", size: 5, visibility: "public" })).status).toBe(403);
    const owner = await login(originator);
    expect((await requestUpload(owner, { name: "a.exe", mime: "application/x-msdownload", size: 5, visibility: "public" })).status).toBe(400);
    expect((await requestUpload(owner, { name: "a.pdf", mime: "application/pdf", size: 5000, visibility: "public" })).status).toBe(413);
    expect((await requestUpload(owner, { name: "a.pdf", mime: "application/pdf", size: 5, visibility: "secret" })).status).toBe(400);
  });

  test("rejects an upload whose bytes do not match the declared type or size", async () => {
    const owner = await login(originator);
    const slot = await json(await requestUpload(owner, { name: "a.pdf", mime: "application/pdf", size: png.length, visibility: "public" }));
    expect((await send(slot.uploadUrl, { method: "PUT", body: png })).status).toBe(400);
    const wrongSize = await json(await requestUpload(owner, { name: "b.pdf", mime: "application/pdf", size: 3, visibility: "public" }));
    expect((await send(wrongSize.uploadUrl, { method: "PUT", body: pdf })).status).toBe(400);
  });

  test("rejects a tampered or expired upload url and a second upload into the same slot", async () => {
    const owner = await login(originator);
    const slot = await json(await requestUpload(owner, { name: "a.pdf", mime: "application/pdf", size: pdf.length, visibility: "public" }));
    expect((await send(slot.uploadUrl.replace(/sig=[0-9a-f]/, "sig=0"), { method: "PUT", body: pdf })).status).toBe(403);
    expect((await send(slot.uploadUrl, { method: "PUT", body: pdf })).status).toBe(201);
    expect((await send(slot.uploadUrl, { method: "PUT", body: pdf })).status).toBe(409);
    const late = await json(await requestUpload(owner, { name: "c.pdf", mime: "application/pdf", size: pdf.length, visibility: "public" }));
    time += 1000;
    expect((await send(late.uploadUrl, { method: "PUT", body: pdf })).status).toBe(403);
  });

  test("hides restricted documents from anonymous readers and reveals them to participants", async () => {
    const owner = await login(originator);
    for (const [name, visibility] of [["open.pdf", "public"], ["closed.png", "restricted"]] as const) {
      const slot = await json(await requestUpload(owner, { name, mime: name.endsWith("png") ? "image/png" : "application/pdf", size: name.endsWith("png") ? png.length : pdf.length, visibility }));
      await send(slot.uploadUrl, { method: "PUT", body: name.endsWith("png") ? png : pdf });
    }
    const anonymous = await json(await send(`${F}/documents`));
    expect(anonymous.manifestVersion).toBe(2);
    expect(anonymous.items.find((item: any) => item.name === "closed.png")).toMatchObject({ restricted: true, url: null });
    expect(anonymous.items.find((item: any) => item.name === "open.pdf").url).toBeTruthy();

    for (const account of [originator, reviewer, provider]) {
      const seen = await json(await send(`${F}/documents`, { headers: { authorization: `Bearer ${await login(account)}` } }));
      expect(seen.items.find((item: any) => item.name === "closed.png").url).toBeTruthy();
    }
    const outsider = await json(await send(`${F}/documents`, { headers: { authorization: `Bearer ${await login(stranger)}` } }));
    expect(outsider.items.find((item: any) => item.name === "closed.png").url).toBeNull();
  });

  test("refuses a download with a bad or expired signature", async () => {
    const owner = await login(originator);
    const slot = await json(await requestUpload(owner, { name: "a.pdf", mime: "application/pdf", size: pdf.length, visibility: "public" }));
    await send(slot.uploadUrl, { method: "PUT", body: pdf });
    const listed = await json(await send(`${F}/documents`));
    const url: string = listed.items[0].url;
    const tampered = url.replace(/sig=([0-9a-f])/, (_, first: string) => `sig=${first === "0" ? "1" : "0"}`);
    expect(tampered).not.toBe(url);
    expect((await send(tampered)).status).toBe(403);
    time += 1000;
    expect((await send(url)).status).toBe(403);
  });
});

describe("routing", () => {
  test("leaves unrelated paths to the rest of the api", async () => {
    const url = new URL("http://127.0.0.1:8105/v1/health");
    expect(await routes(new Request(url), url)).toBeNull();
  });
});
