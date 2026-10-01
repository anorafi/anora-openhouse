import type { Address } from "viem";
import type { ChainLog } from "./history";

export interface IndexerEvent {
  id: string;
  facility: string;
  event: string;
  txHash: string;
  observedAt: string | null;
  data: Record<string, unknown>;
}

interface ActivityPage {
  items: IndexerEvent[];
  nextCursor: string | null;
}

const AMOUNT_FIELDS = new Set([
  "amount",
  "fee",
  "dueAt",
  "principal",
  "at",
  "assets",
  "shares",
  "lossFirstLoss",
  "lossJunior",
  "lossSenior",
  "toSenior",
  "toJunior",
  "toOriginator",
  "limit",
  "firstLoss",
  "previousBps",
  "nextBps",
]);

const PAGE_SIZE = 500;
const MAX_PAGES = 40;

export class IndexerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly indexedBlock?: string,
    readonly chainBlock?: string,
  ) {
    super(message);
    this.name = "IndexerError";
  }
}

export function toChainLogs(items: IndexerEvent[]): ChainLog[] {
  return items.map((item) => ({
    id: item.id,
    facility: item.facility as Address,
    eventName: item.event,
    args: Object.fromEntries(
      Object.entries(item.data).map(([key, value]) => [key, AMOUNT_FIELDS.has(key) && typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value]),
    ),
    at: item.observedAt ? Date.parse(item.observedAt) : 0,
    txHash: item.txHash as `0x${string}`,
  }));
}

async function readPage(fetchImpl: typeof fetch, url: string): Promise<ActivityPage> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new IndexerError("INDEXER_UNREACHABLE", "Could not reach the indexer.");
  }
  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; indexedBlock?: string; chainBlock?: string } } & Partial<ActivityPage>;
  if (!response.ok || !body || body.error) {
    const error = body?.error;
    throw new IndexerError(error?.code ?? "INDEXER_UNREACHABLE", error?.message ?? `The indexer answered HTTP ${response.status}.`, error?.indexedBlock, error?.chainBlock);
  }
  return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
}

export async function fetchIndexerActivity(fetchImpl: typeof fetch, api: string, chainId: number): Promise<ChainLog[]> {
  const items: IndexerEvent[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const result: ActivityPage = await readPage(fetchImpl, `${api}/v1/activity?chainId=${chainId}&limit=${PAGE_SIZE}${suffix}`);
    items.push(...result.items);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return toChainLogs(items);
}

export function describeIndexerError(error: unknown): string {
  if (error instanceof IndexerError) {
    if (error.code === "INDEXER_BEHIND" && error.indexedBlock && error.chainBlock) {
      const lag = BigInt(error.chainBlock) - BigInt(error.indexedBlock);
      return `The indexer is ${lag} blocks behind the chain (indexed ${error.indexedBlock}, chain ${error.chainBlock}). History may be out of date.`;
    }
    if (error.code === "RPC_UNAVAILABLE") return "The indexer cannot read the chain right now. History is unavailable.";
    if (error.code === "INDEXER_UNREACHABLE") return "Could not reach the indexer. History is unavailable.";
    return error.message;
  }
  return error instanceof Error ? error.message : "History is unavailable.";
}
