import { describe, expect, test } from "vitest";
import { FACILITY_DEFAULTS } from "./terms";
import { toUnits } from "./book";
import { planFacility, type FacilityPlanInput } from "./facilityPlan";

const base: FacilityPlanInput = {
  riskModel: false,
  faucet: true,
  limit: 10,
  firstLoss: 3,
  financingType: "Commodity finance",
  route: "Thailand → Philippines",
  tenorSeconds: 90 * 86_400,
  graceSeconds: 14 * 86_400,
};

function legacySeniorOpen(limit: number, firstLoss: number) {
  return Math.max(0, Math.min(limit - firstLoss, (firstLoss * FACILITY_DEFAULTS.seniorPerJuniorBps) / 10_000));
}

describe("planFacility with the risk model off", () => {
  test("is identical to the fixed 2.25x rule the screens used before", () => {
    for (const [limit, firstLoss] of [[10, 3], [10, 1], [300_000, 30_000], [100, 90], [5, 0.5], [1, 0.1]] as const) {
      const plan = planFacility({ ...base, limit, firstLoss });
      expect(plan.seniorPerJuniorBps).toBe(FACILITY_DEFAULTS.seniorPerJuniorBps);
      expect(plan.capitalCap).toBe(toUnits(limit));
      expect(plan.seniorOpen).toBe(legacySeniorOpen(limit, firstLoss));
    }
  });

  test("freezes no model", () => {
    const plan = planFacility(base);
    expect(plan.modelVersion).toBe(0);
    expect(plan.snapshotHash).toBeUndefined();
    expect(plan.blocked).toBe(false);
    expect(plan.reason).toBe("LEGACY");
  });

  test("ignores the financing type, route, and tenor", () => {
    const a = planFacility(base);
    const b = planFacility({ ...base, financingType: "Export receivables", route: "Myanmar → India", tenorSeconds: 400 * 86_400 });
    expect(a).toEqual(b);
  });
});

describe("planFacility with the risk model on", () => {
  const on = { ...base, riskModel: true };

  test("calculates the ratio and the cap per facility", () => {
    const plan = planFacility(on);
    expect(plan.modelVersion).toBe(1);
    expect(plan.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plan.seniorPerJuniorBps).not.toBe(FACILITY_DEFAULTS.seniorPerJuniorBps);
    expect(plan.capitalCap <= toUnits(on.limit)).toBe(true);
    expect(plan.seniorOpen).toBeGreaterThan(0);
  });

  test("recalculates when an existing field changes", () => {
    const a = planFacility(on);
    expect(planFacility({ ...on, firstLoss: 4 }).seniorOpen).not.toBe(a.seniorOpen);
    expect(planFacility({ ...on, tenorSeconds: 365 * 86_400 }).seniorOpen).not.toBe(a.seniorOpen);
    expect(planFacility({ ...on, financingType: "Supply-chain finance" }).seniorOpen).not.toBe(a.seniorOpen);
    expect(planFacility({ ...on, route: "Myanmar → India" }).seniorOpen).not.toBe(a.seniorOpen);
    expect(planFacility({ ...on, limit: 8 }).capitalCap).not.toBe(a.capitalCap);
  });

  test("gives identical output for identical input", () => {
    expect(planFacility(on)).toEqual(planFacility(on));
  });

  test("blocks a live listing that has no verified data", () => {
    const plan = planFacility({ ...on, faucet: false });
    expect(plan.blocked).toBe(true);
    expect(plan.seniorOpen).toBe(0);
    expect(plan.reason).toBe("UNVERIFIED_DATA_BLOCKED");
  });

  test("shows zero availability, not a block, when no structure is feasible on a test network", () => {
    const plan = planFacility({ ...on, firstLoss: 0.000001 });
    expect(plan.blocked).toBe(false);
    expect(plan.seniorOpen).toBe(0);
    expect(plan.seniorPerJuniorBps).toBe(0);
  });
});
