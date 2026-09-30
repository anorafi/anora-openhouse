import { beforeEach, describe, expect, test } from "bun:test";
import { openDb, type Db } from "./db";
import { normalizeLog } from "./events";
import { makeLog } from "./testing";

const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const PROVIDER = "0xfFa9a8409d1EEED0Df6AbfcF891896b10661e70B";
const OTHER = "0x07dF8cd6D20b71ba7F16309d2844B88d1043fFfB";

let db: Db;

const deposit = (block: number, index: number, provider = PROVIDER, chainId = 1) =>
  normalizeLog(chainId, makeLog("Deposited", { provider, tranche: 0, assets: 1n, shares: 1n }, { address: FACILITY, blockNumber: block, logIndex: index }))!;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("db events", () => {
  test("upserts by id without duplicating", () => {
    db.upsertEvents([deposit(10, 0)]);
    db.upsertEvents([deposit(10, 0)]);
    expect(db.events({ chainId: 1 })).toHaveLength(1);
  });

  test("filters by account, facility, and chain", () => {
    db.upsertEvents([deposit(10, 0), deposit(11, 0, OTHER), deposit(12, 0, PROVIDER, 2)]);
    expect(db.events({ chainId: 1, account: PROVIDER })).toHaveLength(1);
    expect(db.events({ chainId: 1, facility: FACILITY })).toHaveLength(2);
    expect(db.events({ chainId: 2 })).toHaveLength(1);
  });

  test("orders newest first and pages with an opaque cursor", () => {
    db.upsertEvents([deposit(10, 0), deposit(10, 1), deposit(11, 0), deposit(12, 0)]);
    const first = db.page({ chainId: 1 }, { limit: 2 });
    expect(first.items.map((e) => `${e.blockNumber}:${e.logIndex}`)).toEqual(["12:0", "11:0"]);
    expect(first.nextCursor).not.toBeNull();
    const second = db.page({ chainId: 1 }, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((e) => `${e.blockNumber}:${e.logIndex}`)).toEqual(["10:1", "10:0"]);
    expect(second.nextCursor).toBeNull();
  });

  test("deleteFromBlock removes that block and everything after it", () => {
    db.upsertEvents([deposit(10, 0), deposit(11, 0), deposit(12, 0)]);
    db.deleteFromBlock(1, 11);
    expect(db.events({ chainId: 1 }).map((e) => e.blockNumber)).toEqual(["10"]);
  });

  test("stores a cursor per chain", () => {
    expect(db.cursor(1)).toBeNull();
    db.setCursor(1, 500n);
    db.setCursor(2, 9n);
    expect(db.cursor(1)).toBe(500n);
    expect(db.cursor(2)).toBe(9n);
  });
});
