import { describe, expect, test } from "bun:test";
import { demoPlan, lockedInOpen, seniorCapacity, validatePlan, usdc } from "./demoPlan";

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
