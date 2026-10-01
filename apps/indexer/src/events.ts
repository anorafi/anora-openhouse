import { decodeEventLog, type Abi, type Hex } from "viem";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";
import { AnoraFactoryAbi } from "../../web/src/abi/AnoraFactory";

export interface RawLog {
  address: Hex;
  topics: [Hex, ...Hex[]];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface IndexedEvent {
  schemaVersion: 1;
  id: string;
  chainId: number;
  blockNumber: string;
  blockHash: string;
  txHash: string;
  logIndex: number;
  facility: string;
  event: string;
  actor: string | null;
  data: Record<string, unknown>;
  observedAt: string | null;
}

export const INDEXED_EVENTS = new Set([
  "FacilityCreated",
  "TermsFrozen",
  "RiskAgentChanged",
  "MinFirstLossChanged",
  "OriginatorApprovalChanged",
  "OwnershipTransferStarted",
  "OwnershipTransferred",
  "Paused",
  "Unpaused",
  "Deposited",
  "Withdrawn",
  "Drawn",
  "Repaid",
  "MarkedLate",
  "DefaultDeclared",
  "Recovered",
  "FacilityClosed",
  "EvidenceAttached",
]);

const ABI = [...AnoraFactoryAbi, ...AnoraFacilityAbi] as Abi;
const TRANCHES = ["SENIOR", "JUNIOR"];
const ACTOR_FIELDS: Record<string, string> = {
  FacilityCreated: "originator",
  OriginatorApprovalChanged: "originator",
  RiskAgentChanged: "next",
  OwnershipTransferStarted: "newOwner",
  OwnershipTransferred: "newOwner",
  Deposited: "provider",
  Withdrawn: "provider",
  EvidenceAttached: "by",
  Paused: "account",
  Unpaused: "account",
};

function plain(name: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.startsWith("0x") && value.length === 42) return value.toLowerCase();
  if (name === "tranche" && typeof value === "number") return TRANCHES[value] ?? String(value);
  return value;
}

export function normalizeLog(chainId: number, log: RawLog): IndexedEvent | null {
  let decoded: { eventName?: string; args?: unknown };
  try {
    decoded = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
  } catch {
    return null;
  }
  const name = decoded.eventName;
  if (!name || !INDEXED_EVENTS.has(name)) return null;
  const args = (decoded.args ?? {}) as Record<string, unknown>;
  const data = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, plain(key, value)]));
  if (name === "Deposited" || name === "Withdrawn") data.tranche = plain("tranche", Number(args.tranche));
  const actorField = ACTOR_FIELDS[name];
  const actor = actorField ? ((data[actorField] as string | undefined) ?? null) : null;
  const facility = name === "FacilityCreated" || name === "TermsFrozen" ? (data.facility as string) : log.address.toLowerCase();
  return {
    schemaVersion: 1,
    id: `${chainId}:${log.transactionHash}:${log.logIndex}`,
    chainId,
    blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    facility,
    event: name,
    actor,
    data,
    observedAt: null,
  };
}
