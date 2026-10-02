import { describe, expect, test } from "vitest";
import {
  FACILITY_DEFAULTS,
  GRACE_PRESETS,
  TENOR_PRESETS,
  defaultTerms,
  termsLabel,
  termsValid,
  toSeconds,
} from "./terms";

describe("toSeconds", () => {
  test("converts days to seconds for the contract", () => {
    expect(toSeconds(1, "days")).toBe(86_400);
    expect(toSeconds(90, "days")).toBe(7_776_000);
  });

  test("converts demo minutes to seconds", () => {
    expect(toSeconds(2, "minutes")).toBe(120);
  });
});

describe("presets", () => {
  test("offers the usual trade-finance tenors and grace periods in days", () => {
    expect(TENOR_PRESETS.days).toEqual([30, 60, 90, 120]);
    expect(GRACE_PRESETS.days).toEqual([7, 14, 30]);
  });

  test("offers short demo presets in minutes", () => {
    expect(TENOR_PRESETS.minutes).toEqual([2, 3, 5]);
    expect(GRACE_PRESETS.minutes).toEqual([1, 2]);
  });
});

describe("defaultTerms", () => {
  test("starts on a real tenor in days", () => {
    expect(defaultTerms("days")).toEqual({ unit: "days", duration: "90", grace: "14" });
  });

  test("starts a demo tenor at two minutes with one minute of grace", () => {
    expect(defaultTerms("minutes")).toEqual({ unit: "minutes", duration: "2", grace: "1" });
  });
});

describe("termsLabel", () => {
  test("always names the unit", () => {
    expect(termsLabel({ unit: "days", duration: "90", grace: "14" })).toBe("90 days, then 14 days grace");
    expect(termsLabel({ unit: "minutes", duration: "2", grace: "1" })).toBe("2 minutes, then 1 minute grace");
  });
});

describe("termsValid", () => {
  test("needs a positive duration and a non-negative grace", () => {
    expect(termsValid({ unit: "days", duration: "90", grace: "14" })).toBe(true);
    expect(termsValid({ unit: "days", duration: "90", grace: "0" })).toBe(true);
    expect(termsValid({ unit: "days", duration: "0", grace: "14" })).toBe(false);
    expect(termsValid({ unit: "days", duration: "", grace: "14" })).toBe(false);
    expect(termsValid({ unit: "days", duration: "90", grace: "" })).toBe(false);
  });
});

describe("facility defaults", () => {
  test("keeps the economics shown in the form in one place", () => {
    expect(FACILITY_DEFAULTS.lateFeePerDayBps).toBe(10);
    expect(FACILITY_DEFAULTS.seniorPerJuniorBps).toBe(22_500);
    expect(FACILITY_DEFAULTS.seniorFeeShareBps).toBe(6_000);
  });
});
