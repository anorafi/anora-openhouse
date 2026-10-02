import { describe, expect, test } from "bun:test";
import { demoPlan, lockedInOpen, seniorCapacity, sizedPlan, validatePlan, usdc } from "./demoPlan";

describe("demoPlan", () => {
  for (const chain of ["robinhood", "sepolia"] as const) {
    const plan = demoPlan(chain);

    test(`${chain} has three open facilities with the requested metadata mix`, () => {
      const open = plan.filter((spec) => spec.kind === "open");
      expect(open).toHaveLength(3);
      expect(open.filter((spec) => spec.metadata === "anchored")).toHaveLength(chain === "robinhood" ? 2 : 1);
      expect(open.filter((spec) => spec.metadata === "pending")).toHaveLength(chain === "robinhood" ? 0 : 1);
      expect(open.filter((spec) => spec.metadata === null)).toHaveLength(1);
    });

    test(`${chain} covers active, late, recovered, and repaid`, () => {
      const kinds = plan.map((spec) => spec.kind);
      for (const kind of ["active", "late", "recovered", "repaid"]) expect(kinds).toContain(kind);
    });

    test(`${chain} respects the protocol floor and the Senior capacity`, () => {
      expect(() => validatePlan(plan)).not.toThrow();
      for (const spec of plan) {
        expect(spec.firstLoss * 10).toBeGreaterThanOrEqual(spec.limit);
        expect(spec.senior).toBeLessThanOrEqual(seniorCapacity(spec.firstLoss, spec.junior));
        expect(spec.junior + spec.senior + spec.firstLoss).toBeLessThanOrEqual(spec.limit);
        expect(spec.draw).toBeLessThanOrEqual(spec.junior + spec.senior);
      }
    });

    test(`${chain} facility names are unique and carry no separator`, () => {
      const names = plan.map((spec) => spec.name);
      expect(new Set(names).size).toBe(names.length);
      for (const spec of plan) expect([spec.name, spec.company, spec.route, spec.type, spec.icon].some((value) => value.includes("|"))).toBe(false);
    });
  }

  test("robinhood locks at most 2 USDG in open facilities", () => {
    expect(lockedInOpen(demoPlan("robinhood"))).toBeLessThanOrEqual(usdc(2));
  });

  test("validatePlan rejects a first loss under the floor", () => {
    const plan = demoPlan("robinhood");
    plan[0] = { ...plan[0], firstLoss: 1 };
    expect(() => validatePlan(plan)).toThrow();
  });

  test("late and recovered use second-scale tenors, the others use days", () => {
    for (const spec of demoPlan("robinhood")) {
      if (spec.kind === "late" || spec.kind === "recovered") expect(spec.tenorSeconds).toBeLessThanOrEqual(300);
      else expect(spec.tenorSeconds).toBeGreaterThanOrEqual(30 * 86_400);
    }
  });
});

describe("sizedPlan", () => {
  const plan = sizedPlan("sepolia");

  test("has three open facilities of 20,000 with 4,000 first-loss and room in both tranches", () => {
    const open = plan.filter((spec) => spec.kind === "open");
    expect(open).toHaveLength(3);
    for (const spec of open) {
      expect(spec.limit).toBe(usdc(20_000));
      expect(spec.firstLoss).toBe(usdc(4_000));
      expect(seniorCapacity(spec.firstLoss, 0)).toBe(usdc(9_000));
      expect(spec.limit - spec.firstLoss).toBeGreaterThanOrEqual(usdc(10_000));
    }
  });

  test("keeps the metadata mix of one anchored, one pending, and one sample", () => {
    const open = plan.filter((spec) => spec.kind === "open");
    expect(open.filter((spec) => spec.metadata === "anchored")).toHaveLength(1);
    expect(open.filter((spec) => spec.metadata === "pending")).toHaveLength(1);
    expect(open.filter((spec) => spec.metadata === null)).toHaveLength(1);
  });

  test("has two spare late facilities that can be defaulted at once and one spare active facility", () => {
    const late = plan.filter((spec) => spec.kind === "late");
    const active = plan.filter((spec) => spec.kind === "active");
    expect(late).toHaveLength(2);
    expect(active).toHaveLength(1);
    for (const spec of late) {
      expect(spec.tenorSeconds).toBeLessThanOrEqual(300);
      expect(spec.graceSeconds).toBeLessThanOrEqual(120);
      expect(spec.draw).toBeGreaterThan(0);
    }
    expect(active[0].tenorSeconds).toBeGreaterThanOrEqual(30 * 86_400);
    expect(active[0].draw).toBeGreaterThan(0);
  });

  test("leaves the spare transitions to the recording: nothing is recovered or repaid", () => {
    const kinds = plan.map((spec) => spec.kind);
    expect(kinds).not.toContain("recovered");
    expect(kinds).not.toContain("repaid");
  });

  test("respects the protocol floor and the Senior capacity", () => {
    expect(() => validatePlan(plan)).not.toThrow();
  });

  test("uses names that do not clash with the curated plan", () => {
    const curated = new Set(demoPlan("sepolia").map((spec) => spec.name));
    const names = plan.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(curated.has(name)).toBe(false);
    for (const spec of plan) expect([spec.name, spec.company, spec.route, spec.type, spec.icon].some((value) => value.includes("|"))).toBe(false);
  });

  test("is not offered for real money", () => {
    expect(() => sizedPlan("robinhood")).toThrow();
  });
});
