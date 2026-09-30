import { beforeEach, describe, expect, test } from "bun:test";
import { createHandler, type ChainStatus } from "./api";
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
    expect(body.items[0]).toMatchObject({ facility: FACILITY.toLowerCase(), status: "HELD", senior: { assets: "6000000", shares: "6000000" } });
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
