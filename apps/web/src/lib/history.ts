import type { Address } from "viem";
import type { Totals } from "./book";
import { formatUsdc } from "./format";

export interface ChainLog {
  id: string;
  facility: Address;
  eventName: string;
  args: Record<string, unknown>;
  at: number;
  txHash: `0x${string}`;
}

export type Actor = "Originator" | "Investor" | "Keeper";

export interface BookEvent {
  id: string;
  at: number;
  actor: Actor;
  event: string;
  facility: string;
  facilityId: Address;
  amount: string;
  provider?: Address;
  txHash: `0x${string}`;
}

const units = (value: unknown) => (typeof value === "bigint" ? value : 0n);
const toNumber = (value: bigint) => Number(formatUsdc(value).replace(/,/g, ""));

export function totalsFrom(logs: ChainLog[]): Map<Address, Totals> {
  const totals = new Map<Address, Totals>();
  for (const { facility, eventName, args } of logs) {
    const entry = totals.get(facility) ?? { drawn: 0, repaid: 0, recovered: 0, defaultLoss: 0 };
    if (eventName === "Drawn") entry.drawn += toNumber(units(args.amount));
    if (eventName === "Repaid") entry.repaid += toNumber(units(args.principal) + units(args.fee));
    if (eventName === "Recovered") entry.recovered += toNumber(units(args.amount));
    if (eventName === "DefaultDeclared") entry.defaultLoss = toNumber(units(args.lossFirstLoss) + units(args.lossJunior) + units(args.lossSenior));
    totals.set(facility, entry);
  }
  return totals;
}

export function depositedBy(logs: ChainLog[], provider: Address): Map<Address, number> {
  const net = new Map<Address, number>();
  for (const { facility, eventName, args } of logs) {
    if ((args.provider as string | undefined)?.toLowerCase() !== provider.toLowerCase()) continue;
    const sign = eventName === "Deposited" ? 1 : eventName === "Withdrawn" ? -1 : 0;
    net.set(facility, Math.max(0, (net.get(facility) ?? 0) + sign * toNumber(units(args.assets))));
  }
  return net;
}

const DESCRIBE: Record<string, (args: Record<string, unknown>) => [Actor, string, bigint] | null> = {
  FacilityCreated: (args) => ["Originator", "Facility opened, first-loss staked", units(args.firstLoss)],
  Deposited: (args) => ["Investor", "Capital supplied", units(args.assets)],
  Withdrawn: (args) => ["Investor", "Principal and return claimed", units(args.assets)],
  Drawn: (args) => ["Originator", "Liquidity drawn", units(args.amount)],
  Repaid: (args) => ["Originator", "Principal and fees repaid", units(args.principal) + units(args.fee)],
  MarkedLate: () => ["Keeper", "Payment marked late, drawdowns stopped", 0n],
  DefaultDeclared: (args) => ["Keeper", "Default declared after grace period", units(args.lossFirstLoss) + units(args.lossJunior) + units(args.lossSenior)],
  Recovered: (args) => ["Originator", "Payment remitted", units(args.amount)],
};

export function eventsFrom(logs: ChainLog[], nameOf: (facility: Address) => string, symbol: string): BookEvent[] {
  return logs
    .flatMap((log) => {
      const described = DESCRIBE[log.eventName]?.(log.args);
      if (!described) return [];
      const [actor, event, amount] = described;
      return [{
        id: log.id,
        at: log.at,
        actor,
        event,
        facility: nameOf(log.facility),
        facilityId: log.facility,
        amount: amount > 0n ? `${formatUsdc(amount)} ${symbol}` : "—",
        provider: log.args.provider as Address | undefined,
        txHash: log.txHash,
      }];
    })
    .sort((a, b) => b.at - a.at);
}
