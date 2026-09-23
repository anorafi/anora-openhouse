import { describe, expect, it } from "vitest";
import type { FacilityData } from "../hooks/useFacilities";
import { durationText, fromUnits, stageOf, toFacility, toUnits, waterfallOf } from "./book";
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
  it("reads demo tenors in minutes and real ones in days", () => {
    expect(durationText(180)).toBe("3 min");
    expect(durationText(7_200)).toBe("2 hours");
    expect(durationText(90 * 86_400)).toBe("90 days");
  });
});

describe("stageOf", () => {
  it("walks the happy path from the facility's own state", () => {
    expect(stageOf(data())).toBe("open");
    expect(stageOf(data({ seniorAssets: 9n * U, seniorTotalShares: 9n * U }))).toBe("funded");
    expect(stageOf(data({ seniorAssets: 9n * U, seniorTotalShares: 9n * U, principal: 9n * U }))).toBe("drawn");
    expect(stageOf(data({ ...withStatus("Late"), principal: 9n * U }))).toBe("late");
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
    expect(facility.durationLabel).toBe("3 min");
  });

  it("offers only what senior capacity allows, since junior is not sold", () => {
    const facility = toFacility(data(), { seniorShares: 0n, juniorShares: 0n });
    expect(facility.available).toBe(13.5);
    expect(facility.reservePct).toBe(30);
  });

  it("stops offering capital once the facility has drawn", () => {
    const facility = toFacility(data({ principal: 9n * U, seniorAssets: 9n * U, seniorTotalShares: 9n * U }), { seniorShares: 0n, juniorShares: 0n });
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
