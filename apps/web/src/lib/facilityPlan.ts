import type { Hex } from "viem";
import { fromUnits, toUnits } from "./book";
import { FACILITY_DEFAULTS } from "./terms";
import { planTranches, type PlanReason } from "./trancheModel";

export interface FacilityPlanInput {
  riskModel: boolean;
  faucet: boolean;
  limit: number;
  firstLoss: number;
  financingType: string;
  route: string;
  tenorSeconds: number;
  graceSeconds: number;
}

export interface FacilityPlan {
  seniorPerJuniorBps: number;
  capitalCap: bigint;
  seniorOpen: number;
  modelVersion: number;
  snapshotHash: Hex | undefined;
  blocked: boolean;
  reason: PlanReason | "LEGACY";
}

export function planFacility(input: FacilityPlanInput): FacilityPlan {
  const limit = toUnits(input.limit);
  if (!input.riskModel) {
    const open = Math.max(0, Math.min(input.limit - input.firstLoss, (input.firstLoss * FACILITY_DEFAULTS.seniorPerJuniorBps) / 10_000));
    return {
      seniorPerJuniorBps: FACILITY_DEFAULTS.seniorPerJuniorBps,
      capitalCap: limit,
      seniorOpen: open,
      modelVersion: 0,
      snapshotHash: undefined,
      blocked: false,
      reason: "LEGACY",
    };
  }
  const plan = planTranches({
    limit,
    firstLoss: toUnits(input.firstLoss),
    fundedJunior: 0n,
    financingType: input.financingType,
    route: input.route,
    tenorSeconds: input.tenorSeconds,
    graceSeconds: input.graceSeconds,
    allowIllustrative: input.faucet,
  });
  return {
    seniorPerJuniorBps: Number(plan.seniorPerJuniorBps),
    capitalCap: plan.feasible ? plan.capitalCap : limit,
    seniorOpen: fromUnits(plan.seniorCapacity),
    modelVersion: plan.modelVersion,
    snapshotHash: plan.snapshotHash,
    blocked: plan.reason === "UNVERIFIED_DATA_BLOCKED",
    reason: plan.reason,
  };
}
