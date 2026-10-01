import { describe, expect, it } from "vitest";
import { depositedBy, eventsFrom, totalsFrom, type ChainLog } from "./history";

const FACILITY = "0x00000000000000000000000000000000000000aa" as const;
const ALICE = "0x00000000000000000000000000000000000000a1" as const;
const U = 1_000_000n;

const log = (eventName: string, args: Record<string, unknown>, at: number): ChainLog => ({
  id: `${eventName}-${at}`,
  facility: FACILITY,
  eventName,
  args,
  at,
  txHash: "0x01",
});

const cycle: ChainLog[] = [
  log("FacilityCreated", { facility: FACILITY, originator: ALICE, name: "x", limit: 20n * U, firstLoss: 6n * U }, 1),
  log("Deposited", { provider: ALICE, tranche: 0, assets: 9n * U, shares: 9n * U }, 2),
  log("Drawn", { amount: 9n * U, fee: 450_000n, dueAt: 100n }, 3),
  log("MarkedLate", { dueAt: 100n, at: 101n }, 4),
  log("DefaultDeclared", { reason: "buyer insolvent", lossFirstLoss: 6n * U, lossJunior: 0n, lossSenior: 3n * U }, 5),
  log("Recovered", { amount: 9n * U, toSenior: 3n * U, toJunior: 0n, toOriginator: 6n * U }, 6),
  log("Withdrawn", { provider: ALICE, tranche: 0, assets: 9n * U, shares: 9n * U }, 7),
];

describe("totalsFrom", () => {
  it("adds up what each facility drew, repaid, lost and recovered", () => {
    expect(totalsFrom(cycle).get(FACILITY)).toEqual({ drawn: 9, repaid: 0, recovered: 9, defaultLoss: 9 });
  });

  it("counts repayments as principal plus fee", () => {
    const repaid = totalsFrom([log("Repaid", { principal: 9n * U, fee: 450_000n }, 1)]);
    expect(repaid.get(FACILITY)?.repaid).toBe(9.45);
  });
});

describe("eventsFrom", () => {
  it("names each onchain event from the actor's side, newest first", () => {
    const events = eventsFrom(cycle, (address) => (address === FACILITY ? "Bandung Tea Export 01" : address), "USDG");
    expect(events.map((event) => [event.actor, event.event])).toEqual([
      ["Investor", "Principal and return claimed"],
      ["Originator", "Payment remitted"],
      ["Keeper", "Default declared after grace period"],
      ["Keeper", "Payment marked late, drawdowns stopped"],
      ["Originator", "Liquidity drawn"],
      ["Investor", "Capital supplied"],
      ["Originator", "Facility opened, first-loss staked"],
    ]);
    expect(events[5]).toMatchObject({ facility: "Bandung Tea Export 01", amount: "9 USDG", provider: ALICE });
  });
});

describe("depositedBy", () => {
  it("nets one provider's deposits against what they took back", () => {
    const logs = [
      log("Deposited", { provider: ALICE, tranche: 0, assets: 9n * U, shares: 9n * U }, 1),
      log("Deposited", { provider: "0x00000000000000000000000000000000000000c3", tranche: 0, assets: 4n * U, shares: 4n * U }, 2),
      log("Withdrawn", { provider: ALICE, tranche: 0, assets: 2n * U, shares: 2n * U }, 3),
    ];
    expect(depositedBy(logs, ALICE).get(FACILITY)).toBe(7);
  });
});
