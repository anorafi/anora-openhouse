import { describe, expect, test } from "bun:test";
import { normalizeLog } from "./events";
import { makeLog } from "./testing";

const FACTORY = "0x9F356D8eEf33a04F2F0628B80441D3Ed8Ebd4B52";
const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const PROVIDER = "0xfFa9a8409d1EEED0Df6AbfcF891896b10661e70B";
const ORIGINATOR = "0x9b62Bc224F93a8958EDe04b12c6C29d363dE04aF";

describe("normalizeLog", () => {
  test("turns a Deposited log into the canonical envelope with string amounts", () => {
    const log = makeLog("Deposited", { provider: PROVIDER, tranche: 0, assets: 6_000_000n, shares: 6_000_000n }, { address: FACILITY, blockNumber: 100, logIndex: 3 });
    const event = normalizeLog(421614, log);
    expect(event).not.toBeNull();
    expect(event!.id).toBe(`421614:${log.transactionHash}:3`);
    expect(event!.chainId).toBe(421614);
    expect(event!.blockNumber).toBe("100");
    expect(event!.logIndex).toBe(3);
    expect(event!.facility).toBe(FACILITY.toLowerCase());
    expect(event!.event).toBe("Deposited");
    expect(event!.actor).toBe(PROVIDER.toLowerCase());
    expect(event!.data).toEqual({ provider: PROVIDER.toLowerCase(), tranche: "SENIOR", assets: "6000000", shares: "6000000" });
  });

  test("maps the junior tranche name", () => {
    const log = makeLog("Withdrawn", { provider: PROVIDER, tranche: 1, assets: 5n, shares: 4n }, { address: FACILITY, blockNumber: 7 });
    expect(normalizeLog(1, log)!.data.tranche).toBe("JUNIOR");
  });

  test("uses the new facility as the subject of FacilityCreated and the originator as actor", () => {
    const log = makeLog(
      "FacilityCreated",
      { facility: FACILITY, originator: ORIGINATOR, name: "Thailand Rice Shipment 37", limit: 10_000_000n, firstLoss: 3_000_000n },
      { address: FACTORY, blockNumber: 50 },
    );
    const event = normalizeLog(4663, log)!;
    expect(event.facility).toBe(FACILITY.toLowerCase());
    expect(event.actor).toBe(ORIGINATOR.toLowerCase());
    expect(event.data.limit).toBe("10000000");
    expect(event.data.name).toBe("Thailand Rice Shipment 37");
  });

  test("keeps admin events on the factory address", () => {
    const log = makeLog("OriginatorApprovalChanged", { originator: ORIGINATOR, approved: true }, { address: FACTORY, blockNumber: 60 });
    const event = normalizeLog(421614, log)!;
    expect(event.facility).toBe(FACTORY.toLowerCase());
    expect(event.actor).toBe(ORIGINATOR.toLowerCase());
    expect(event.data.approved).toBe(true);
  });

  test("returns null for logs that are not part of the indexed set", () => {
    const log = makeLog("Initialized", { version: 1n }, { address: FACILITY, blockNumber: 1 });
    expect(normalizeLog(1, log)).toBeNull();
  });

  test("leaves the actor empty for events that carry no address", () => {
    const log = makeLog("Repaid", { principal: 6_000_000n, fee: 300_000n }, { address: FACILITY, blockNumber: 9 });
    expect(normalizeLog(1, log)!.actor).toBeNull();
  });
});
