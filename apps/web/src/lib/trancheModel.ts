import { keccak256, toBytes, type Hex } from "viem";

const BPS = 10_000n;
const DAY = 86_400;

export interface ModelPolicy {
  version: number;
  varReserve: number;
  varSenior: number;
  tailSenior: number;
  recoveryWindowDays: number;
  dustUnits: bigint;
}

export const POLICY_V1: ModelPolicy = {
  version: 1,
  varReserve: 0.9,
  varSenior: 0.99,
  tailSenior: 0.02,
  recoveryWindowDays: 30,
  dustUnits: 10_000n,
};

export interface Underwriting {
  largestBuyerPct: number;
}

export interface AssumptionOverrides {
  severityMultiplier?: number;
  systemicShockProbability?: number;
  recoveryRate?: number;
  recoveryDelayDays?: number;
}

export interface PlanInput {
  limit: bigint;
  firstLoss: bigint;
  fundedJunior: bigint;
  financingType: string;
  route: string;
  tenorSeconds: number;
  graceSeconds: number;
  allowIllustrative: boolean;
  underwriting?: Underwriting;
  assumptions?: AssumptionOverrides;
}

export type PlanReason = "OK" | "NO_STAKE" | "INVALID_LIMIT" | "UNVERIFIED_DATA_BLOCKED" | "NO_FEASIBLE_STRUCTURE";

interface FinancingProfile {
  nonpay: number;
  recovery: number;
  delayDays: number;
  lateProbability: number;
  lateDays: number;
}

const FINANCING: Record<string, FinancingProfile> = {
  "Export receivables": { nonpay: 0.04, recovery: 0.6, delayDays: 45, lateProbability: 0.1, lateDays: 20 },
  "Supply-chain finance": { nonpay: 0.025, recovery: 0.7, delayDays: 30, lateProbability: 0.08, lateDays: 15 },
  "Commodity finance": { nonpay: 0.05, recovery: 0.5, delayDays: 60, lateProbability: 0.12, lateDays: 25 },
};

const CONSERVATIVE_PROFILE = FINANCING["Commodity finance"]!;

const COUNTRY_RISK: Record<string, number> = {
  Singapore: 0.8,
  Japan: 0.8,
  Netherlands: 0.8,
  Germany: 0.8,
  "United Kingdom": 0.8,
  "South Korea": 0.85,
  India: 1,
  Indonesia: 1,
  Vietnam: 1,
  Thailand: 1,
  Philippines: 1.05,
  Malaysia: 0.95,
  China: 0.95,
  Turkey: 1.2,
  Myanmar: 1.3,
  Pakistan: 1.3,
  Bangladesh: 1.25,
  "Sri Lanka": 1.2,
  Cambodia: 1.15,
  "United Arab Emirates": 0.85,
};

const UNKNOWN_COUNTRY_RISK = 1.2;
const BUYER_BUCKETS = 5;
const DEFAULT_LARGEST_BUYER = 0.4;
const RECOVERY_COST = 0.05;
const SYSTEMIC_DEFAULT_MULTIPLIER = 3;
const SYSTEMIC_LATE_MULTIPLIER = 2;
const DEFAULT_SYSTEMIC_SHOCK = 0.05;

function corridorMultiplier(route: string) {
  const parts = route.split(/→|->/).map((part) => part.trim());
  const buyerSide = COUNTRY_RISK[parts[parts.length - 1] ?? ""] ?? UNKNOWN_COUNTRY_RISK;
  const sellerSide = parts.length > 1 ? (COUNTRY_RISK[parts[0] ?? ""] ?? UNKNOWN_COUNTRY_RISK) : buyerSide;
  return 0.7 * buyerSide + 0.3 * sellerSide;
}

interface ResolvedAssumptions {
  label: string;
  financingType: string;
  profileKnown: boolean;
  nonpay: number;
  recovery: number;
  recoveryDelayDays: number;
  lateProbability: number;
  lateDays: number;
  recoveryCost: number;
  corridorMultiplier: number;
  tenorMultiplier: number;
  severityMultiplier: number;
  systemicShockProbability: number;
  systemicDefaultMultiplier: number;
  systemicLateMultiplier: number;
  largestBuyerShare: number;
  buyerBuckets: number;
  graceDays: number;
  recoveryWindowDays: number;
}

function resolve(input: PlanInput, policy: ModelPolicy): ResolvedAssumptions {
  const known = input.financingType in FINANCING;
  const profile = FINANCING[input.financingType] ?? CONSERVATIVE_PROFILE;
  const overrides = input.assumptions ?? {};
  const tenorDays = Math.max(0, input.tenorSeconds) / DAY;
  const largest = input.underwriting ? Math.min(1, Math.max(0.2, input.underwriting.largestBuyerPct / 100)) : DEFAULT_LARGEST_BUYER;
  return {
    label: input.underwriting ? "verified underwriting record with policy assumptions" : "illustrative demo assumptions, not calibrated default rates",
    financingType: known ? input.financingType : "unknown (treated as Commodity finance)",
    profileKnown: known,
    nonpay: profile.nonpay,
    recovery: overrides.recoveryRate ?? profile.recovery,
    recoveryDelayDays: overrides.recoveryDelayDays ?? profile.delayDays,
    lateProbability: profile.lateProbability,
    lateDays: profile.lateDays,
    recoveryCost: RECOVERY_COST,
    corridorMultiplier: corridorMultiplier(input.route),
    tenorMultiplier: 1 + 0.5 * Math.min(1, tenorDays / 360),
    severityMultiplier: overrides.severityMultiplier ?? 1,
    systemicShockProbability: overrides.systemicShockProbability ?? DEFAULT_SYSTEMIC_SHOCK,
    systemicDefaultMultiplier: SYSTEMIC_DEFAULT_MULTIPLIER,
    systemicLateMultiplier: SYSTEMIC_LATE_MULTIPLIER,
    largestBuyerShare: largest,
    buyerBuckets: BUYER_BUCKETS,
    graceDays: Math.max(0, input.graceSeconds) / DAY,
    recoveryWindowDays: policy.recoveryWindowDays,
  };
}

interface Outcome {
  loss: number;
  probability: number;
}

function collectedOnDefault(a: ResolvedAssumptions) {
  const delayFactor = a.recoveryDelayDays <= 0 ? 1 : Math.min(1, a.recoveryWindowDays / a.recoveryDelayDays);
  const recovered = a.recovery * (1 - a.recoveryCost) * delayFactor;
  return 1 - Math.min(1, (1 - recovered) * a.severityMultiplier);
}

function collectedWhenLate(a: ResolvedAssumptions) {
  if (a.lateDays <= 0) return 1;
  return Math.min(1, (a.graceDays + a.recoveryWindowDays) / a.lateDays);
}

function lossDistribution(a: ResolvedAssumptions): Outcome[] {
  const others = a.buyerBuckets - 1;
  const weights = [a.largestBuyerShare, ...Array.from({ length: others }, () => (1 - a.largestBuyerShare) / others)];
  const base = Math.min(1, a.nonpay * a.corridorMultiplier * a.tenorMultiplier);
  const lateBase = Math.min(1 - base, a.lateProbability * a.tenorMultiplier);
  const regimes = [
    { weight: 1 - a.systemicShockProbability, defaultP: base, lateP: lateBase },
    {
      weight: a.systemicShockProbability,
      defaultP: Math.min(1, base * a.systemicDefaultMultiplier),
      lateP: Math.min(1 - Math.min(1, base * a.systemicDefaultMultiplier), lateBase * a.systemicLateMultiplier),
    },
  ];
  const defaultLoss = 1 - collectedOnDefault(a);
  const lateLoss = 1 - collectedWhenLate(a);
  const merged = new Map<string, Outcome>();
  const states = 3 ** a.buyerBuckets;
  for (const regime of regimes) {
    if (regime.weight <= 0) continue;
    for (let state = 0; state < states; state++) {
      let rest = state;
      let probability = regime.weight;
      let loss = 0;
      for (let buyer = 0; buyer < a.buyerBuckets; buyer++) {
        const outcome = rest % 3;
        rest = Math.floor(rest / 3);
        if (outcome === 0) probability *= 1 - regime.defaultP - regime.lateP;
        else if (outcome === 1) {
          probability *= regime.lateP;
          loss += weights[buyer]! * lateLoss;
        } else {
          probability *= regime.defaultP;
          loss += weights[buyer]! * defaultLoss;
        }
      }
      if (probability <= 0) continue;
      const key = loss.toFixed(12);
      const existing = merged.get(key);
      if (existing) existing.probability += probability;
      else merged.set(key, { loss: Number(key), probability });
    }
  }
  return [...merged.values()].sort((x, y) => x.loss - y.loss);
}

const EPSILON = 1e-12;

function valueAtRisk(outcomes: Outcome[], alpha: number) {
  let cumulative = 0;
  for (const outcome of outcomes) {
    cumulative += outcome.probability;
    if (cumulative >= alpha - EPSILON) return outcome.loss;
  }
  return outcomes[outcomes.length - 1]?.loss ?? 0;
}

function conditionalValueAtRisk(outcomes: Outcome[], alpha: number) {
  const threshold = valueAtRisk(outcomes, alpha);
  const excess = outcomes.reduce((sum, outcome) => sum + outcome.probability * Math.max(0, outcome.loss - threshold), 0);
  return threshold + excess / (1 - alpha);
}

interface Structure {
  reserve: number;
  junior: number;
}

function constraintsHold(outcomes: Outcome[], policy: ModelPolicy, { reserve, junior }: Structure, senior: number) {
  const total = senior + junior;
  const reserveVar = total * valueAtRisk(outcomes, policy.varReserve);
  const seniorVar = total * valueAtRisk(outcomes, policy.varSenior);
  if (reserve < reserveVar - EPSILON || reserve + junior < seniorVar - EPSILON) return false;
  if (senior <= 0) return true;
  const excess = outcomes.map((outcome) => ({ loss: Math.max(0, total * outcome.loss - reserve - junior), probability: outcome.probability }));
  excess.sort((x, y) => x.loss - y.loss);
  return conditionalValueAtRisk(excess, policy.varSenior) / senior <= policy.tailSenior + EPSILON;
}

function largestSafeSenior(outcomes: Outcome[], policy: ModelPolicy, structure: Structure, ceiling: number) {
  if (ceiling <= 0) return 0;
  const reserveQuantile = valueAtRisk(outcomes, policy.varReserve);
  const seniorQuantile = valueAtRisk(outcomes, policy.varSenior);
  const byReserve = reserveQuantile > 0 ? structure.reserve / reserveQuantile - structure.junior : Infinity;
  const byCover = seniorQuantile > 0 ? (structure.reserve + structure.junior) / seniorQuantile - structure.junior : Infinity;
  const upper = Math.min(ceiling, byReserve, byCover);
  if (upper <= 0) return 0;
  if (constraintsHold(outcomes, policy, structure, upper)) return upper;
  let low = 0;
  let high = upper;
  for (let step = 0; step < 80; step++) {
    const middle = (low + high) / 2;
    if (constraintsHold(outcomes, policy, structure, middle)) low = middle;
    else high = middle;
  }
  return low;
}

export interface Snapshot {
  modelVersion: number;
  dataQuality: "verified" | "illustrative";
  policy: { version: number; varReserve: number; varSenior: number; tailSenior: number; recoveryWindowDays: number; dustUnits: string };
  inputs: {
    limit: string;
    firstLoss: string;
    fundedJunior: string;
    financingType: string;
    route: string;
    tenorSeconds: number;
    graceSeconds: number;
    largestBuyerPct: number | null;
  };
  assumptions: ResolvedAssumptions;
  outputs: {
    firstLoss: string;
    junior: string;
    senior: string;
    seniorCapacity: string;
    seniorPerJuniorBps: string;
    capitalCap: string;
    attachment: { firstLossEnd: number; juniorEnd: number };
  };
  eligibility: { feasible: boolean; reason: PlanReason };
}

export interface TranchePlan {
  modelVersion: number;
  feasible: boolean;
  reason: PlanReason;
  firstLoss: bigint;
  junior: bigint;
  senior: bigint;
  seniorCapacity: bigint;
  seniorPerJuniorBps: bigint;
  capitalCap: bigint;
  snapshot: Snapshot;
  snapshotHash: Hex;
}

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function snapshotHashOf(snapshot: Snapshot): Hex {
  return keccak256(toBytes(JSON.stringify(canonical(snapshot))));
}

export function planTranches(input: PlanInput, policy: ModelPolicy = POLICY_V1): TranchePlan {
  const assumptions = resolve(input, policy);
  const dataQuality = input.underwriting ? "verified" : "illustrative";
  const stake = input.firstLoss;
  const junior = input.fundedJunior;

  let reason: PlanReason = "OK";
  let senior = 0n;
  if (input.limit <= 0n || stake > input.limit) reason = "INVALID_LIMIT";
  else if (stake <= 0n) reason = "NO_STAKE";
  else if (!input.underwriting && !input.allowIllustrative) reason = "UNVERIFIED_DATA_BLOCKED";
  else {
    const room = input.limit - stake - junior;
    const ceiling = room > 0n ? Number(room) : 0;
    const outcomes = lossDistribution(assumptions);
    const safe = largestSafeSenior(outcomes, policy, { reserve: Number(stake), junior: Number(junior) }, ceiling);
    senior = BigInt(Math.floor(safe));
    if (senior < policy.dustUnits) {
      senior = 0n;
      reason = "NO_FEASIBLE_STRUCTURE";
    }
  }

  const feasible = reason === "OK";
  const protection = stake + junior;
  const seniorPerJuniorBps = feasible && protection > 0n ? (senior * BPS) / protection : 0n;
  const capitalCap = feasible ? stake + junior + senior : 0n;
  const spread = stake + junior + senior;
  const attachment = {
    firstLossEnd: spread > 0n ? Number(stake) / Number(spread) : 0,
    juniorEnd: spread > 0n ? Number(stake + junior) / Number(spread) : 0,
  };
  const snapshot: Snapshot = {
    modelVersion: policy.version,
    dataQuality,
    policy: {
      version: policy.version,
      varReserve: policy.varReserve,
      varSenior: policy.varSenior,
      tailSenior: policy.tailSenior,
      recoveryWindowDays: policy.recoveryWindowDays,
      dustUnits: policy.dustUnits.toString(),
    },
    inputs: {
      limit: input.limit.toString(),
      firstLoss: stake.toString(),
      fundedJunior: junior.toString(),
      financingType: input.financingType,
      route: input.route,
      tenorSeconds: input.tenorSeconds,
      graceSeconds: input.graceSeconds,
      largestBuyerPct: input.underwriting?.largestBuyerPct ?? null,
    },
    assumptions,
    outputs: {
      firstLoss: stake.toString(),
      junior: junior.toString(),
      senior: "0",
      seniorCapacity: senior.toString(),
      seniorPerJuniorBps: seniorPerJuniorBps.toString(),
      capitalCap: capitalCap.toString(),
      attachment,
    },
    eligibility: { feasible, reason },
  };
  return {
    modelVersion: policy.version,
    feasible,
    reason,
    firstLoss: stake,
    junior,
    senior: 0n,
    seniorCapacity: senior,
    seniorPerJuniorBps,
    capitalCap,
    snapshot,
    snapshotHash: snapshotHashOf(snapshot),
  };
}
