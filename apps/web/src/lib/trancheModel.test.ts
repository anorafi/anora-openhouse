import { describe, expect, test } from "vitest";
import { POLICY_V1, planTranches, type PlanInput } from "./trancheModel";

const USDC = 1_000_000n;

const base: PlanInput = {
  limit: 100n * USDC,
  firstLoss: 30n * USDC,
  fundedJunior: 0n,
  financingType: "Commodity finance",
  route: "Thailand → Philippines",
  tenorSeconds: 90 * 86_400,
  graceSeconds: 14 * 86_400,
  allowIllustrative: true,
};

const plan = (patch: Partial<PlanInput> = {}) => planTranches({ ...base, ...patch });

describe("planTranches fixtures", () => {
  test("zero stake gives no capacity and says why", () => {
    const result = plan({ firstLoss: 0n });
    expect(result.feasible).toBe(false);
    expect(result.reason).toBe("NO_STAKE");
    expect(result.seniorCapacity).toBe(0n);
    expect(result.capitalCap).toBe(0n);
  });

  test("a stake too small for any protected Senior gives no feasible structure", () => {
    const result = plan({ firstLoss: 1n });
    expect(result.feasible).toBe(false);
    expect(result.reason).toBe("NO_FEASIBLE_STRUCTURE");
    expect(result.seniorCapacity).toBe(0n);
  });

  test("a healthy stake gives a feasible structure with positive Senior capacity", () => {
    const result = plan();
    expect(result.feasible).toBe(true);
    expect(result.reason).toBe("OK");
    expect(result.seniorCapacity > 0n).toBe(true);
    expect(result.seniorPerJuniorBps > 0n).toBe(true);
  });

  test("capital cap is the stake plus Senior capacity and never exceeds the limit", () => {
    const result = plan();
    expect(result.capitalCap).toBe(result.firstLoss + result.seniorCapacity);
    expect(result.capitalCap <= base.limit).toBe(true);
  });

  test("Senior capacity never exceeds the room left under the limit", () => {
    const result = plan({ limit: 40n * USDC, firstLoss: 30n * USDC });
    expect(result.seniorCapacity <= 10n * USDC).toBe(true);
    expect(result.capitalCap <= 40n * USDC).toBe(true);
  });

  test("the contract ratio reproduces the planned Senior capacity from the stake alone", () => {
    const result = plan();
    const fromRatio = (result.firstLoss * result.seniorPerJuniorBps) / 10_000n;
    expect(fromRatio <= result.seniorCapacity).toBe(true);
    expect(result.seniorCapacity - fromRatio <= result.firstLoss / 10_000n + 1n).toBe(true);
  });

  test("rounding stays in integer token units and never rounds capacity up", () => {
    const odd = plan({ firstLoss: 29_999_999n, limit: 99_999_999n });
    expect(typeof odd.seniorCapacity).toBe("bigint");
    expect(odd.seniorCapacity >= 0n).toBe(true);
    expect(odd.firstLoss + odd.seniorCapacity <= 99_999_999n).toBe(true);
  });

  test("missing underwriting data on a live network blocks the listing", () => {
    const result = plan({ allowIllustrative: false });
    expect(result.feasible).toBe(false);
    expect(result.reason).toBe("UNVERIFIED_DATA_BLOCKED");
    expect(result.seniorCapacity).toBe(0n);
  });

  test("verified underwriting data is accepted on a live network", () => {
    const result = plan({ allowIllustrative: false, underwriting: { largestBuyerPct: 25 } });
    expect(result.reason).toBe("OK");
    expect(result.snapshot.dataQuality).toBe("verified");
  });

  test("illustrative data is labelled in the snapshot", () => {
    const result = plan();
    expect(result.snapshot.dataQuality).toBe("illustrative");
    expect(result.snapshot.assumptions.label).toContain("illustrative");
  });

  test("correlated buyer defaults shrink capacity compared with independent ones", () => {
    const independent = plan({ assumptions: { systemicShockProbability: 0 } });
    const correlated = plan({ assumptions: { systemicShockProbability: 0.2 } });
    expect(correlated.seniorCapacity < independent.seniorCapacity).toBe(true);
  });

  test("a recovery that arrives after the window shrinks capacity", () => {
    const quick = plan({ assumptions: { recoveryDelayDays: 10 } });
    const slow = plan({ assumptions: { recoveryDelayDays: 120 } });
    expect(slow.seniorCapacity < quick.seniorCapacity).toBe(true);
  });

  test("a late but recoverable invoice is treated differently from a permanent default", () => {
    const recoverable = plan({ assumptions: { recoveryRate: 0.9, recoveryDelayDays: 20 } });
    const permanent = plan({ assumptions: { recoveryRate: 0, recoveryDelayDays: 20 } });
    expect(recoverable.seniorCapacity > permanent.seniorCapacity).toBe(true);
  });

  test("funded Junior is counted, theoretical Junior is not", () => {
    const none = plan();
    const funded = plan({ fundedJunior: 5n * USDC });
    expect(funded.junior).toBe(5n * USDC);
    expect(none.junior).toBe(0n);
    expect(none.snapshot.inputs.fundedJunior).toBe("0");
  });
});

describe("planTranches named fixture shared with the contract tests", () => {
  test("a commodity facility at a 30 percent stake plans a ratio of 21,880 bps and a cap of 95,642,572 units", () => {
    const result = plan();
    expect(result.seniorPerJuniorBps).toBe(21_880n);
    expect(result.capitalCap).toBe(95_642_572n);
    expect(result.seniorCapacity).toBe(65_642_572n);
  });
});

describe("planTranches determinism and snapshot", () => {
  test("identical inputs and policy produce identical output and hash", () => {
    const a = plan();
    const b = plan();
    expect(a.seniorCapacity).toBe(b.seniorCapacity);
    expect(a.seniorPerJuniorBps).toBe(b.seniorPerJuniorBps);
    expect(a.snapshotHash).toBe(b.snapshotHash);
  });

  test("the snapshot carries the model version, policy, inputs, assumptions, and outputs", () => {
    const result = plan();
    expect(result.modelVersion).toBe(POLICY_V1.version);
    expect(result.snapshot.policy.version).toBe(POLICY_V1.version);
    expect(result.snapshot.inputs.firstLoss).toBe(base.firstLoss.toString());
    expect(result.snapshot.outputs.seniorCapacity).toBe(result.seniorCapacity.toString());
    expect(result.snapshot.outputs.capitalCap).toBe(result.capitalCap.toString());
    expect(result.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("a different input changes the snapshot hash", () => {
    expect(plan().snapshotHash).not.toBe(plan({ tenorSeconds: 120 * 86_400 }).snapshotHash);
  });

  test("an infeasible plan still carries a reason and a hash", () => {
    const result = plan({ firstLoss: 0n });
    expect(result.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.snapshot.eligibility.reason).toBe("NO_STAKE");
  });
});

function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe("planTranches monotonic risk properties", () => {
  const random = lcg(41);
  const types = ["Export receivables", "Supply-chain finance", "Commodity finance"];
  const routes = ["Indonesia → Singapore", "Myanmar → India", "Vietnam → South Korea", "Nowhere → Elsewhere"];

  function sample() {
    return {
      financingType: types[Math.floor(random() * types.length)]!,
      route: routes[Math.floor(random() * routes.length)]!,
      firstLoss: BigInt(Math.floor(5 + random() * 60)) * USDC,
      limit: 100n * USDC,
      tenorSeconds: Math.floor(15 + random() * 150) * 86_400,
      graceSeconds: Math.floor(1 + random() * 30) * 86_400,
    };
  }

  test("a higher severity never increases Senior capacity", () => {
    for (let run = 0; run < 40; run++) {
      const input = sample();
      const low = plan({ ...input, assumptions: { severityMultiplier: 1 } });
      const high = plan({ ...input, assumptions: { severityMultiplier: 1.5 + random() } });
      expect(high.seniorCapacity <= low.seniorCapacity).toBe(true);
    }
  });

  test("a higher buyer concentration never increases Senior capacity", () => {
    for (let run = 0; run < 40; run++) {
      const input = sample();
      const spread = plan({ ...input, allowIllustrative: false, underwriting: { largestBuyerPct: 20 } });
      const concentrated = plan({ ...input, allowIllustrative: false, underwriting: { largestBuyerPct: 20 + 10 + random() * 60 } });
      expect(concentrated.seniorCapacity <= spread.seniorCapacity).toBe(true);
    }
  });

  test("a longer tenor never increases Senior capacity", () => {
    for (let run = 0; run < 40; run++) {
      const input = sample();
      const short = plan({ ...input, tenorSeconds: 30 * 86_400 });
      const long = plan({ ...input, tenorSeconds: (60 + Math.floor(random() * 300)) * 86_400 });
      expect(long.seniorCapacity <= short.seniorCapacity).toBe(true);
    }
  });

  test("a longer recovery delay never increases Senior capacity", () => {
    for (let run = 0; run < 40; run++) {
      const input = sample();
      const quick = plan({ ...input, assumptions: { recoveryDelayDays: 10 } });
      const slow = plan({ ...input, assumptions: { recoveryDelayDays: 11 + Math.floor(random() * 300) } });
      expect(slow.seniorCapacity <= quick.seniorCapacity).toBe(true);
    }
  });

  test("a bigger stake never reduces Senior capacity", () => {
    for (let run = 0; run < 40; run++) {
      const input = sample();
      const roomy = { ...input, limit: 10_000n * USDC };
      const small = plan({ ...roomy, firstLoss: 10n * USDC });
      const big = plan({ ...roomy, firstLoss: (11n + BigInt(Math.floor(random() * 40))) * USDC });
      expect(big.seniorCapacity >= small.seniorCapacity).toBe(true);
    }
  });
});
