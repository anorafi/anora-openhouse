import { beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import { openDb, type Db } from "./db";
import type { RawLog } from "./events";
import { syncChain, type ChainClient, type SyncNetwork } from "./sync";
import { makeLog } from "./testing";

const FACTORY = "0x9F356D8eEf33a04F2F0628B80441D3Ed8Ebd4B52";
const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const PROVIDER = "0xfFa9a8409d1EEED0Df6AbfcF891896b10661e70B";
const ORIGINATOR = "0x9b62Bc224F93a8958EDe04b12c6C29d363dE04aF";

const network: SyncNetwork = { chainId: 421614, factory: FACTORY as Hex, deploymentBlock: 100n, confirmations: 2 };

class FakeChain implements ChainClient {
  head = 100n;
  logs: RawLog[] = [];
  hashes = new Map<bigint, Hex>();
  maxRange: bigint | null = null;
  calls: { from: bigint; to: bigint }[] = [];

  async getBlockNumber() {
    return this.head;
  }

  async getLogs(args: { address: Hex[]; fromBlock: bigint; toBlock: bigint }) {
    this.calls.push({ from: args.fromBlock, to: args.toBlock });
    if (this.maxRange !== null && args.toBlock - args.fromBlock + 1n > this.maxRange) throw new Error("query exceeds max results");
    const wanted = args.address.map((a) => a.toLowerCase());
    return this.logs.filter((log) => wanted.includes(log.address.toLowerCase()) && log.blockNumber >= args.fromBlock && log.blockNumber <= args.toBlock);
  }

  async getBlock(number: bigint) {
    const hash = this.hashes.get(number) ?? (`0x${number.toString(16).padStart(64, "0")}` as Hex);
    return { hash, timestamp: 1_790_000_000n + number };
  }
}

const options = { chunk: 50n, reorgWindow: 64n, retries: 3 };
let chain: FakeChain;
let db: Db;

const created = (block: number) =>
  makeLog("FacilityCreated", { facility: FACILITY, originator: ORIGINATOR, name: "Test", limit: 10n, firstLoss: 3n }, { address: FACTORY, blockNumber: block });
const deposited = (block: number, index = 0) =>
  makeLog("Deposited", { provider: PROVIDER, tranche: 0, assets: 6n, shares: 6n }, { address: FACILITY, blockNumber: block, logIndex: index });

beforeEach(() => {
  chain = new FakeChain();
  db = openDb(":memory:");
});

describe("syncChain", () => {
  test("backfills across chunks, records timestamps, and stores the cursor", async () => {
    chain.head = 260n;
    chain.logs = [created(120), deposited(180)];
    const state = await syncChain(chain, db, network, options);
    expect(state).toEqual({ indexedBlock: 260n, chainBlock: 260n });
    const events = db.events({ chainId: 421614 });
    expect(events.map((e) => e.event)).toEqual(["FacilityCreated", "Deposited"]);
    expect(events[1].observedAt).toBe(new Date((1_790_000_000 + 180) * 1000).toISOString());
    expect(chain.calls.length).toBeGreaterThan(1);
  });

  test("finds the logs of a facility created in the same chunk", async () => {
    chain.head = 140n;
    chain.logs = [created(110), deposited(111)];
    await syncChain(chain, db, network, options);
    expect(db.events({ chainId: 421614 }).map((e) => e.event)).toEqual(["FacilityCreated", "Deposited"]);
  });

  test("is idempotent when run again over the same range", async () => {
    chain.head = 140n;
    chain.logs = [created(110), deposited(111)];
    await syncChain(chain, db, network, options);
    chain.calls = [];
    await syncChain(chain, db, network, options);
    expect(db.events({ chainId: 421614 })).toHaveLength(2);
    expect(chain.calls).toHaveLength(0);
  });

  test("picks up only new blocks on the next run", async () => {
    chain.head = 140n;
    chain.logs = [created(110)];
    await syncChain(chain, db, network, options);
    chain.head = 160n;
    chain.logs.push(deposited(150));
    const state = await syncChain(chain, db, network, options);
    expect(state.indexedBlock).toBe(160n);
    expect(db.events({ chainId: 421614 })).toHaveLength(2);
  });

  test("rolls back a block whose hash changed and indexes the replacement", async () => {
    chain.head = 140n;
    chain.logs = [created(110), deposited(130)];
    await syncChain(chain, db, network, options);
    chain.hashes.set(130n, `0x${"ab".repeat(32)}` as Hex);
    chain.logs = [created(110), makeLog("Deposited", { provider: PROVIDER, tranche: 0, assets: 9n, shares: 9n }, { address: FACILITY, blockNumber: 130, blockHash: `0x${"ab".repeat(32)}` })];
    await syncChain(chain, db, network, options);
    const deposits = db.events({ chainId: 421614 }).filter((e) => e.event === "Deposited");
    expect(deposits).toHaveLength(1);
    expect(deposits[0].data.assets).toBe("9");
    expect(deposits[0].blockHash).toBe(`0x${"ab".repeat(32)}`);
  });

  test("shrinks the range and retries when the provider rejects a wide query", async () => {
    chain.head = 400n;
    chain.maxRange = 20n;
    chain.logs = [created(110), deposited(300)];
    const state = await syncChain(chain, db, network, { chunk: 200n, reorgWindow: 64n, retries: 8 });
    expect(state.indexedBlock).toBe(400n);
    expect(db.events({ chainId: 421614 })).toHaveLength(2);
  });

  test("keeps the cursor where it was when a query keeps failing", async () => {
    chain.head = 300n;
    chain.maxRange = 0n;
    await expect(syncChain(chain, db, network, { chunk: 50n, reorgWindow: 64n, retries: 2 })).rejects.toThrow();
    expect(db.cursor(421614)).toBeNull();
  });
});
