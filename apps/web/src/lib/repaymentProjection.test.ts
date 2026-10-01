import { expect, it } from "vitest";
import { repaymentProjection } from "./repaymentProjection";
import type { Facility } from "./book";

const DAY = 86400000;
const held = (value: number) => ({ seniorShares: 0n, juniorShares: 0n, value, supplied: 100 });

it("reconciles portfolio value and adds only scheduled returns without duplicating principal", () => {
  const now = 1000000000;
  const base = { name: "Trade", targetReturn: 10, dueAt: now + 60 * DAY, holding: held(100) } as Facility;
  const facilities: Facility[] = [
    { ...base, stage: "drawn" },
    { ...base, stage: "funded" },
    { ...base, stage: "defaulted", holding: held(20) },
    { ...base, stage: "settled", holding: held(0) },
    { ...base, stage: "repaid", holding: held(110) },
    { ...base, stage: "drawn", dueAt: now - 40 * DAY },
  ];
  expect(repaymentProjection(facilities, 30, now).slice(-1)[0]?.value).toBe(430);
  const forecast = repaymentProjection(facilities, 90, now);
  expect(forecast[0].value).toBe(430);
  expect(forecast.slice(-1)[0]?.value).toBeCloseTo(450);
  expect(forecast.slice(-1)[0]?.principal).toBe(200);
  expect(forecast.slice(-1)[0]?.returns).toBeCloseTo(20);
  expect(repaymentProjection([], 90, now).slice(-1)[0]?.value).toBe(0);
});

it("does not schedule returns on a past-due facility", () => {
  const now = 1000000000;
  const late = { name: "Late", stage: "late", targetReturn: 10, dueAt: now + 5 * DAY, holding: held(100) } as Facility;
  const forecast = repaymentProjection([late], 30, now);
  expect(forecast[0].value).toBe(100);
  expect(forecast.slice(-1)[0]?.value).toBe(100);
});

it("updates today's balance and projected returns after a new supply or top-up", () => {
  const now = 1000000000;
  const position = { name: "New trade", stage: "funded", targetReturn: 8.5, dueAt: now + 60 * DAY, holding: held(120000) } as Facility;
  const initial = repaymentProjection([position], 90, now);
  expect(initial[0].value).toBe(120000);
  expect(initial.slice(-1)[0]?.value).toBe(130200);
  const toppedUp = repaymentProjection([{ ...position, holding: held(150000) }], 90, now);
  expect(toppedUp[0].value).toBe(150000);
  expect(toppedUp.slice(-1)[0]?.value).toBe(162750);
  expect(repaymentProjection([{ ...position, stage: "settled", holding: held(0) }], 90, now).slice(-1)[0]?.value).toBe(0);
});
