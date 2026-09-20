import { describe, expect, it } from "vitest";
import { bpsToPct, secondsUntil, toPct, valueShares } from "./facility";

describe("toPct", () => {
  it("computes a percentage from a fraction of two bigints", () => {
    expect(toPct(2_000n, 20_000n)).toBe(10);
  });

  it("keeps two decimal places of precision", () => {
    expect(toPct(1n, 3n)).toBe(33.33);
  });

  it("returns zero when the denominator is zero", () => {
    expect(toPct(100n, 0n)).toBe(0);
  });
});

describe("bpsToPct", () => {
  it("converts basis points to a percentage", () => {
    expect(bpsToPct(1_000n)).toBe(10);
    expect(bpsToPct(200n)).toBe(2);
    expect(bpsToPct(22_500n)).toBe(225);
  });
});

describe("valueShares", () => {
  it("values shares pro rata against tranche assets", () => {
    expect(valueShares(50n, 100n, 200n)).toBe(100n);
  });

  it("returns zero when there are no shares outstanding", () => {
    expect(valueShares(0n, 0n, 0n)).toBe(0n);
  });

  it("returns the full tranche when the caller holds all shares", () => {
    expect(valueShares(100n, 100n, 340n)).toBe(340n);
  });
});

describe("secondsUntil", () => {
  it("is positive before the target", () => {
    expect(secondsUntil(100n, 40n)).toBe(60);
  });

  it("is negative after the target", () => {
    expect(secondsUntil(40n, 100n)).toBe(-60);
  });

  it("is zero at the target", () => {
    expect(secondsUntil(100n, 100n)).toBe(0);
  });
});
