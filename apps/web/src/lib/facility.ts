export function toPct(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  return Number((numerator * 10_000n) / denominator) / 100;
}

export function bpsToPct(bps: bigint): number {
  return Number(bps) / 100;
}

export function valueShares(shares: bigint, totalShares: bigint, trancheAssets: bigint): bigint {
  if (totalShares === 0n) return 0n;
  return (shares * trancheAssets) / totalShares;
}

export function secondsUntil(targetSec: bigint, nowSec: bigint): number {
  return Number(targetSec - nowSec);
}
