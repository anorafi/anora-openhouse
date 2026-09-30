import type { IndexedEvent } from "./events";

export type FacilityStatus = "FUNDING" | "FUNDED" | "ACTIVE" | "LATE" | "DEFAULTED" | "RECOVERED" | "REPAID";
export type PositionStatus = "HELD" | "CLAIMABLE" | "SETTLED";

export interface FacilitySummary {
  chainId: number;
  address: string;
  name: string;
  originator: string;
  limit: string;
  firstLoss: string;
  status: FacilityStatus;
  pastDue: boolean;
  closed: boolean;
  dueAt: string | null;
  deposited: { senior: string; junior: string };
  withdrawn: { senior: string; junior: string };
  outstandingPrincipal: string;
  outstandingLoss: string;
  repaid: { principal: string; fee: string };
  createdBlock: string;
  sourceBlock: string;
}

export interface TranchePosition {
  deposited: string;
  withdrawn: string;
  shares: string;
}

export interface PositionSummary {
  chainId: number;
  facility: string;
  senior: TranchePosition;
  junior: TranchePosition;
  status: PositionStatus;
  sourceBlock: string;
}

const big = (value: unknown) => BigInt(String(value ?? "0"));
const order = (a: IndexedEvent, b: IndexedEvent) => (Number(a.blockNumber) === Number(b.blockNumber) ? a.logIndex - b.logIndex : Number(a.blockNumber) - Number(b.blockNumber));

export function deriveFacility(events: IndexedEvent[], nowSeconds: number): FacilitySummary | null {
  const sorted = [...events].sort(order);
  const created = sorted.find((e) => e.event === "FacilityCreated");
  if (!created) return null;
  let senior = 0n;
  let junior = 0n;
  let outSenior = 0n;
  let outJunior = 0n;
  let drawn = 0n;
  let repaidPrincipal = 0n;
  let repaidFee = 0n;
  let dueAt: bigint | null = null;
  let late = false;
  let closed = false;
  let defaulted = false;
  let totalLoss = 0n;
  let recovered = 0n;
  let everDeposited = false;
  for (const e of sorted) {
    const d = e.data;
    if (e.event === "Deposited") {
      everDeposited = true;
      if (d.tranche === "SENIOR") senior += big(d.assets);
      else junior += big(d.assets);
    } else if (e.event === "Withdrawn") {
      if (d.tranche === "SENIOR") outSenior += big(d.assets);
      else outJunior += big(d.assets);
    } else if (e.event === "Drawn") {
      drawn += big(d.amount);
      dueAt = big(d.dueAt);
    } else if (e.event === "Repaid") {
      repaidPrincipal += big(d.principal);
      repaidFee += big(d.fee);
    } else if (e.event === "MarkedLate") late = true;
    else if (e.event === "DefaultDeclared") {
      defaulted = true;
      totalLoss = big(d.lossFirstLoss) + big(d.lossJunior) + big(d.lossSenior);
    } else if (e.event === "Recovered") recovered += big(d.amount);
    else if (e.event === "FacilityClosed") closed = true;
  }
  const outstandingPrincipal = defaulted ? 0n : drawn - repaidPrincipal;
  const outstandingLoss = totalLoss > recovered ? totalLoss - recovered : 0n;
  let status: FacilityStatus;
  if (defaulted) status = outstandingLoss === 0n ? "RECOVERED" : "DEFAULTED";
  else if (closed) status = "REPAID";
  else if (late) status = "LATE";
  else if (drawn > 0n) status = "ACTIVE";
  else if (everDeposited) status = "FUNDED";
  else status = "FUNDING";
  const last = sorted[sorted.length - 1];
  return {
    chainId: created.chainId,
    address: created.facility,
    name: String(created.data.name ?? ""),
    originator: String(created.data.originator ?? ""),
    limit: String(created.data.limit ?? "0"),
    firstLoss: String(created.data.firstLoss ?? "0"),
    status,
    pastDue: status === "ACTIVE" && dueAt !== null && BigInt(nowSeconds) > dueAt,
    closed,
    dueAt: dueAt === null ? null : dueAt.toString(),
    deposited: { senior: senior.toString(), junior: junior.toString() },
    withdrawn: { senior: outSenior.toString(), junior: outJunior.toString() },
    outstandingPrincipal: outstandingPrincipal.toString(),
    outstandingLoss: outstandingLoss.toString(),
    repaid: { principal: repaidPrincipal.toString(), fee: repaidFee.toString() },
    createdBlock: created.blockNumber,
    sourceBlock: last.blockNumber,
  };
}

export function derivePositions(events: IndexedEvent[], account: string, nowSeconds: number): PositionSummary[] {
  const wanted = account.toLowerCase();
  const byFacility = new Map<string, IndexedEvent[]>();
  for (const e of events) {
    const list = byFacility.get(e.facility) ?? [];
    list.push(e);
    byFacility.set(e.facility, list);
  }
  const out: PositionSummary[] = [];
  for (const [facility, list] of byFacility) {
    const mine = list.filter((e) => (e.event === "Deposited" || e.event === "Withdrawn") && e.data.provider === wanted);
    if (mine.length === 0) continue;
    const senior = { deposited: 0n, withdrawn: 0n, shares: 0n };
    const junior = { deposited: 0n, withdrawn: 0n, shares: 0n };
    for (const e of mine) {
      const target = e.data.tranche === "SENIOR" ? senior : junior;
      if (e.event === "Deposited") {
        target.deposited += big(e.data.assets);
        target.shares += big(e.data.shares);
      } else {
        target.withdrawn += big(e.data.assets);
        target.shares -= big(e.data.shares);
      }
    }
    const summary = deriveFacility(list, nowSeconds);
    const held = senior.shares + junior.shares;
    let status: PositionStatus = "HELD";
    if (held === 0n) status = "SETTLED";
    else if (summary && (summary.status === "REPAID" || summary.status === "RECOVERED")) status = "CLAIMABLE";
    out.push({
      chainId: mine[0].chainId,
      facility,
      senior: { deposited: senior.deposited.toString(), withdrawn: senior.withdrawn.toString(), shares: senior.shares.toString() },
      junior: { deposited: junior.deposited.toString(), withdrawn: junior.withdrawn.toString(), shares: junior.shares.toString() },
      status,
      sourceBlock: [...list].sort(order).slice(-1)[0].blockNumber,
    });
  }
  return out;
}
