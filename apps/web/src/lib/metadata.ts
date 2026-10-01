export class MetadataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MetadataError";
  }
}

export interface UnderwritingRecord {
  status: "approved";
  version: number;
  digest: string;
  anchored: boolean;
  reviewer: string;
  approvedAt: string;
  metadata: {
    company: string;
    route: string;
    financingType: string;
    operatingHistoryYears?: number;
    verifiedAssets?: number;
    buyerConcentrationPct?: number;
    documentCoverage?: number;
  };
  underwriting: { grade: string; note: string; reviewedAt: string };
}

export type MetadataState = { kind: "none" } | { kind: "record"; record: UnderwritingRecord };

export interface DocumentItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  version: number;
  visibility: "public" | "restricted";
  restricted: boolean;
  url: string | null;
}

export interface DocumentRow {
  title: string;
  detail: string;
  badge: "Public" | "Restricted";
  href: string | null;
  signIn: boolean;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function read(fetcher: Fetcher, url: string, init?: RequestInit): Promise<{ response: Response; body: Record<string, any> }> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    throw new MetadataError("METADATA_UNAVAILABLE", (error as Error).message);
  }
  const body = ((await response.json().catch(() => null)) ?? {}) as Record<string, any>;
  return { response, body };
}

function fail(response: Response, body: Record<string, any>): never {
  throw new MetadataError(body.error?.code ?? "METADATA_UNAVAILABLE", body.error?.message ?? `The metadata service answered HTTP ${response.status}.`);
}

export async function fetchMetadata(fetcher: Fetcher, api: string, chainId: number, facility: string): Promise<MetadataState> {
  const { response, body } = await read(fetcher, `${api}/v1/facilities/${chainId}/${facility}/metadata`);
  if (response.status === 404 && (body.error?.code === "METADATA_NOT_FOUND" || body.error?.code === "NOT_FOUND")) return { kind: "none" };
  if (!response.ok || body.error) fail(response, body);
  return { kind: "record", record: body as UnderwritingRecord };
}

export async function fetchDocuments(fetcher: Fetcher, api: string, chainId: number, facility: string, token?: string): Promise<{ manifestVersion: number; items: DocumentItem[] }> {
  const { response, body } = await read(fetcher, `${api}/v1/facilities/${chainId}/${facility}/documents`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  if (!response.ok || body.error) fail(response, body);
  return { manifestVersion: body.manifestVersion ?? 0, items: body.items ?? [] };
}

export async function signIn(fetcher: Fetcher, api: string, request: { address: string; chainId: number; sign: (message: string) => Promise<string> }): Promise<string> {
  const post = (path: string, payload: unknown) => read(fetcher, `${api}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const nonce = await post("/v1/auth/nonce", { address: request.address, chainId: request.chainId });
  if (!nonce.response.ok || nonce.body.error) fail(nonce.response, nonce.body);
  const signature = await request.sign(nonce.body.message);
  const opened = await post("/v1/auth/verify", { message: nonce.body.message, signature });
  if (!opened.response.ok || opened.body.error) fail(opened.response, opened.body);
  return opened.body.token;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function reviewLabel(state: MetadataState): { sample: boolean; text: string } {
  if (state.kind === "none") return { sample: true, text: "Sample data · no approved underwriting record" };
  if (state.record.anchored) return { sample: false, text: `Approved by reviewer ${short(state.record.reviewer)}, digest matches onchain` };
  return { sample: false, text: "Approved, not yet anchored onchain" };
}

export function documentRows(items: DocumentItem[], api: string): DocumentRow[] {
  return items.map((item) => ({
    title: item.name,
    detail: `v${item.version} · sha256 ${item.sha256.slice(0, 12)}…`,
    badge: item.restricted ? "Restricted" : "Public",
    href: item.url ? `${api}${item.url}` : null,
    signIn: item.url === null,
  }));
}

export function describeMetadataError(error: unknown): string {
  if (error instanceof MetadataError) return `${error.code}: ${error.message}`;
  return `METADATA_UNAVAILABLE: ${error instanceof Error ? error.message : "The metadata service is unavailable."}`;
}
