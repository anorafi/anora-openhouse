import { describe, expect, it } from "vitest";
import { holdingTranches, trancheIndex, trancheProtectionCopy, trancheReturn, trancheStructure } from "./tranche";

const input = { limit: 10, firstLoss: 3, seniorPerJuniorBps: 22_500, seniorAssets: 0, juniorAssets: 0 };

describe("trancheStructure", () => {
  it("allocates the whole limit with the junior the contract ratio needs", () => {
    const s = trancheStructure(input);
    expect(s.firstLossPct).toBeCloseTo(30, 6);
    expect(s.juniorPct).toBeCloseTo(0.769, 2);
    expect(s.seniorPct).toBeCloseTo(69.231, 2);
    expect(s.firstLossPct + s.juniorPct + s.seniorPct).toBeCloseTo(100, 6);
    expect(s.senior).toBeCloseTo(2.25 * (s.junior + s.firstLoss), 6);
  });

  it("follows supplied junior once it exceeds what the ratio needs", () => {
    const s = trancheStructure({ ...input, juniorAssets: 2 });
    expect(s.juniorPct).toBeCloseTo(20, 6);
    expect(s.seniorPct).toBeCloseTo(50, 6);
    expect(s.firstLossPct + s.juniorPct + s.seniorPct).toBeCloseTo(100, 6);
  });

  it("shows no junior when the first loss alone carries the senior", () => {
    const s = trancheStructure({ ...input, firstLoss: 4 });
    expect(s.juniorPct).toBe(0);
    expect(s.seniorPct).toBeCloseTo(60, 6);
  });

  it("reports what is supplied per tranche next to the structure", () => {
    const s = trancheStructure({ ...input, seniorAssets: 6, juniorAssets: 1 });
    expect(s.seniorSupplied).toBe(6);
    expect(s.juniorSupplied).toBe(1);
  });

  it("handles a zero limit without dividing by zero", () => {
    const s = trancheStructure({ ...input, limit: 0 });
    expect(s.seniorPct).toBe(0);
    expect(s.juniorPct).toBe(0);
    expect(s.firstLossPct).toBe(0);
  });
});

describe("trancheReturn", () => {
  const base = { feePct: 5, seniorFeeShareBps: 6_000, seniorAssets: 0, juniorAssets: 0 };

  it("gives senior the whole fee while no junior exists", () => {
    expect(trancheReturn({ ...base, tranche: "senior", amount: 6 })).toBeCloseTo(5, 6);
  });

  it("splits the fee by the senior share once junior exists", () => {
    expect(trancheReturn({ ...base, tranche: "senior", amount: 6, juniorAssets: 2 })).toBeCloseTo(5 * 0.6 * 8 / 6, 6);
    expect(trancheReturn({ ...base, tranche: "junior", amount: 2, seniorAssets: 6 })).toBeCloseTo(5 * 0.4 * 8 / 2, 6);
  });

  it("counts the deposit being made on the tranche it joins", () => {
    const small = trancheReturn({ ...base, tranche: "junior", amount: 1, seniorAssets: 6 });
    const large = trancheReturn({ ...base, tranche: "junior", amount: 3, seniorAssets: 6 });
    expect(small).toBeGreaterThan(large);
  });

  it("is zero without an amount", () => {
    expect(trancheReturn({ ...base, tranche: "senior", amount: 0 })).toBe(0);
    expect(trancheReturn({ ...base, tranche: "junior", amount: 0 })).toBe(0);
  });
});

describe("trancheIndex", () => {
  it("maps each tranche to the contract enum value", () => {
    expect(trancheIndex("senior")).toBe(0);
    expect(trancheIndex("junior")).toBe(1);
  });
});

describe("trancheProtectionCopy", () => {
  it("describes the protection actually ahead of the selected tranche", () => {
    expect(trancheProtectionCopy("junior", 2)).toMatch(/first-loss stake.*before Junior.*before Senior/i);
    expect(trancheProtectionCopy("senior", 2)).toMatch(/first-loss stake and funded Junior capital.*before Senior/i);
    expect(trancheProtectionCopy("senior", 0)).not.toMatch(/Junior capital/);
  });
});

describe("holdingTranches", () => {
  it("names the tranches a wallet holds shares in", () => {
    expect(holdingTranches({ seniorShares: 5n, juniorShares: 0n })).toBe("Senior");
    expect(holdingTranches({ seniorShares: 0n, juniorShares: 2n })).toBe("Junior");
    expect(holdingTranches({ seniorShares: 5n, juniorShares: 2n })).toBe("Senior and Junior");
    expect(holdingTranches({ seniorShares: 0n, juniorShares: 0n })).toBe("");
  });
});
