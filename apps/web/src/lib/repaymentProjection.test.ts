import { expect, it } from "vitest";
import { repaymentProjection } from "./repaymentProjection";
import type { Facility } from "../state/demo";

it("reconciles portfolio value and adds only scheduled returns without duplicating principal", () => {
  const now = 1000000000;
  const base = { name: "Trade", drawn: 100, supplied: 100, targetReturn: 10, openedAt: now, durationDays: 60, repaid: 0, recovered: 0, firstLoss: 20 } as Facility;
  const facilities: Facility[] = [
    { ...base, stage: "drawn" },
    { ...base, stage: "funded" },
    { ...base, stage: "defaulted" },
    { ...base, stage: "settled", repaid: 110 },
    { ...base, stage: "repaid", repaid: 110 },
    { ...base, stage: "drawn", openedAt: now - 100 * 86400000 },
  ];
  expect(repaymentProjection(facilities, 30, now).slice(-1)[0]?.value).toBe(430);
  const forecast = repaymentProjection(facilities, 90, now);
  expect(forecast[0].value).toBe(430);
  expect(forecast.slice(-1)[0]?.value).toBeCloseTo(450);
  expect(forecast.slice(-1)[0]?.principal).toBe(200);
  expect(forecast.slice(-1)[0]?.returns).toBeCloseTo(20);
  expect(repaymentProjection([], 90, now).slice(-1)[0]?.value).toBe(0);
});

it("updates today's balance and projected returns after a new supply or top-up", () => {
  const now = 1000000000;
  const position = { name: "New trade", stage: "funded", supplied: 120000, drawn: 0, repaid: 0, targetReturn: 8.5, openedAt: now, durationDays: 60 } as Facility;
  const initial = repaymentProjection([position], 90, now);
  expect(initial[0].value).toBe(120000);
  expect(initial.slice(-1)[0]?.value).toBe(130200);
  const toppedUp = repaymentProjection([{ ...position, supplied: 150000 }], 90, now);
  expect(toppedUp[0].value).toBe(150000);
  expect(toppedUp.slice(-1)[0]?.value).toBe(162750);
  expect(repaymentProjection([{ ...position, stage: "settled" }], 90, now).slice(-1)[0]?.value).toBe(0);
});
