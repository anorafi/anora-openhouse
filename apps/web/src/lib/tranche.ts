export type Tranche = "senior" | "junior";

const BPS = 10_000;

export interface TrancheStructureInput {
  limit: number;
  firstLoss: number;
  seniorPerJuniorBps: number;
  seniorAssets: number;
  juniorAssets: number;
}

export interface TrancheStructure {
  firstLossPct: number;
  juniorPct: number;
  seniorPct: number;
  firstLoss: number;
  junior: number;
  senior: number;
  seniorSupplied: number;
  juniorSupplied: number;
}

export function trancheStructure({ limit, firstLoss, seniorPerJuniorBps, seniorAssets, juniorAssets }: TrancheStructureInput): TrancheStructure {
  const ratio = seniorPerJuniorBps / BPS;
  const residual = Math.max(0, limit - firstLoss);
  const needed = Math.max(0, limit / (1 + ratio) - firstLoss);
  const junior = Math.min(residual, Math.max(juniorAssets, needed));
  const senior = residual - junior;
  const pct = (value: number) => (limit > 0 ? (value / limit) * 100 : 0);
  return {
    firstLossPct: pct(Math.min(firstLoss, limit)),
    juniorPct: pct(junior),
    seniorPct: pct(senior),
    firstLoss,
    junior,
    senior,
    seniorSupplied: seniorAssets,
    juniorSupplied: juniorAssets,
  };
}

export interface TrancheReturnInput {
  feePct: number;
  seniorFeeShareBps: number;
  tranche: Tranche;
  amount: number;
  seniorAssets: number;
  juniorAssets: number;
}

export function trancheReturn({ feePct, seniorFeeShareBps, tranche, amount, seniorAssets, juniorAssets }: TrancheReturnInput) {
  if (!(amount > 0)) return 0;
  const senior = seniorAssets + (tranche === "senior" ? amount : 0);
  const junior = juniorAssets + (tranche === "junior" ? amount : 0);
  const pool = senior + junior;
  const seniorShare = junior > 0 ? seniorFeeShareBps / BPS : 1;
  if (tranche === "senior") return feePct * seniorShare * (pool / senior);
  return feePct * (1 - seniorShare) * (pool / junior);
}

export const trancheIndex = (tranche: Tranche) => (tranche === "senior" ? 0 : 1);

export function holdingTranches(holding: { seniorShares: bigint; juniorShares: bigint }) {
  if (holding.seniorShares > 0n && holding.juniorShares > 0n) return "Senior and Junior";
  if (holding.seniorShares > 0n) return "Senior";
  if (holding.juniorShares > 0n) return "Junior";
  return "";
}
