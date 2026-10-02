import { describe, expect, it } from "vitest";
import type { FacilityData } from "../hooks/useFacilities";
import { draftSizeFor, durationText, fromUnits, fundingState, marketAction, realizedReturn, stageOf, toFacility, toUnits, waterfallOf, type Facility } from "./book";
import { originatorBook } from "../state/book";
import { encodeFacilityName } from "./facilityName";

const U = 1_000_000n;
const ADDRESS = "0x00000000000000000000000000000000000000aa" as const;
const ORIGINATOR = "0x00000000000000000000000000000000000000bb" as const;

function data(overrides: Partial<FacilityData> = {}): FacilityData {
  return {
    address: ADDRESS,
    name: encodeFacilityName({ name: "Bandung Tea Export 01", company: "PT Teh", route: "Indonesia → Singapore", type: "Export receivables", icon: "◒" }),
    originator: ORIGINATOR,
    terms: {
      limit: 20n * U,
      firstLoss: 6n * U,
      tenor: 180n,
      grace: 60n,
      financingFeeBps: 500n,
      lateFeePerDayBps: 10n,
      seniorPerJuniorBps: 22_500n,
      seniorFeeShareBps: 6_000n,
      capitalCap: 1_000n * U,
    },
    status: 0,
    statusName: "Open",
    totalCapital: 6n * U,
    seniorAssets: 0n,
    juniorAssets: 0n,
    firstLossReserve: 6n * U,
    seniorTotalShares: 0n,
    juniorTotalShares: 0n,
    seniorCapacity: 13_500_000n,
    principal: 0n,
    fee: 0n,
    owed: 0n,
    dueAt: 0n,
    lateSince: 0n,
    defaultedAt: 0n,
    defaultReason: "",
    evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    lossFirstLoss: 0n,
    lossJunior: 0n,
    lossSenior: 0n,
    liquidity: 0n,
    ...overrides,
  };
}

const withStatus = (statusName: FacilityData["statusName"]) => ({ status: ["Open", "Late", "Defaulted", "Closed"].indexOf(statusName), statusName });

describe("units", () => {
  it("converts between six-decimal units and display numbers", () => {
    expect(fromUnits(13_500_000n)).toBe(13.5);
    expect(toUnits(13.5)).toBe(13_500_000n);
    expect(toUnits(0.1 + 0.2)).toBe(300_000n);
  });
});

describe("durationText", () => {
  it("spells out the unit for minutes, hours, and days", () => {
    expect(durationText(180)).toBe("3 minutes");
    expect(durationText(7_200)).toBe("2 hours");
    expect(durationText(90 * 86_400)).toBe("90 days");
  });

  it("uses the singular for one", () => {
    expect(durationText(60)).toBe("1 minute");
    expect(durationText(3_600)).toBe("1 hour");
    expect(durationText(86_400)).toBe("1 day");
  });
});

describe("stageOf", () => {
  it("walks the happy path from the facility's own state", () => {
    expect(stageOf(data())).toBe("open");
    expect(stageOf(data({ seniorAssets: 9n * U, seniorTotalShares: 9n * U }))).toBe("funded");
    expect(stageOf(data({ seniorAssets: 9n * U, seniorTotalShares: 9n * U, principal: 9n * U, dueAt: 1_900_000_000n }))).toBe("drawn");
    expect(stageOf(data({ ...withStatus("Late"), principal: 9n * U, dueAt: 1_900_000_000n }))).toBe("late");
    expect(stageOf(data({ ...withStatus("Closed"), seniorAssets: 9_270_000n, seniorTotalShares: 9n * U }))).toBe("repaid");
  });

  it("settles once every share is withdrawn, even with the unclaimable junior fee left behind", () => {
    expect(stageOf(data({ ...withStatus("Closed"), juniorAssets: 180_000n }))).toBe("settled");
  });

  it("follows the default path until recoveries are claimed", () => {
    const defaulted = { ...withStatus("Defaulted"), seniorTotalShares: 9n * U };
    expect(stageOf(data({ ...defaulted, lossFirstLoss: 6n * U, lossSenior: 3n * U }))).toBe("defaulted");
    expect(stageOf(data({ ...defaulted, seniorAssets: 9n * U }))).toBe("recovered");
    expect(stageOf(data({ ...withStatus("Defaulted") }))).toBe("closed");
  });
});

describe("toFacility", () => {
  it("decodes the listing and prices the senior return from the fee split", () => {
    const facility = toFacility(data(), { seniorShares: 0n, juniorShares: 0n });
    expect(facility.company).toBe("PT Teh");
    expect(facility.feePct).toBe(5);
    expect(facility.targetReturn).toBe(3);
    expect(facility.durationLabel).toBe("3 minutes");
  });

  it("offers senior up to its capacity and junior up to the credit limit", () => {
    const facility = toFacility(data(), { seniorShares: 0n, juniorShares: 0n });
    expect(facility.seniorAvailable).toBe(13.5);
    expect(facility.juniorAvailable).toBe(20);
    expect(facility.available).toBe(20);
    expect(facility.reservePct).toBe(30);
  });

  it("stops offering capital once the facility has drawn", () => {
    const facility = toFacility(data({ principal: 9n * U, dueAt: 1_900_000_000n, seniorAssets: 9n * U, seniorTotalShares: 9n * U }), { seniorShares: 0n, juniorShares: 0n });
    expect(facility.available).toBe(0);
  });

  it("values a holding at the tranche's current assets", () => {
    const facility = toFacility(
      data({ ...withStatus("Closed"), seniorAssets: 9_270_000n, seniorTotalShares: 9n * U }),
      { seniorShares: 3n * U, juniorShares: 0n },
    );
    expect(facility.holding.value).toBe(3.09);
  });
});

describe("waterfallOf", () => {
  const defaulted = data({ ...withStatus("Defaulted"), seniorTotalShares: 9n * U, seniorAssets: 6n * U, lossFirstLoss: 6n * U, lossSenior: 3n * U });

  it("reports what is still unrecovered and who is carrying it", () => {
    const flow = waterfallOf(toFacility(defaulted, { seniorShares: 9n * U, juniorShares: 0n }, { drawn: 9, repaid: 0, recovered: 0, defaultLoss: 9 }));
    expect(flow).toMatchObject({ owed: 9, recovered: 0, shortfall: 9, reserveApplied: 6, supplierLoss: 3 });
  });

  it("previews a payment senior first, then first-loss back to the originator", () => {
    const facility = toFacility(defaulted, { seniorShares: 9n * U, juniorShares: 0n }, { drawn: 9, repaid: 0, recovered: 0, defaultLoss: 9 });
    expect(waterfallOf(facility, 4)).toMatchObject({ recovered: 4, shortfall: 5, supplierLoss: 0, reserveApplied: 5 });
  });
});

describe("provider view of a facility", () => {
  const open = toFacility(data(), { seniorShares: 0n, juniorShares: 0n });

  it("labels the asset and reads the tranche split from the contract terms", () => {
    expect(toFacility(data(), { seniorShares: 0n, juniorShares: 0n }, undefined, "USDG").asset).toBe("USDG");
    expect(open.asset).toBe("USDC");
    expect(open.firstLossPct).toBe(30);
    expect(open.juniorPct).toBeCloseTo(0.769, 2);
    expect(open.seniorPct).toBeCloseTo(69.231, 2);
  });

  it("measures funding against what the contract still accepts", () => {
    expect(fundingState(open)).toMatchObject({ accepting: true, available: 20, percent: 0, label: "0% funded" });
    const half = { ...open, supplied: 6.75, available: 6.75 };
    expect(fundingState(half)).toMatchObject({ accepting: true, percent: 50, label: "50% funded" });
  });

  it("closes funding once the facility draws and says why", () => {
    const labels: Array<[Facility["stage"], string]> = [
      ["drawn", "Funding closed"],
      ["late", "Past due"],
      ["repaid", "Repaid · ready to claim"],
      ["settled", "Settled · complete"],
      ["defaulted", "In default"],
      ["recovered", "Recovery ready to claim"],
      ["closed", "Closed at loss"],
    ];
    for (const [stage, label] of labels) {
      const state = fundingState({ ...open, stage, supplied: 9, available: 0 });
      expect(state).toMatchObject({ accepting: false, available: 0, label });
    }
  });

  it("routes the market button by stage and by whether the wallet holds anything", () => {
    expect(marketAction(open)).toBe("View market");
    expect(marketAction({ ...open, stage: "drawn", available: 0 })).toBe("Funding closed");
    expect(marketAction({ ...open, stage: "drawn", available: 0, holding: { ...open.holding, value: 3 } })).toBe("View position");
    for (const stage of ["repaid", "recovered"] as const) expect(marketAction({ ...open, stage, available: 0, holding: { ...open.holding, value: 3 } })).toBe("Claim funds");
    for (const stage of ["settled", "closed"] as const) expect(marketAction({ ...open, stage, available: 0, holding: { ...open.holding, value: 0, supplied: 3 } })).toBe("View history");
  });

  it("counts a return only once the facility has paid out", () => {
    const held = { ...open, holding: { ...open.holding, value: 3.09, supplied: 3 } };
    expect(realizedReturn({ ...held, stage: "drawn" })).toBe(0);
    expect(realizedReturn({ ...held, stage: "defaulted" })).toBe(0);
    expect(realizedReturn({ ...held, stage: "repaid" })).toBeCloseTo(0.09);
    expect(realizedReturn({ ...held, stage: "recovered", holding: { ...held.holding, value: 1 } })).toBe(-2);
  });
});

describe("draftSizeFor", () => {
  it("uses testnet-scale drafts for an asset with a faucet", () => {
    expect(draftSizeFor(true)).toEqual({ min: 150_000, max: 600_000, step: 10_000 });
  });

  it("keeps drafts small when the asset is real money", () => {
    expect(draftSizeFor(false)).toEqual({ min: 10, max: 20, step: 1 });
  });
});

describe("tranche availability", () => {
  const open = (overrides: Partial<FacilityData> = {}) => toFacility(data({ terms: { ...data().terms, limit: 10n * U, firstLoss: 3n * U, capitalCap: 10n * U }, firstLossReserve: 3n * U, totalCapital: 3n * U, seniorCapacity: 6_750_000n, ...overrides }), { seniorShares: 0n, juniorShares: 0n });

  it("offers senior up to the ratio and junior up to the remaining capital cap", () => {
    const facility = open();
    expect(facility.seniorAvailable).toBe(6.75);
    expect(facility.juniorAvailable).toBe(7);
    expect(facility.available).toBe(7);
  });

  it("closes both tranches once the facility stops accepting capital", () => {
    const facility = open({ ...withStatus("Late"), dueAt: 100n });
    expect(facility.seniorAvailable).toBe(0);
    expect(facility.juniorAvailable).toBe(0);
  });

  it("raises senior capacity after junior arrives and never lets the cap be exceeded", () => {
    const facility = open({ juniorAssets: 1n * U, juniorTotalShares: 1n * U, totalCapital: 4n * U, seniorCapacity: 9_000_000n });
    expect(facility.seniorAvailable).toBe(6);
    expect(facility.juniorAvailable).toBe(6);
  });

  it("reads the structure from the contract data instead of a fixed senior only split", () => {
    const empty = open();
    expect(empty.juniorPct).toBeGreaterThan(0);
    expect(empty.firstLossPct).toBeCloseTo(30, 6);
    expect(empty.seniorPct + empty.juniorPct + empty.firstLossPct).toBeCloseTo(100, 6);
    const funded = open({ juniorAssets: 2n * U, juniorTotalShares: 2n * U, totalCapital: 5n * U, seniorCapacity: 11_250_000n });
    expect(funded.juniorPct).toBeCloseTo(20, 6);
    expect(funded.juniorSupplied).toBe(2);
  });
});

describe("originatorBook", () => {
  const facility = (originator: `0x${string}`) => toFacility(data({ originator }), { seniorShares: 0n, juniorShares: 0n });

  it("uses the connected originator's facilities, or the shared demo book when none belong to them", () => {
    const owned = facility(ORIGINATOR);
    const other = facility("0x00000000000000000000000000000000000000cc");
    expect(originatorBook([owned, other], ORIGINATOR)).toEqual([owned]);
    expect(originatorBook([owned, other], ADDRESS)).toEqual([owned, other]);
  });
});
