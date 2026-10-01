import { beforeEach, describe, expect, test } from "bun:test";
import { createHandler, type ChainStatus } from "./api";
import { createLimiter } from "./limit";
import { openDb, type Db } from "./db";
import { normalizeLog, type IndexedEvent } from "./events";
import { makeLog } from "./testing";

const FACTORY = "0x9F356D8eEf33a04F2F0628B80441D3Ed8Ebd4B52";
const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const PROVIDER = "0xfFa9a8409d1EEED0Df6AbfcF891896b10661e70B";
const ORIGINATOR = "0x9b62Bc224F93a8958EDe04b12c6C29d363dE04aF";
const NOW = 1_800_000_000;

let db: Db;
let status: Map<number, ChainStatus>;
let n = 0;

const ev = (name: string, args: Record<string, unknown>, address = FACILITY): IndexedEvent => {
  n += 1;
  return { ...normalizeLog(421614, makeLog(name, args, { address, blockNumber: 100 + n }))!, observedAt: "2026-09-30T00:00:00.000Z" };
};

const call = (path: string, init?: RequestInit) => handler(new Request(`http://127.0.0.1:8100${path}`, init));
let handler: (request: Request) => Promise<Response>;

beforeEach(() => {
  n = 0;
  db = openDb(":memory:");
  db.upsertEvents([
    ev("FacilityCreated", { facility: FACILITY, originator: ORIGINATOR, name: "Rice 01", limit: 10_000_000n, firstLoss: 3_000_000n }, FACTORY),
    ev("Deposited", { provider: PROVIDER, tranche: 0, assets: 6_000_000n, shares: 6_000_000n }),
    ev("Drawn", { amount: 6_000_000n, fee: 300_000n, dueAt: BigInt(NOW + 100) }),
  ]);
  status = new Map([[421614, { indexedBlock: 1000n, chainBlock: 1002n, error: null }]]);
  handler = createHandler({
    db,
    networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
    status,
    maxLag: 50n,
    now: () => NOW,
    origins: ["https://openhouse.anora.finance"],
  });
});

const json = async (response: Response) => (await response.json()) as Record<string, any>;

describe("health", () => {
  test("reports the indexed block, the chain block, and the lag per chain", async () => {
    const body = await json(await call("/v1/health"));
    expect(body.chains[0]).toMatchObject({ chainId: 421614, indexedBlock: "1000", chainBlock: "1002", lag: "2", state: "ok" });
  });

  test("reports rpc_unavailable when the head cannot be read", async () => {
    status.set(421614, { indexedBlock: 1000n, chainBlock: null, error: "fetch failed" });
    const body = await json(await call("/v1/health"));
    expect(body.chains[0].state).toBe("rpc_unavailable");
  });
});

describe("facilities", () => {
  test("lists derived facilities for a chain with the source block", async () => {
    const body = await json(await call("/v1/facilities?chainId=421614"));
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ address: FACILITY.toLowerCase(), status: "ACTIVE", name: "Rice 01" });
    expect(body.indexedBlock).toBe("1000");
  });

  test("returns one facility and 404 for an unknown address", async () => {
    const found = await call(`/v1/facilities/421614/${FACILITY}`);
    expect(found.status).toBe(200);
    expect((await json(found)).status).toBe("ACTIVE");
    const missing = await call(`/v1/facilities/421614/${PROVIDER}`);
    expect(missing.status).toBe(404);
    expect((await json(missing)).error.code).toBe("FACILITY_NOT_FOUND");
  });

  test("requires a chain id and rejects an unsupported one", async () => {
    expect((await call("/v1/facilities")).status).toBe(400);
    const other = await call("/v1/facilities?chainId=1");
    expect(other.status).toBe(404);
    expect((await json(other)).error.code).toBe("UNSUPPORTED_CHAIN");
  });

  test("rejects a malformed address", async () => {
    const response = await call("/v1/facilities/421614/0x123");
    expect(response.status).toBe(400);
  });
});

describe("positions", () => {
  test("returns the wallet positions with their source block", async () => {
    const body = await json(await call(`/v1/accounts/${PROVIDER}/positions?chainId=421614`));
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ facility: FACILITY.toLowerCase(), status: "HELD", senior: { deposited: "6000000", withdrawn: "0", shares: "6000000" } });
  });
});

describe("activity", () => {
  test("returns newest first with confirmations and a final flag", async () => {
    const body = await json(await call("/v1/activity?chainId=421614"));
    expect(body.items.map((e: any) => e.event)).toEqual(["Drawn", "Deposited", "FacilityCreated"]);
    expect(body.items[0].confirmations).toBe(900);
    expect(body.items[0].final).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  test("pages with the cursor and filters by account and facility", async () => {
    const first = await json(await call("/v1/activity?chainId=421614&limit=2"));
    expect(first.items).toHaveLength(2);
    const second = await json(await call(`/v1/activity?chainId=421614&limit=2&cursor=${first.nextCursor}`));
    expect(second.items.map((e: any) => e.event)).toEqual(["FacilityCreated"]);
    const mine = await json(await call(`/v1/activity?chainId=421614&account=${PROVIDER}`));
    expect(mine.items.map((e: any) => e.event)).toEqual(["Deposited"]);
    const scoped = await json(await call(`/v1/activity?chainId=421614&facility=${FACILITY}`));
    expect(scoped.items).toHaveLength(3);
  });

  test("rejects a cursor it did not issue", async () => {
    const response = await call("/v1/activity?chainId=421614&cursor=nope");
    expect(response.status).toBe(400);
  });
});

describe("errors", () => {
  test("answers INDEXER_BEHIND with both blocks when the lag is too large", async () => {
    status.set(421614, { indexedBlock: 100n, chainBlock: 1002n, error: null });
    const response = await call("/v1/facilities?chainId=421614");
    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatchObject({ code: "INDEXER_BEHIND", indexedBlock: "100", chainBlock: "1002" });
  });

  test("answers RPC_UNAVAILABLE when no head has ever been read", async () => {
    status.set(421614, { indexedBlock: null, chainBlock: null, error: "fetch failed" });
    const response = await call("/v1/facilities?chainId=421614");
    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("RPC_UNAVAILABLE");
  });

  test("answers 404 for an unknown route", async () => {
    expect((await call("/v1/nothing")).status).toBe(404);
  });
});

describe("cors", () => {
  test("allows the production origin and local development origins only", async () => {
    const prod = await call("/v1/health", { headers: { origin: "https://openhouse.anora.finance" } });
    expect(prod.headers.get("access-control-allow-origin")).toBe("https://openhouse.anora.finance");
    const local = await call("/v1/health", { headers: { origin: "http://127.0.0.1:5173" } });
    expect(local.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    const other = await call("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("answers a preflight request", async () => {
    const response = await call("/v1/activity", { method: "OPTIONS", headers: { origin: "https://openhouse.anora.finance" } });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });
});

describe("metadata routes", () => {
  const delegating = () =>
    createHandler({
      db,
      networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
      status,
      maxLag: 50n,
      now: () => NOW,
      origins: ["https://openhouse.anora.finance"],
      meta: async (request, url) => (url.pathname === "/v1/auth/nonce" ? new Response(JSON.stringify({ ok: request.method }), { status: 200, headers: { "content-type": "application/json" } }) : null),
    });

  test("hands matching requests to the metadata module and adds cors headers", async () => {
    const response = await delegating()(new Request("http://127.0.0.1:8100/v1/auth/nonce", { method: "POST", headers: { origin: "https://openhouse.anora.finance" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: "POST" });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://openhouse.anora.finance");
  });

  test("keeps other post requests rejected", async () => {
    const response = await delegating()(new Request("http://127.0.0.1:8100/v1/health", { method: "POST" }));
    expect(response.status).toBe(405);
  });

  test("allows post and the authorization header in preflight for approved origins only", async () => {
    const approved = await delegating()(new Request("http://127.0.0.1:8100/v1/auth/nonce", { method: "OPTIONS", headers: { origin: "https://openhouse.anora.finance" } }));
    expect(approved.headers.get("access-control-allow-methods")).toContain("POST");
    expect(approved.headers.get("access-control-allow-headers")).toContain("authorization");
    const foreign = await delegating()(new Request("http://127.0.0.1:8100/v1/auth/nonce", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });
});


describe("rate limiting", () => {
  const limited = (options: { peer?: string } = {}) => {
    let ms = 0;
    const handle = createHandler({
      db,
      networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
      status,
      maxLag: 50n,
      now: () => NOW,
      origins: ["https://openhouse.anora.finance"],
      limiter: createLimiter({ now: () => ms, rules: { auth: { capacity: 2, perMinute: 2 }, write: { capacity: 2, perMinute: 2 }, read: { capacity: 3, perMinute: 3 } } }),
      meta: async (request, url) => (url.pathname.startsWith("/v1/auth/") || url.pathname.startsWith("/v1/uploads/") ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : null),
    });
    return {
      advance: (by: number) => void (ms += by),
      call: (path: string, init?: RequestInit, peer = options.peer ?? "203.0.113.5") => handle(new Request(`http://127.0.0.1:8100${path}`, init), peer),
    };
  };

  test("answers 429 with a typed code, a retry delay, and cors headers", async () => {
    const { call } = limited();
    for (let i = 0; i < 3; i += 1) expect((await call("/v1/activity?chainId=421614")).status).toBe(200);
    const response = await call("/v1/activity?chainId=421614", { headers: { origin: "https://openhouse.anora.finance" } });
    expect(response.status).toBe(429);
    expect((await json(response)).error.code).toBe("RATE_LIMITED");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://openhouse.anora.finance");
  });

  test("limits sign in calls and writes with their own budgets", async () => {
    const { call } = limited();
    const post = (path: string) => call(path, { method: "POST", body: "{}" });
    expect((await post("/v1/auth/nonce")).status).toBe(200);
    expect((await post("/v1/auth/verify")).status).toBe(200);
    expect((await post("/v1/auth/nonce")).status).toBe(429);
    expect((await call("/v1/uploads/abc", { method: "PUT", body: "x" })).status).toBe(200);
    expect((await call("/v1/uploads/abc", { method: "PUT", body: "x" })).status).toBe(200);
    expect((await call("/v1/uploads/abc", { method: "PUT", body: "x" })).status).toBe(429);
  });

  test("never limits health", async () => {
    const { call } = limited();
    for (let i = 0; i < 20; i += 1) expect((await call("/v1/health")).status).toBe(200);
  });

  test("does not limit preflight requests", async () => {
    const { call } = limited();
    for (let i = 0; i < 10; i += 1) expect((await call("/v1/activity", { method: "OPTIONS", headers: { origin: "https://openhouse.anora.finance" } })).status).toBe(204);
  });

  test("recovers after the retry delay", async () => {
    const { call, advance } = limited();
    for (let i = 0; i < 3; i += 1) await call("/v1/activity?chainId=421614");
    expect((await call("/v1/activity?chainId=421614")).status).toBe(429);
    advance(20_000);
    expect((await call("/v1/activity?chainId=421614")).status).toBe(200);
  });

  test("tells clients apart by the forwarded address when the peer is the local proxy", async () => {
    const { call } = limited();
    const as = (client: string) => call("/v1/activity?chainId=421614", { headers: { "x-forwarded-for": client } }, "127.0.0.1");
    for (let i = 0; i < 3; i += 1) await as("198.51.100.1");
    expect((await as("198.51.100.1")).status).toBe(429);
    expect((await as("198.51.100.2")).status).toBe(200);
  });

  test("ignores the forwarded address from any other peer", async () => {
    const { call } = limited();
    const spoof = (client: string) => call("/v1/activity?chainId=421614", { headers: { "x-forwarded-for": client } }, "203.0.113.9");
    for (let i = 0; i < 3; i += 1) await spoof(`198.51.100.${i}`);
    expect((await spoof("198.51.100.99")).status).toBe(429);
  });

  test("rejects a post with an oversized declared body", async () => {
    const { call } = limited();
    const response = await call("/v1/auth/verify", { method: "POST", headers: { "content-length": String(64 * 1024 + 1) }, body: "{}" });
    expect(response.status).toBe(413);
    expect((await json(response)).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("rejects a post whose streamed body exceeds the cap", async () => {
    const { call } = limited();
    const chunk = new Uint8Array(16 * 1024);
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 5; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const response = await call("/v1/auth/verify", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
  });

  test("passes a small post body through unchanged", async () => {
    let received = "";
    const handle = createHandler({
      db,
      networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
      status,
      maxLag: 50n,
      now: () => NOW,
      origins: [],
      limiter: createLimiter({ now: () => 0 }),
      meta: async (request, url) => {
        if (url.pathname !== "/v1/auth/verify") return null;
        received = await request.text();
        return new Response("{}", { status: 200 });
      },
    });
    const response = await handle(new Request("http://127.0.0.1:8100/v1/auth/verify", { method: "POST", body: '{"a":1}' }), "203.0.113.5");
    expect(response.status).toBe(200);
    expect(received).toBe('{"a":1}');
  });

  test("does not cap upload bodies at the json size", async () => {
    let size = 0;
    const handle = createHandler({
      db,
      networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
      status,
      maxLag: 50n,
      now: () => NOW,
      origins: [],
      limiter: createLimiter({ now: () => 0 }),
      meta: async (request, url) => {
        if (!url.pathname.startsWith("/v1/uploads/")) return null;
        size = (await request.arrayBuffer()).byteLength;
        return new Response("{}", { status: 200 });
      },
    });
    const response = await handle(new Request("http://127.0.0.1:8100/v1/uploads/abc", { method: "PUT", body: new Uint8Array(200 * 1024) }), "203.0.113.5");
    expect(response.status).toBe(200);
    expect(size).toBe(200 * 1024);
  });
});

describe("rpc proxy route", () => {
  const seen: { chainId: number; payload: unknown }[] = [];
  const proxied = (options: { limiter?: ReturnType<typeof createLimiter> } = {}) => {
    seen.length = 0;
    const handle = createHandler({
      db,
      networks: [{ chainId: 421614, key: "arbitrum-sepolia", name: "Arbitrum Sepolia", confirmations: 2 }],
      status,
      maxLag: 50n,
      now: () => NOW,
      origins: ["https://openhouse.anora.finance"],
      limiter: options.limiter,
      rpc: async (chainId, payload) => {
        seen.push({ chainId, payload });
        return { status: 200, body: { jsonrpc: "2.0", id: 1, result: "0x1" } };
      },
    });
    return (path: string, init?: RequestInit, peer = "203.0.113.5") => handle(new Request(`http://127.0.0.1:8100${path}`, init), peer);
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

  test("forwards a json-rpc post to the proxy with the chain id", async () => {
    const send = proxied();
    const response = await send("/rpc/421614", post({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }));
    expect(response.status).toBe(200);
    expect((await json(response)).result).toBe("0x1");
    expect(seen).toEqual([{ chainId: 421614, payload: { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] } }]);
  });

  test("answers only post and rejects bad chain ids and bad json", async () => {
    const send = proxied();
    expect((await send("/rpc/421614")).status).toBe(405);
    expect((await send("/rpc/abc", post({}))).status).toBe(404);
    const bad = await send("/rpc/421614", post("{nope"));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.code).toBe(-32700);
    expect(seen).toHaveLength(0);
  });

  test("allows bodies above the json limit but not above the rpc limit", async () => {
    const send = proxied();
    const medium = { jsonrpc: "2.0", id: 1, method: "eth_call", params: ["x".repeat(100 * 1024)] };
    expect((await send("/rpc/421614", post(medium))).status).toBe(200);
    const large = { jsonrpc: "2.0", id: 1, method: "eth_call", params: ["x".repeat(300 * 1024)] };
    expect((await send("/rpc/421614", post(large))).status).toBe(413);
  });

  test("sets cors headers for the site and answers preflight", async () => {
    const send = proxied();
    const response = await send("/rpc/421614", post({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, { origin: "https://openhouse.anora.finance" }));
    expect(response.headers.get("access-control-allow-origin")).toBe("https://openhouse.anora.finance");
    const preflight = await send("/rpc/421614", { method: "OPTIONS", headers: { origin: "https://openhouse.anora.finance" } });
    expect(preflight.status).toBe(204);
    const foreign = await send("/rpc/421614", post({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }, { origin: "https://evil.example" }));
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("limits proxy calls with the rpc budget and keeps other classes separate", async () => {
    const limiter = createLimiter({ now: () => 0, rules: { rpc: { capacity: 2, perMinute: 2 }, read: { capacity: 5, perMinute: 5 } } });
    const send = proxied({ limiter });
    const rpcCall = () => send("/rpc/421614", post({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }));
    expect((await rpcCall()).status).toBe(200);
    expect((await rpcCall()).status).toBe(200);
    const blocked = await rpcCall();
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error.code).toBe("RATE_LIMITED");
    expect((await send("/v1/activity?chainId=421614")).status).toBe(200);
  });

  test("is not served when no proxy is configured", async () => {
    const response = await call("/rpc/421614", post({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }));
    expect(response.status).toBe(404);
  });
});
