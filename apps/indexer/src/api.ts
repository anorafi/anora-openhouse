import { decodeCursor, type Db, type StoredEvent } from "./db";
import { deriveFacility, derivePositions } from "./derive";

export interface ChainStatus {
  indexedBlock: bigint | null;
  chainBlock: bigint | null;
  error: string | null;
}

export interface ApiNetwork {
  chainId: number;
  key: string;
  name: string;
  confirmations: number;
}

export interface ApiDeps {
  db: Db;
  networks: ApiNetwork[];
  status: Map<number, ChainStatus>;
  maxLag: bigint;
  now: () => number;
  origins: string[];
  meta?: (request: Request, url: URL) => Promise<Response | null>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function send(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function chainOf(deps: ApiDeps, url: URL, param?: string): ApiNetwork {
  const raw = param ?? url.searchParams.get("chainId");
  if (!raw || !/^\d+$/.test(raw)) throw new ApiError(400, "INVALID_REQUEST", "chainId is required.");
  const network = deps.networks.find((entry) => entry.chainId === Number(raw));
  if (!network) throw new ApiError(404, "UNSUPPORTED_CHAIN", `Chain ${raw} is not indexed.`);
  return network;
}

function fresh(deps: ApiDeps, network: ApiNetwork): { indexedBlock: bigint; chainBlock: bigint } {
  const state = deps.status.get(network.chainId);
  if (!state || state.indexedBlock === null || state.chainBlock === null) {
    if (state?.indexedBlock != null) return { indexedBlock: state.indexedBlock, chainBlock: state.indexedBlock };
    throw new ApiError(503, "RPC_UNAVAILABLE", "The chain head has not been read yet.", { detail: state?.error ?? null });
  }
  if (state.chainBlock - state.indexedBlock > deps.maxLag) {
    throw new ApiError(503, "INDEXER_BEHIND", "The indexer is behind the chain.", {
      indexedBlock: state.indexedBlock.toString(),
      chainBlock: state.chainBlock.toString(),
    });
  }
  return { indexedBlock: state.indexedBlock, chainBlock: state.chainBlock };
}

function address(value: string): string {
  if (!ADDRESS.test(value)) throw new ApiError(400, "INVALID_REQUEST", "Address must be a 20-byte hex string.");
  return value.toLowerCase();
}

function withConfirmations(event: StoredEvent, chainBlock: bigint, required: number) {
  const confirmations = Number(chainBlock - BigInt(event.blockNumber) + 1n);
  return { ...event, confirmations, final: confirmations >= required };
}

function groupByFacility(events: StoredEvent[]): Map<string, StoredEvent[]> {
  const grouped = new Map<string, StoredEvent[]>();
  for (const event of events) {
    const list = grouped.get(event.facility) ?? [];
    list.push(event);
    grouped.set(event.facility, list);
  }
  return grouped;
}

function health(deps: ApiDeps) {
  const chains = deps.networks.map((network) => {
    const state = deps.status.get(network.chainId);
    const indexed = state?.indexedBlock ?? null;
    const head = state?.chainBlock ?? null;
    const lag = indexed !== null && head !== null ? head - indexed : null;
    let value = "ok";
    if (head === null) value = "rpc_unavailable";
    else if (lag !== null && lag > deps.maxLag) value = "behind";
    return {
      chainId: network.chainId,
      key: network.key,
      indexedBlock: indexed?.toString() ?? null,
      chainBlock: head?.toString() ?? null,
      lag: lag?.toString() ?? null,
      state: value,
      error: state?.error ?? null,
    };
  });
  return { schemaVersion: 1, ok: chains.every((chain) => chain.state === "ok"), chains };
}

function route(deps: ApiDeps, url: URL): unknown {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/v1/health") return health(deps);

  if (path === "/v1/facilities") {
    const network = chainOf(deps, url);
    const blocks = fresh(deps, network);
    const grouped = groupByFacility(deps.db.events({ chainId: network.chainId }));
    const items = [...grouped.values()].map((events) => deriveFacility(events, deps.now())).filter((item) => item !== null);
    return { schemaVersion: 1, chainId: network.chainId, indexedBlock: blocks.indexedBlock.toString(), chainBlock: blocks.chainBlock.toString(), items };
  }

  const one = path.match(/^\/v1\/facilities\/(\d+)\/([^/]+)$/);
  if (one) {
    const network = chainOf(deps, url, one[1]);
    const blocks = fresh(deps, network);
    const wanted = address(one[2]);
    const summary = deriveFacility(deps.db.events({ chainId: network.chainId, facility: wanted }), deps.now());
    if (!summary) throw new ApiError(404, "FACILITY_NOT_FOUND", `No facility ${wanted} on chain ${network.chainId}.`);
    return { schemaVersion: 1, indexedBlock: blocks.indexedBlock.toString(), chainBlock: blocks.chainBlock.toString(), ...summary };
  }

  const positions = path.match(/^\/v1\/accounts\/([^/]+)\/positions$/);
  if (positions) {
    const network = chainOf(deps, url);
    const blocks = fresh(deps, network);
    const account = address(positions[1]);
    const items = derivePositions(deps.db.events({ chainId: network.chainId }), account, deps.now());
    return { schemaVersion: 1, chainId: network.chainId, account, indexedBlock: blocks.indexedBlock.toString(), chainBlock: blocks.chainBlock.toString(), items };
  }

  if (path === "/v1/activity") {
    const network = chainOf(deps, url);
    const blocks = fresh(deps, network);
    const account = url.searchParams.get("account");
    const facility = url.searchParams.get("facility");
    const cursor = url.searchParams.get("cursor");
    if (cursor && !decodeCursor(cursor)) throw new ApiError(400, "INVALID_REQUEST", "The cursor was not issued by this API.");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = deps.db.page(
      { chainId: network.chainId, account: account ? address(account) : undefined, facility: facility ? address(facility) : undefined },
      { limit, cursor: cursor ?? undefined },
    );
    return {
      schemaVersion: 1,
      chainId: network.chainId,
      indexedBlock: blocks.indexedBlock.toString(),
      chainBlock: blocks.chainBlock.toString(),
      items: page.items.map((event) => withConfirmations(event, blocks.chainBlock, network.confirmations)),
      nextCursor: page.nextCursor,
    };
  }

  throw new ApiError(404, "NOT_FOUND", "Unknown route.");
}

export function createHandler(deps: ApiDeps) {
  const allowed = (origin: string | null) => (origin && (deps.origins.includes(origin) || LOCAL_ORIGIN.test(origin)) ? origin : null);

  return async (request: Request): Promise<Response> => {
    const origin = allowed(request.headers.get("origin"));
    const cors: Record<string, string> = { vary: "Origin" };
    if (origin) {
      cors["access-control-allow-origin"] = origin;
      cors["access-control-allow-methods"] = "GET, POST, PUT, OPTIONS";
      cors["access-control-allow-headers"] = "content-type, authorization";
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (deps.meta) {
      const handled = await deps.meta(request, new URL(request.url));
      if (handled) {
        for (const [name, value] of Object.entries(cors)) handled.headers.set(name, value);
        return handled;
      }
    }
    if (request.method !== "GET") return send({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } }, 405, cors);
    try {
      return send(route(deps, new URL(request.url)), 200, cors);
    } catch (error) {
      if (error instanceof ApiError) return send({ error: { code: error.code, message: error.message, ...error.extra } }, error.status, cors);
      return send({ error: { code: "INTERNAL", message: "Unexpected error." } }, 500, cors);
    }
  };
}
