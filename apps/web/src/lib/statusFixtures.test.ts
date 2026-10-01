import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { FacilityData } from "../hooks/useFacilities";
import { FacilityStatus } from "../hooks/useFacilities";
import { fromUnits, marketAction, stageOf, toFacility } from "./book";

interface Fixture {
  scenario: string;
  facility: Address;
  originator: Address;
  raw: Record<string, string> & { terms: Record<string, string> };
  expected: { facility: string; pastDue: boolean; webStage: string; position: string; webMarketAction: string };
}

const fixtures = Object.values(
  import.meta.glob("../../../../contracts/test/fixtures/status/*.json", { eager: true, import: "default" }),
) as Fixture[];

const big = (value: string) => BigInt(value);

function dataOf(fixture: Fixture): FacilityData {
  const { raw } = fixture;
  const status = Number(raw.status);
  return {
    address: fixture.facility,
    name: "",
    originator: fixture.originator,
    terms: {
      limit: big(raw.terms.limit),
      firstLoss: big(raw.terms.firstLoss),
      tenor: big(raw.terms.tenor),
      grace: big(raw.terms.grace),
      financingFeeBps: big(raw.terms.financingFeeBps),
      lateFeePerDayBps: big(raw.terms.lateFeePerDayBps),
      seniorPerJuniorBps: big(raw.terms.seniorPerJuniorBps),
      seniorFeeShareBps: big(raw.terms.seniorFeeShareBps),
      capitalCap: big(raw.terms.capitalCap),
    },
    status,
    statusName: FacilityStatus[status],
    totalCapital: big(raw.totalCapital),
    seniorAssets: big(raw.seniorAssets),
    juniorAssets: big(raw.juniorAssets),
    firstLossReserve: big(raw.firstLossReserve),
    seniorTotalShares: big(raw.seniorTotalShares),
    juniorTotalShares: big(raw.juniorTotalShares),
    seniorCapacity: big(raw.seniorCapacity),
    principal: big(raw.principal),
    fee: big(raw.fee),
    owed: big(raw.owed),
    dueAt: big(raw.dueAt),
    lateSince: big(raw.lateSince),
    defaultedAt: big(raw.defaultedAt),
    defaultReason: raw.defaultReason,
    evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    lossFirstLoss: big(raw.lossFirstLoss),
    lossJunior: big(raw.lossJunior),
    lossSenior: big(raw.lossSenior),
    liquidity: big(raw.liquidity),
  };
}

describe("status fixtures from the Foundry lifecycle", () => {
  it("covers every lifecycle scenario", () => {
    expect(fixtures.map((fixture) => fixture.scenario).sort()).toEqual([
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

  it.each(fixtures.map((fixture) => [fixture.scenario, fixture] as const))("maps %s to the expected stage", (_, fixture) => {
    expect(stageOf(dataOf(fixture))).toBe(fixture.expected.webStage);
  });

  it.each(fixtures.filter((fixture) => fixture.expected.webMarketAction !== "").map((fixture) => [fixture.scenario, fixture] as const))(
    "offers the expected market action for %s",
    (_, fixture) => {
      const position = { seniorShares: big(fixture.raw.providerSeniorShares), juniorShares: big(fixture.raw.providerJuniorShares) };
      const facility = toFacility(dataOf(fixture), position);
      const supplied = fromUnits(big(fixture.raw.providerDeposited));
      expect(marketAction({ ...facility, holding: { ...facility.holding, supplied } })).toBe(fixture.expected.webMarketAction);
    },
  );
});
