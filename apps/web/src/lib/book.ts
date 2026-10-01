import type { Address } from "viem";
import type { FacilityData } from "../hooks/useFacilities";
import type { Position } from "../hooks/usePositions";
import { decodeFacilityName } from "./facilityName";
import { valueShares } from "./facility";
import { formatUsdc, parseUsdc } from "./format";

export type Stage =
  | "open" | "funded" | "drawn" | "late" | "repaid" | "settled"
  | "defaulted" | "recovered" | "closed";

export interface Totals {
  drawn: number;
  repaid: number;
  recovered: number;
  defaultLoss: number;
}

export interface Holding {
  seniorShares: bigint;
  juniorShares: bigint;
  value: number;
  supplied: number;
}

export interface Facility {
  id: Address;
  asset: string;
  name: string;
  company: string;
  type: string;
  route: string;
  icon: string;
  originator: Address;
  feePct: number;
  targetReturn: number;
  tenorSeconds: number;
  graceSeconds: number;
  durationDays: number;
  durationLabel: string;
  reservePct: number;
  seniorPct: number;
  juniorPct: number;
  limit: number;
  firstLoss: number;
  supplied: number;
  available: number;
  liquidity: number;
  drawn: number;
  owed: number;
  repaid: number;
  recovered: number;
  outstandingLoss: { firstLoss: number; junior: number; senior: number };
  defaultLoss: number;
  dueAt: number;
  graceEndsAt: number;
  defaultReason: string;
  stage: Stage;
  holding: Holding;
}

const BPS = 10_000;
const NO_TOTALS: Totals = { drawn: 0, repaid: 0, recovered: 0, defaultLoss: 0 };

export const fromUnits = (units: bigint) => Number(formatUsdc(units).replace(/,/g, ""));
export const toUnits = (value: number) => parseUsdc(value.toFixed(6));

const counted = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

export function durationText(seconds: number) {
  if (seconds < 3_600) return counted(Math.round(seconds / 60), "minute");
  if (seconds < 86_400) return counted(Math.round(seconds / 3_600), "hour");
  return counted(Math.round(seconds / 86_400), "day");
}

function claimableAssets(data: FacilityData) {
  return data.seniorAssets + (data.juniorTotalShares > 0n ? data.juniorAssets : 0n);
}

export function stageOf(data: FacilityData): Stage {
  const hasHolders = data.seniorTotalShares + data.juniorTotalShares > 0n;
  if (data.statusName === "Defaulted") {
    if (data.lossFirstLoss + data.lossJunior + data.lossSenior > 0n) return "defaulted";
    return hasHolders ? "recovered" : "closed";
  }
  if (data.statusName === "Closed") return hasHolders ? "repaid" : "settled";
  if (data.statusName === "Late") return "late";
  if (data.dueAt > 0n) return "drawn";
  return hasHolders ? "funded" : "open";
}

function availableToSupply(data: FacilityData, stage: Stage) {
  if (stage !== "open" && stage !== "funded") return 0n;
  const underLimit = data.terms.limit > claimableAssets(data) ? data.terms.limit - claimableAssets(data) : 0n;
  const underCap = data.terms.capitalCap > data.totalCapital ? data.terms.capitalCap - data.totalCapital : 0n;
  return [data.seniorCapacity, underLimit, underCap].reduce((min, value) => (value < min ? value : min));
}

export function toFacility(data: FacilityData, position: Position, totals: Totals = NO_TOTALS, asset = "USDC"): Facility {
  const listing = decodeFacilityName(data.name);
  const stage = stageOf(data);
  const feePct = Number(data.terms.financingFeeBps) / 100;
  const tenorSeconds = Number(data.terms.tenor);
  const graceSeconds = Number(data.terms.grace);
  const limit = fromUnits(data.terms.limit);
  const firstLoss = fromUnits(data.terms.firstLoss);
  const outstandingLoss = {
    firstLoss: fromUnits(data.lossFirstLoss),
    junior: fromUnits(data.lossJunior),
    senior: fromUnits(data.lossSenior),
  };
  const holdingUnits =
    valueShares(position.seniorShares, data.seniorTotalShares, data.seniorAssets) +
    valueShares(position.juniorShares, data.juniorTotalShares, data.juniorAssets);

  const reservePct = limit > 0 ? ((firstLoss + fromUnits(data.juniorTotalShares > 0n ? data.juniorAssets : 0n)) / limit) * 100 : 0;

  return {
    id: data.address,
    asset,
    ...listing,
    originator: data.originator,
    feePct,
    targetReturn: (feePct * Number(data.terms.seniorFeeShareBps)) / BPS,
    tenorSeconds,
    graceSeconds,
    durationDays: tenorSeconds / 86_400,
    durationLabel: durationText(tenorSeconds),
    reservePct,
    seniorPct: 100 - reservePct,
    juniorPct: 0,
    limit,
    firstLoss,
    supplied: fromUnits(claimableAssets(data)),
    available: fromUnits(availableToSupply(data, stage)),
    liquidity: fromUnits(data.liquidity),
    drawn: data.principal > 0n ? fromUnits(data.principal) : totals.drawn,
    owed: fromUnits(data.owed),
    repaid: totals.repaid,
    recovered: totals.recovered,
    outstandingLoss,
    defaultLoss: totals.defaultLoss || outstandingLoss.firstLoss + outstandingLoss.junior + outstandingLoss.senior + totals.recovered,
    dueAt: Number(data.dueAt) * 1_000,
    graceEndsAt: data.lateSince > 0n ? (Number(data.lateSince) + graceSeconds) * 1_000 : 0,
    defaultReason: data.defaultReason,
    stage,
    holding: { seniorShares: position.seniorShares, juniorShares: position.juniorShares, value: fromUnits(holdingUnits), supplied: fromUnits(holdingUnits) },
  };
}

export interface Waterfall {
  owed: number;
  recovered: number;
  shortfall: number;
  reserveApplied: number;
  supplierLoss: number;
}

export function waterfallOf(facility: Facility, payment = 0): Waterfall {
  const { firstLoss, junior, senior } = facility.outstandingLoss;
  const toSuppliers = Math.min(payment, junior + senior);
  const toReserve = Math.min(payment - toSuppliers, firstLoss);
  return {
    owed: facility.defaultLoss,
    recovered: facility.recovered + toSuppliers + toReserve,
    shortfall: firstLoss + junior + senior - toSuppliers - toReserve,
    reserveApplied: firstLoss - toReserve,
    supplierLoss: junior + senior - toSuppliers,
  };
}

const CLOSED_LABEL: Partial<Record<Stage, string>> = {
  drawn: "Funding closed",
  late: "Past due",
  repaid: "Repaid · ready to claim",
  settled: "Settled · complete",
  defaulted: "In default",
  recovered: "Recovery ready to claim",
  closed: "Closed at loss",
};

export function fundingState(facility: Pick<Facility, "stage" | "supplied" | "available">) {
  const accepting = facility.stage === "open" || facility.stage === "funded";
  const available = accepting ? facility.available : 0;
  const capacity = facility.supplied + available;
  const percent = capacity > 0 ? Math.min(100, Math.round((facility.supplied / capacity) * 100)) : 0;
  return { accepting, available, capacity, percent, label: accepting ? `${percent}% funded` : CLOSED_LABEL[facility.stage]! };
}

export type MarketAction = "View market" | "View position" | "Claim funds" | "View history" | "Funding closed";

export function marketAction(facility: Pick<Facility, "stage" | "supplied" | "available" | "holding">): MarketAction {
  if (fundingState(facility).available > 0) return "View market";
  if (facility.holding.value <= 0 && facility.holding.supplied <= 0) return "Funding closed";
  if (facility.stage === "repaid" || facility.stage === "recovered") return "Claim funds";
  if (facility.stage === "settled" || facility.stage === "closed") return "View history";
  return "View position";
}

export function realizedReturn(facility: Pick<Facility, "stage" | "holding">) {
  const paidOut = facility.stage === "repaid" || facility.stage === "settled" || facility.stage === "recovered" || facility.stage === "closed";
  return paidOut ? facility.holding.value - facility.holding.supplied : 0;
}

export interface DraftSize { min: number; max: number; step: number }

export function draftSizeFor(faucet: boolean): DraftSize {
  return faucet ? { min: 150_000, max: 600_000, step: 10_000 } : { min: 10, max: 20, step: 1 };
}
