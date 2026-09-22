import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Market, MarketStatus } from "../components/Markets";

/**
 * Demo state for the originator -> investor -> originator -> investor loop.
 *
 * One facility moves through these stages, and both roles read the same
 * record, so an action taken under one role is what the other role sees after
 * switching. Mock only: the live contract path is a separate concern.
 */
export type Stage =
  | "open" | "funded" | "drawn" | "repaid" | "settled"
  /** Exceptional path: default declared, recoveries remitted, distribution claimed. */
  | "defaulted" | "recovered" | "closed";

export const STAGE_LABEL: Record<Stage, string> = {
  open: "Seeking capital",
  funded: "Funded",
  drawn: "Drawn",
  repaid: "Repaid",
  settled: "Settled",
  defaulted: "Defaulted",
  recovered: "Recoveries in",
  closed: "Closed at loss",
};

/** What the originator can do next, or null when it is the investor's move. */
export const ORIGINATOR_ACTION: Record<Stage, string | null> = {
  open: null,
  funded: "Draw liquidity",
  drawn: "Repay principal and fees",
  repaid: null,
  settled: null,
  defaulted: "Remit recoveries",
  recovered: null,
  closed: null,
};

export interface Facility {
  id: string;
  name: string;
  company: string;
  type: string;
  route: string;
  icon: string;
  targetReturn: number;
  durationDays: number;
  reservePct: number;
  limit: number;
  firstLoss: number;
  supplied: number;
  drawn: number;
  repaid: number;
  /** Paid back after a default, against the amount owed. */
  recovered: number;
  stage: Stage;
  openedAt: number;
}

export interface DemoEvent {
  id: string;
  at: number;
  /** Keeper covers the permissionless mark-late and the risk agent's default call. */
  actor: "Originator" | "Investor" | "Keeper";
  event: string;
  facility: string;
  amount: string;
}

export interface NewFacility {
  icon?: string;
  name: string;
  company: string;
  type: string;
  route: string;
  limit: number;
  firstLoss: number;
  targetReturn: number;
  durationDays: number;
}

interface DemoValue {
  facilities: Facility[];
  events: DemoEvent[];
  createFacility: (input: NewFacility) => void;
  supply: (id: string, amount: number) => void;
  draw: (id: string) => void;
  repay: (id: string) => void;
  claim: (id: string) => void;
  recover: (id: string, amount: number) => void;
  reset: () => Facility[];
}


/* ---- Mock data ----------------------------------------------------------
   One originator is responsible for every facility a capital provider sees,
   so the market list and "My facilities" are the same records. The pool spans
   Asian trade corridors, not just Indonesia. */
interface PoolEntry { name: string; company: string; route: string; type: string; icon: string }

const FACILITY_POOL: PoolEntry[] = [
  { name: "Bandung Tea Export", company: "PT Nusantara Teh Lestari", route: "Indonesia → Singapore", type: "Export receivables", icon: "◒" },
  { name: "Sumatra Coffee Receivables", company: "PT Sumatra Kopi Global", route: "Indonesia → Japan", type: "Export receivables", icon: "◐" },
  { name: "Java Cocoa Purchase Orders", company: "PT Jawa Cokelat Lestari", route: "Indonesia → Netherlands", type: "Supply-chain finance", icon: "◉" },
  { name: "Vietnam Cashew Export", company: "Viet Harvest Co., Ltd.", route: "Vietnam → UAE", type: "Export receivables", icon: "◔" },
  { name: "Thailand Rice Shipment", company: "Siam Grains Co., Ltd.", route: "Thailand → Philippines", type: "Commodity finance", icon: "♨" },
  { name: "Penang Electronics Order", company: "Penang Components Sdn Bhd", route: "Malaysia → Germany", type: "Supply-chain finance", icon: "▣" },
  { name: "Mekong Rubber Consignment", company: "Mekong Rubber JSC", route: "Vietnam → South Korea", type: "Commodity finance", icon: "◍" },
  { name: "Cebu Shrimp Export", company: "Cebu Marine Foods Corporation", route: "Philippines → Japan", type: "Export receivables", icon: "◓" },
  { name: "Ceylon Tea Auction Lot", company: "Ceylon Highlands (Pvt) Ltd", route: "Sri Lanka → United Kingdom", type: "Export receivables", icon: "◒" },
  { name: "Chattogram Garment Order", company: "Padma Apparels Ltd", route: "Bangladesh → Netherlands", type: "Supply-chain finance", icon: "▨" },
  { name: "Kochi Spice Receivables", company: "Malabar Spice Exports Pvt Ltd", route: "India → United States", type: "Export receivables", icon: "✳" },
  { name: "Karachi Textile Shipment", company: "Indus Textile Industries (Pvt) Ltd", route: "Pakistan → Turkey", type: "Commodity finance", icon: "▤" },
  { name: "Sihanoukville Rice Cargo", company: "Angkor Grain Co., Ltd.", route: "Cambodia → China", type: "Commodity finance", icon: "❋" },
  { name: "Hai Phong Seafood Order", company: "Hai Phong Seafoods JSC", route: "Vietnam → Australia", type: "Supply-chain finance", icon: "◕" },
  { name: "Surabaya Coffee Forward", company: "PT Kopi Timur Nusantara", route: "Indonesia → South Korea", type: "Export receivables", icon: "◑" },
  { name: "Yangon Pulses Export", company: "Ayeyarwady Agri Co., Ltd.", route: "Myanmar → India", type: "Commodity finance", icon: "◎" },
];

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const step = (min: number, max: number, to: number) => Math.round((min + Math.random() * (max - min)) / to) * to;

export interface FacilityDraft {
  name: string; company: string; route: string; type: string; icon: string;
  limit: string; firstLoss: string; targetReturn: string; duration: string;
}

/** Fresh terms for the open-facility form, avoiding names already in play. */
export function randomDraft(taken: readonly string[] = []): FacilityDraft {
  const free = FACILITY_POOL.filter((entry) => !taken.some((name) => name.startsWith(entry.name)));
  const base = pick(free.length > 0 ? free : FACILITY_POOL);
  const limit = step(150_000, 600_000, 10_000);
  const reservePct = step(15, 30, 1);
  return {
    name: `${base.name} ${String(step(2, 48, 1)).padStart(2, "0")}`,
    company: base.company,
    route: base.route,
    type: base.type,
    icon: base.icon,
    limit: String(limit),
    firstLoss: String(Math.round((limit * reservePct) / 100 / 1_000) * 1_000),
    targetReturn: (step(75, 115, 1) / 10).toFixed(1),
    duration: String(pick([45, 60, 75, 90, 120])),
  };
}

const DAY = 86_400_000;

/** How far through its term a facility at each stage is assumed to be. */
const TERM_ELAPSED: Record<Stage, number> = { open: 0.08, funded: 0.2, drawn: 0.55, repaid: 1.05, settled: 1.15, defaulted: 1.3, recovered: 1.35, closed: 1.4 };

function seed(
  entry: PoolEntry,
  suffix: string,
  limit: number,
  reservePct: number,
  targetReturn: number,
  durationDays: number,
  stage: Stage,
  suppliedPct: number,
): Facility {
  const supplied = Math.round((limit * suppliedPct) / 100);
  const drawn = stage === "open" || stage === "funded" ? 0 : supplied;
  return {
    ...entry,
    id: `seed-${suffix}`,
    name: `${entry.name} ${suffix}`,
    targetReturn,
    durationDays,
    reservePct,
    limit,
    firstLoss: Math.round((limit * reservePct) / 100),
    supplied,
    drawn,
    repaid: stage === "repaid" || stage === "settled" ? drawn * (1 + targetReturn / 100) : 0,
    recovered: 0,
    stage,
    openedAt: Date.now() - Math.round(durationDays * TERM_ELAPSED[stage]) * DAY,
  };
}

/** Seeded across the lifecycle so both roles open onto a populated book. */
function seedFacilities(): Facility[] {
  return [
    seed(FACILITY_POOL[0], "01", 420_000, 22.8, 8.5, 90, "open", 0),
    seed(FACILITY_POOL[1], "04", 520_000, 18, 9.2, 120, "open", 0),
    seed(FACILITY_POOL[2], "09", 260_000, 25, 10.1, 75, "funded", 71),
    seed(FACILITY_POOL[3], "02", 300_000, 20, 8.8, 90, "drawn", 100),
    seed(FACILITY_POOL[4], "06", 240_000, 24, 7.9, 60, "repaid", 100),
    seed(FACILITY_POOL[5], "03", 180_000, 30, 11.3, 45, "settled", 100),
    // Buyer never paid. Recoveries came in short, so the reserve was consumed
    // and the remainder fell to the supplied position.
    seed(FACILITY_POOL[10], "07", 380_000, 20, 9.6, 60, "defaulted", 100),
  ];
}

const DemoContext = createContext<DemoValue | null>(null);

const usd = (value: number) => `${Math.round(value).toLocaleString()} USDC`;

/** Principal plus the facility's financing fee. */
export function owedOn(facility: Facility) {
  return facility.drawn * (1 + facility.targetReturn / 100);
}

/** Time for today's entries, date for older ones. */
export function eventTime(at: number) {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** When a facility's principal and fee fall due. */
export function maturityOf(facility: Facility) {
  return facility.openedAt + facility.durationDays * DAY;
}

/** Stages that only a defaulted facility reaches. */
export const DEFAULT_STAGES: Stage[] = ["defaulted", "recovered", "closed"];

/** Typical first instalment on a defaulted trade, used to prefill the form. */
export function suggestedRecovery(facility: Facility) {
  return Math.round((owedOn(facility) * 0.68) / 1_000) * 1_000;
}

export interface Waterfall {
  owed: number;
  recovered: number;
  shortfall: number;
  reserveApplied: number;
  supplierProceeds: number;
  supplierLoss: number;
}

/**
 * Loss allocation after a default: recoveries first, then the originator's
 * first-loss reserve, and only what is left falls to supplied positions.
 */
export function waterfallOf(facility: Facility): Waterfall {
  const owed = owedOn(facility);
  const shortfall = Math.max(0, owed - facility.recovered);
  const reserveApplied = Math.min(facility.firstLoss, shortfall);
  const supplierProceeds = Math.min(owed, facility.recovered + reserveApplied);
  return {
    owed,
    recovered: facility.recovered,
    shortfall,
    reserveApplied,
    supplierProceeds,
    supplierLoss: Math.max(0, facility.supplied - supplierProceeds),
  };
}

/** What a supplier's position is worth: principal until drawn, then principal plus fee. */
export function positionValue(facility: Facility) {
  // Until recoveries are remitted the split is not settled, so the position is
  // still carried at what was supplied rather than at the zero-recovery floor.
  if (facility.stage === "defaulted") return facility.supplied;
  if (facility.stage === "recovered" || facility.stage === "closed") return waterfallOf(facility).supplierProceeds;
  if (facility.repaid > 0) return facility.repaid;
  if (facility.drawn > 0) return owedOn(facility);
  return facility.supplied;
}

/**
 * The ledger entries the seeded facilities imply, so both roles open onto a
 * populated activity feed instead of one that only fills as you click.
 */
function seedEvents(facilities: Facility[]): DemoEvent[] {
  return facilities.flatMap((facility) => {
    const term = facility.durationDays * DAY;
    const entries: Array<[number, DemoEvent["actor"], string, number]> = [
      [0, "Originator", "Facility opened, first-loss staked", facility.firstLoss],
    ];
    if (facility.supplied > 0) entries.push([term * 0.15, "Investor", "Capital supplied", facility.supplied]);
    if (facility.drawn > 0) entries.push([term * 0.3, "Originator", "Liquidity drawn", facility.drawn]);
    if (facility.repaid > 0) entries.push([term, "Originator", "Principal and fees repaid", facility.repaid]);
    if (facility.stage === "settled") entries.push([term + DAY, "Investor", "Principal and return claimed", facility.repaid]);
    if (DEFAULT_STAGES.includes(facility.stage)) {
      entries.push([term, "Keeper", "Payment marked late, drawdowns stopped", owedOn(facility)]);
      entries.push([term + 5 * DAY, "Keeper", "Default declared after grace period", owedOn(facility)]);
    }
    return entries.map(([offset, actor, event, amount], index) => ({
      id: `seed-${facility.id}-${index}`,
      at: facility.openedAt + offset,
      actor,
      event,
      facility: facility.name,
      amount: usd(amount),
    }));
  }).sort((a, b) => b.at - a.at);
}

// Frontend simulation: replace this provider's actions with contract reads and writes during backend integration.
export function DemoProvider({ children }: { children: ReactNode }) {
  const [facilities, setFacilities] = useState<Facility[]>(seedFacilities);
  const [events, setEvents] = useState<DemoEvent[]>(() => seedEvents(facilities));

  /** Back to the book a first-time visitor sees. Returns it so callers can
   *  drop references to the records they were holding. */
  const reset = useCallback(() => {
    const fresh = seedFacilities();
    setFacilities(fresh);
    setEvents(seedEvents(fresh));
    return fresh;
  }, []);

  const log = useCallback((actor: DemoEvent["actor"], event: string, facility: string, amount: string) => {
    setEvents((prev) => [
      { id: `${Date.now()}-${prev.length}`, at: Date.now(), actor, event, facility, amount },
      ...prev,
    ]);
  }, []);

  const patch = useCallback((id: string, next: (facility: Facility) => Facility) => {
    setFacilities((prev) => prev.map((facility) => (facility.id === id ? next(facility) : facility)));
  }, []);

  const createFacility = useCallback((input: NewFacility) => {
    const facility: Facility = {
      ...input,
      id: `f-${Date.now()}`,
      icon: input.icon ?? "◈",
      recovered: 0,
      reservePct: input.limit > 0 ? (input.firstLoss / input.limit) * 100 : 0,
      openedAt: Date.now(),
      supplied: 0,
      drawn: 0,
      repaid: 0,
      stage: "open",
    };
    setFacilities((prev) => [facility, ...prev]);
    log("Originator", "Facility opened, first-loss staked", facility.name, usd(input.firstLoss));
  }, [log]);

  const supply = useCallback((id: string, amount: number) => {
    patch(id, (facility) => ({ ...facility, supplied: facility.supplied + amount, stage: "funded" }));
    const facility = facilities.find((item) => item.id === id);
    if (facility) log("Investor", "Capital supplied", facility.name, usd(amount));
  }, [facilities, log, patch]);

  const draw = useCallback((id: string) => {
    const facility = facilities.find((item) => item.id === id);
    if (!facility) return;
    const amount = Math.min(facility.supplied, facility.limit);
    patch(id, (item) => ({ ...item, drawn: amount, stage: "drawn" }));
    log("Originator", "Liquidity drawn", facility.name, usd(amount));
  }, [facilities, log, patch]);

  const repay = useCallback((id: string) => {
    const facility = facilities.find((item) => item.id === id);
    if (!facility) return;
    const amount = owedOn(facility);
    patch(id, (item) => ({ ...item, repaid: amount, stage: "repaid" }));
    log("Originator", "Principal and fees repaid", facility.name, usd(amount));
  }, [facilities, log, patch]);

  /** Announce that the balance is settled and the position can be claimed. */
  const openDistribution = useCallback((facility: Facility, recovered: number) => {
    log("Keeper", "Balance cleared, distribution available", facility.name, usd(waterfallOf({ ...facility, recovered }).supplierProceeds));
  }, [log]);

  /**
   * Recoveries arrive in instalments. Each payment adds to the total and the
   * facility stays open until the balance is cleared in full.
   */
  const recover = useCallback((id: string, amount: number) => {
    const facility = facilities.find((item) => item.id === id);
    if (!facility) return;
    const owed = owedOn(facility);
    const paid = Math.min(Math.max(0, amount), owed - facility.recovered);
    const total = facility.recovered + paid;
    const covered = total >= owed - 0.5;
    patch(id, (item) => ({ ...item, recovered: total, stage: covered ? "recovered" : "defaulted" }));
    log("Originator", covered ? "Balance cleared in full" : "Payment remitted", facility.name, usd(paid));
    if (covered) openDistribution(facility, total);
  }, [facilities, log, openDistribution, patch]);

  const claim = useCallback((id: string) => {
    const facility = facilities.find((item) => item.id === id);
    if (!facility) return;
    if (facility.stage === "recovered") {
      const flow = waterfallOf(facility);
      patch(id, (item) => ({ ...item, stage: "closed" }));
      log("Investor", "Recovery distribution claimed", facility.name, usd(flow.supplierProceeds));
      return;
    }
    patch(id, (item) => ({ ...item, stage: "settled" }));
    log("Investor", "Principal and return claimed", facility.name, usd(facility.repaid));
  }, [facilities, log, patch]);

  const value = useMemo(
    () => ({ facilities, events, createFacility, supply, draw, repay, claim, recover, reset }),
    [facilities, events, createFacility, supply, draw, repay, claim, recover, reset],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}

const STAGE_STATUS: Record<Stage, MarketStatus> = {
  open: "Open",
  funded: "Funding",
  drawn: "Active",
  repaid: "Repaid",
  settled: "Settled",
  defaulted: "Defaulted",
  recovered: "Recovered",
  closed: "Closed",
};

/** Render a facility through the existing investor market components. */
export function facilityAsMarket(facility: Facility): Market {
  const available = Math.max(0, facility.limit - facility.supplied);
  return {
    name: facility.name,
    type: facility.type,
    route: facility.route,
    company: facility.company,
    icon: facility.icon,
    asset: "USDC",
    status: STAGE_STATUS[facility.stage],
    targetReturn: `${facility.targetReturn}%`,
    available: `$${Math.round(available).toLocaleString("id-ID")}`,
    duration: `${facility.durationDays} days`,
    reserve: `${facility.reservePct.toFixed(1)}%`,
    funded: facility.limit > 0 ? Math.min(100, Math.round((facility.supplied / facility.limit) * 100)) : 0,
  };
}
