import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, useChainId, useConfig, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import type { Market, MarketStatus } from "../components/Markets";
import { assetContract, facilityContract, factoryContract } from "../config/contracts";
import { useAssetBalance } from "../hooks/useAsset";
import { useDeployment } from "../hooks/useDeployment";
import { useAllFacilityAddresses } from "../hooks/useFactory";
import { useFacilities, type FacilityData } from "../hooks/useFacilities";
import { useHistory } from "../hooks/useHistory";
import { useMyPositions } from "../hooks/usePositions";
import { fromUnits, toFacility, toUnits, type Facility, type Stage } from "../lib/book";
import { encodeFacilityName, type Listing } from "../lib/facilityName";
import { depositedBy, eventsFrom, totalsFrom, type BookEvent } from "../lib/history";

export type { Facility, Stage } from "../lib/book";
export type { BookEvent } from "../lib/history";
export { waterfallOf } from "../lib/book";

export const STAGE_LABEL: Record<Stage, string> = {
  open: "Seeking capital",
  funded: "Funded",
  drawn: "Drawn",
  late: "Past due",
  repaid: "Repaid",
  settled: "Settled",
  defaulted: "Defaulted",
  recovered: "Recoveries in",
  closed: "Closed at loss",
};

export const ORIGINATOR_ACTION: Record<Stage, string | null> = {
  open: null,
  funded: "Draw liquidity",
  drawn: "Repay",
  late: "Repay",
  repaid: null,
  settled: null,
  defaulted: "Remit recoveries",
  recovered: null,
  closed: null,
};

export const DEFAULT_STAGES: Stage[] = ["defaulted", "recovered", "closed"];

export interface NewFacility {
  listing: Listing;
  limit: number;
  firstLoss: number;
  feePct: number;
  tenorMinutes: number;
  graceMinutes: number;
}

const LATE_FEE_PER_DAY_BPS = 10n;
const SENIOR_PER_JUNIOR_BPS = 22_500n;
const SENIOR_FEE_SHARE_BPS = 6_000n;
const SENIOR = 0;
const JUNIOR = 1;

interface BookValue {
  facilities: Facility[];
  events: BookEvent[];
  symbol: string;
  me: Address | undefined;
  balance: number;
  factory: Address | undefined;
  approve: (spender: Address, amount: number) => Promise<void>;
  createFacility: (input: NewFacility) => Promise<void>;
  supply: (id: Address, amount: number) => Promise<void>;
  draw: (id: Address) => Promise<void>;
  repay: (id: Address) => Promise<void>;
  claim: (id: Address) => Promise<void>;
  recover: (id: Address, amount: number) => Promise<void>;
}

const BookContext = createContext<BookValue | null>(null);

export function BookProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const deployment = useDeployment();
  const { address: me } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { data: addresses } = useAllFacilityAddresses();
  const { facilities: raw } = useFacilities(addresses);
  const { positions } = useMyPositions(addresses, me);
  const { data: logs } = useHistory(addresses ?? []);
  const { data: balanceUnits } = useAssetBalance(me);

  const facilities = useMemo(() => {
    const totals = totalsFrom(logs ?? []);
    const deposited = me ? depositedBy(logs ?? [], me) : new Map<Address, number>();
    return raw
      .map((data) => {
        const facility = toFacility(data, positions.get(data.address) ?? { seniorShares: 0n, juniorShares: 0n }, totals.get(data.address));
        const supplied = deposited.get(data.address);
        return supplied ? { ...facility, holding: { ...facility.holding, supplied } } : facility;
      })
      .reverse();
  }, [raw, positions, logs, me]);

  const symbol = deployment?.assetSymbol ?? "USDC";
  const events = useMemo(() => {
    const names = new Map(facilities.map((facility) => [facility.id, facility.name]));
    return eventsFrom(logs ?? [], (id) => names.get(id) ?? "Facility", symbol);
  }, [facilities, logs, symbol]);

  const rawOf = useCallback((id: Address): FacilityData => {
    const found = raw.find((data) => data.address === id);
    if (!found) throw new Error("Facility is still loading.");
    return found;
  }, [raw]);

  const send = useCallback(async (request: Parameters<typeof writeContractAsync>[0]) => {
    const hash = await writeContractAsync(request);
    const receipt = await waitForTransactionReceipt(config, { hash, chainId });
    if (receipt.status !== "success") throw new Error("Transaction reverted.");
    await queryClient.invalidateQueries();
  }, [chainId, config, queryClient, writeContractAsync]);

  const approveUnits = useCallback(async (spender: Address, amount: bigint) => {
    if (!deployment || !me) throw new Error("Connect a wallet first.");
    const asset = assetContract(deployment.asset);
    const allowance = await readContract(config, { ...asset, chainId, functionName: "allowance", args: [me, spender] });
    if (allowance >= amount) return;
    await send({ ...asset, chainId, functionName: "approve", args: [spender, amount] });
  }, [chainId, config, deployment, me, send]);

  const approve = useCallback((spender: Address, amount: number) => approveUnits(spender, toUnits(amount)), [approveUnits]);

  const createFacility = useCallback(async (input: NewFacility) => {
    if (!deployment) throw new Error("No deployment on this network.");
    const limit = toUnits(input.limit);
    await approveUnits(deployment.factory, toUnits(input.firstLoss));
    await send({
      ...factoryContract(deployment.factory),
      chainId,
      functionName: "createFacility",
      args: [encodeFacilityName(input.listing), {
        limit,
        firstLoss: toUnits(input.firstLoss),
        tenor: BigInt(Math.round(input.tenorMinutes * 60)),
        grace: BigInt(Math.round(input.graceMinutes * 60)),
        financingFeeBps: BigInt(Math.round(input.feePct * 100)),
        lateFeePerDayBps: LATE_FEE_PER_DAY_BPS,
        seniorPerJuniorBps: SENIOR_PER_JUNIOR_BPS,
        seniorFeeShareBps: SENIOR_FEE_SHARE_BPS,
        capitalCap: limit,
      }],
    });
  }, [approveUnits, chainId, deployment, send]);

  const supply = useCallback(async (id: Address, amount: number) => {
    await approveUnits(id, toUnits(amount));
    await send({ ...facilityContract(id), chainId, functionName: "deposit", args: [SENIOR, toUnits(amount)] });
  }, [approveUnits, chainId, send]);

  const draw = useCallback(async (id: Address) => {
    const data = rawOf(id);
    const headroom = data.terms.limit - data.principal;
    const amount = data.liquidity < headroom ? data.liquidity : headroom;
    await send({ ...facilityContract(id), chainId, functionName: "drawdown", args: [amount] });
  }, [chainId, rawOf, send]);

  const repay = useCallback(async (id: Address) => {
    const owed = rawOf(id).owed;
    await approveUnits(id, owed);
    await send({ ...facilityContract(id), chainId, functionName: "repay", args: [owed] });
  }, [approveUnits, chainId, rawOf, send]);

  const claim = useCallback(async (id: Address) => {
    const position = positions.get(id);
    if (position && position.seniorShares > 0n) await send({ ...facilityContract(id), chainId, functionName: "withdraw", args: [SENIOR, position.seniorShares] });
    if (position && position.juniorShares > 0n) await send({ ...facilityContract(id), chainId, functionName: "withdraw", args: [JUNIOR, position.juniorShares] });
  }, [chainId, positions, send]);

  const recover = useCallback(async (id: Address, amount: number) => {
    const data = rawOf(id);
    const outstanding = data.lossFirstLoss + data.lossJunior + data.lossSenior;
    const units = toUnits(amount) < outstanding ? toUnits(amount) : outstanding;
    await approveUnits(id, units);
    await send({ ...facilityContract(id), chainId, functionName: "recordRecovery", args: [units] });
  }, [approveUnits, chainId, rawOf, send]);

  const value = useMemo<BookValue>(() => ({
    facilities,
    events,
    symbol,
    me,
    balance: balanceUnits !== undefined ? fromUnits(balanceUnits) : 0,
    factory: deployment?.factory,
    approve,
    createFacility,
    supply,
    draw,
    repay,
    claim,
    recover,
  }), [approve, balanceUnits, claim, createFacility, deployment, draw, events, facilities, me, recover, repay, supply, symbol]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook() {
  const value = useContext(BookContext);
  if (!value) throw new Error("useBook must be used inside BookProvider");
  return value;
}

export function useMoney() {
  const { symbol } = useBook();
  return (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
}

export const isMine = (facility: Facility, me: Address | undefined) => !!me && facility.originator.toLowerCase() === me.toLowerCase();

export function owedOn(facility: Facility) {
  if (facility.stage === "drawn" || facility.stage === "late") return facility.owed;
  return facility.drawn * (1 + facility.feePct / 100);
}

export function maturityOf(facility: Facility) {
  return facility.dueAt || Date.now() + facility.tenorSeconds * 1_000;
}

export function eventTime(at: number) {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const STAGE_STATUS: Record<Stage, MarketStatus> = {
  open: "Open",
  funded: "Funding",
  drawn: "Active",
  late: "Late",
  repaid: "Repaid",
  settled: "Settled",
  defaulted: "Defaulted",
  recovered: "Recovered",
  closed: "Closed",
};

export function facilityAsMarket(facility: Facility, symbol: string): Market {
  return {
    id: facility.id,
    name: facility.name,
    type: facility.type,
    route: facility.route,
    company: facility.company,
    icon: facility.icon,
    asset: symbol,
    status: STAGE_STATUS[facility.stage],
    targetReturn: `${facility.targetReturn}%`,
    available: `${facility.available.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`,
    duration: facility.durationLabel,
    reserve: `${facility.reservePct.toFixed(1)}%`,
    funded: facility.limit > 0 ? Math.min(100, Math.round((facility.supplied / facility.limit) * 100)) : 0,
  };
}

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

export interface DraftSize { min: number; max: number; step: number }

const DRAFT_SIZE: Record<number, DraftSize> = {
  4663: { min: 10, max: 20, step: 1 },
  421614: { min: 150_000, max: 600_000, step: 10_000 },
};

export function useDraftSize(): DraftSize {
  return DRAFT_SIZE[useChainId()] ?? DRAFT_SIZE[421614];
}

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
const step = (min: number, max: number, to: number) => Math.round((min + Math.random() * (max - min)) / to) * to;

export interface FacilityDraft {
  name: string; company: string; route: string; type: string; icon: string;
  limit: string; firstLoss: string; feePct: string; duration: string; grace: string;
}

export function randomDraft(taken: readonly string[], size: DraftSize): FacilityDraft {
  const free = FACILITY_POOL.filter((entry) => !taken.some((name) => name.startsWith(entry.name)));
  const base = pick(free.length > 0 ? free : FACILITY_POOL);
  const limit = step(size.min, size.max, size.step);
  const reservePct = step(25, 35, 1);
  return {
    name: `${base.name} ${String(step(2, 48, 1)).padStart(2, "0")}`,
    company: base.company,
    route: base.route,
    type: base.type,
    icon: base.icon,
    limit: String(limit),
    firstLoss: String(Math.ceil((limit * reservePct) / 100 / size.step) * size.step),
    feePct: String(pick([4, 5, 6])),
    duration: String(pick([2, 3])),
    grace: "1",
  };
}
