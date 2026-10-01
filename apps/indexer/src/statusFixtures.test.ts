import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { deriveFacility, derivePositions, type FacilityStatus, type PositionStatus } from "./derive";
import { normalizeLog, type IndexedEvent } from "./events";

const DIR = join(import.meta.dir, "../../../contracts/test/fixtures/status");

interface Fixture {
  scenario: string;
  now: string;
  chainId: number;
  facility: string;
  provider: string;
  logs: { address: string; topics: string[]; data: string; blockNumber: string; logIndex: number; txHash: string }[];
  expected: { facility: string; pastDue: boolean; webStage: string; position: string; webMarketAction: string };
}

const fixtures: Fixture[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(join(DIR, file), "utf8")));

function eventsOf(fixture: Fixture): IndexedEvent[] {
  return fixture.logs
    .map((log) =>
      normalizeLog(fixture.chainId, {
        address: log.address as Hex,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data as Hex,
        blockNumber: BigInt(log.blockNumber),
        blockHash: `0x${BigInt(log.blockNumber).toString(16).padStart(64, "0")}` as Hex,
        transactionHash: log.txHash as Hex,
        logIndex: log.logIndex,
      }),
    )
    .filter((event): event is IndexedEvent => event !== null);
}

describe("status fixtures from the Foundry lifecycle", () => {
  test("covers every lifecycle scenario", () => {
    expect(fixtures.map((fixture) => fixture.scenario)).toEqual([
      "active",
      "active_fee_only",
      "closed_after_recovery",
      "defaulted",
      "funded",
      "funded_withdrawn",
      "funding",
      "late",
      "past_due_unmarked",
      "recovered_full",
      "recovered_partial",
      "repaid",
      "settled",
    ]);
  });

  for (const fixture of fixtures) {
    const events = eventsOf(fixture);
    const mine = events.filter((event) => event.facility === fixture.facility.toLowerCase());

    test(`derives the facility status for ${fixture.scenario}`, () => {
      const facility = deriveFacility(mine, Number(fixture.now))!;
      expect(facility.status).toBe(fixture.expected.facility as FacilityStatus);
      expect(facility.pastDue).toBe(fixture.expected.pastDue);
    });

    test(`derives the position status for ${fixture.scenario}`, () => {
      const positions = derivePositions(events, fixture.provider, Number(fixture.now)).filter((position) => position.facility === fixture.facility.toLowerCase());
      if (fixture.expected.position === "NONE") expect(positions).toHaveLength(0);
      else expect(positions.map((position) => position.status)).toEqual([fixture.expected.position as PositionStatus]);
    });
  }
});
