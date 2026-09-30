import { describe, expect, test } from "bun:test";
import { deriveFacility, derivePositions } from "./derive";
import { normalizeLog, type IndexedEvent } from "./events";
import { makeLog } from "./testing";

const FACTORY = "0x9F356D8eEf33a04F2F0628B80441D3Ed8Ebd4B52";
const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const PROVIDER = "0xfFa9a8409d1EEED0Df6AbfcF891896b10661e70B";
const ORIGINATOR = "0x9b62Bc224F93a8958EDe04b12c6C29d363dE04aF";
const NOW = 1_800_000_000;

let block = 0;
const ev = (name: string, args: Record<string, unknown>, address = FACILITY): IndexedEvent => {
  block += 1;
  return normalizeLog(1, makeLog(name, args, { address, blockNumber: block }))!;
};

const created = () => ev("FacilityCreated", { facility: FACILITY, originator: ORIGINATOR, name: "Rice 01", limit: 10_000_000n, firstLoss: 3_000_000n }, FACTORY);
const deposit = (assets = 6_000_000n, tranche = 0) => ev("Deposited", { provider: PROVIDER, tranche, assets, shares: assets });
const draw = (dueAt = NOW + 100) => ev("Drawn", { amount: 6_000_000n, fee: 300_000n, dueAt: BigInt(dueAt) });
const repaid = () => ev("Repaid", { principal: 6_000_000n, fee: 300_000n });
const closed = () => ev("FacilityClosed", {});
const late = () => ev("MarkedLate", { dueAt: BigInt(NOW - 10), at: BigInt(NOW) });
const defaulted = () => ev("DefaultDeclared", { reason: "buyer", lossFirstLoss: 3_000_000n, lossJunior: 0n, lossSenior: 3_000_000n });
const recovered = (amount: bigint) => ev("Recovered", { amount, toSenior: amount, toJunior: 0n, toOriginator: 0n });

describe("deriveFacility", () => {
  test("is FUNDING right after creation", () => {
    const f = deriveFacility([created()], NOW)!;
    expect(f.status).toBe("FUNDING");
    expect(f.name).toBe("Rice 01");
    expect(f.originator).toBe(ORIGINATOR.toLowerCase());
    expect(f.limit).toBe("10000000");
  });

  test("is FUNDED once capital is supplied and nothing is drawn", () => {
    block = 0;
    const f = deriveFacility([created(), deposit()], NOW)!;
    expect(f.status).toBe("FUNDED");
    expect(f.deposited).toEqual({ senior: "6000000", junior: "0" });
  });

  test("is ACTIVE after a drawdown and flags a due date that passed but was not marked", () => {
    block = 0;
    const active = deriveFacility([created(), deposit(), draw()], NOW)!;
    expect(active.status).toBe("ACTIVE");
    expect(active.pastDue).toBe(false);
    expect(active.outstandingPrincipal).toBe("6000000");
    block = 0;
    const overdue = deriveFacility([created(), deposit(), draw(NOW - 5)], NOW)!;
    expect(overdue.status).toBe("ACTIVE");
    expect(overdue.pastDue).toBe(true);
  });

  test("is LATE after MarkedLate", () => {
    block = 0;
    expect(deriveFacility([created(), deposit(), draw(NOW - 20), late()], NOW)!.status).toBe("LATE");
  });

  test("is REPAID when it closes without a default", () => {
    block = 0;
    const f = deriveFacility([created(), deposit(), draw(), repaid(), closed()], NOW)!;
    expect(f.status).toBe("REPAID");
    expect(f.outstandingPrincipal).toBe("0");
    expect(f.repaid).toEqual({ principal: "6000000", fee: "300000" });
  });

  test("is DEFAULTED with the loss outstanding, then RECOVERED once the loss is cleared", () => {
    block = 0;
    const base = [created(), deposit(), draw(NOW - 20), late(), defaulted()];
    const stuck = deriveFacility([...base, recovered(2_000_000n)], NOW)!;
    expect(stuck.status).toBe("DEFAULTED");
    expect(stuck.outstandingLoss).toBe("4000000");
    const done = deriveFacility([...base, recovered(2_000_000n), recovered(4_000_000n)], NOW)!;
    expect(done.status).toBe("RECOVERED");
    expect(done.outstandingLoss).toBe("0");
  });

  test("returns null when the facility was never created in the indexed range", () => {
    block = 0;
    expect(deriveFacility([deposit()], NOW)).toBeNull();
  });
});

describe("derivePositions", () => {
  test("nets deposits and withdrawals per tranche and marks claimable positions", () => {
    block = 0;
    const events = [created(), deposit(6_000_000n), draw(), repaid(), closed()];
    const positions = derivePositions(events, PROVIDER, NOW);
    expect(positions).toHaveLength(1);
    expect(positions[0].facility).toBe(FACILITY.toLowerCase());
    expect(positions[0].senior).toEqual({ assets: "6000000", shares: "6000000" });
    expect(positions[0].status).toBe("CLAIMABLE");
    expect(positions[0].sourceBlock).toBe(String(block));
  });

  test("is SETTLED after everything was withdrawn and HELD while capital is at work", () => {
    block = 0;
    const held = derivePositions([created(), deposit(), draw()], PROVIDER, NOW);
    expect(held[0].status).toBe("HELD");
    block = 0;
    const withdrawn = ev("Withdrawn", { provider: PROVIDER, tranche: 0, assets: 6_300_000n, shares: 6_000_000n });
    const settled = derivePositions([created(), deposit(), draw(), repaid(), closed(), withdrawn], PROVIDER, NOW);
    expect(settled[0].status).toBe("SETTLED");
    expect(settled[0].senior.shares).toBe("0");
  });

  test("ignores other accounts", () => {
    block = 0;
    expect(derivePositions([created(), deposit()], ORIGINATOR, NOW)).toHaveLength(0);
  });
});
