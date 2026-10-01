import type { Hex } from "viem";
import type { Db, StoredEvent } from "./db";
import { normalizeLog, type RawLog } from "./events";

export interface ChainClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: Hex[]; fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
  getBlock(blockNumber: bigint): Promise<{ hash: Hex; timestamp: bigint }>;
}

export interface SyncNetwork {
  chainId: number;
  factory: Hex;
  deploymentBlock: bigint;
  confirmations: number;
}

export interface SyncOptions {
  chunk: bigint;
  reorgWindow: bigint;
  retries: number;
  backoffMs?: number;
}

export interface SyncState {
  indexedBlock: bigint;
  chainBlock: bigint;
}

const MIN_CHUNK = 10n;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function byPosition(a: RawLog, b: RawLog) {
  return a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
}

async function rollbackReorgs(client: ChainClient, db: Db, net: SyncNetwork, head: bigint, window: bigint) {
  const from = head > window ? Number(head - window) : 0;
  for (const stored of db.blocksSince(net.chainId, from)) {
    const current = await client.getBlock(BigInt(stored.blockNumber));
    if (current.hash.toLowerCase() === stored.blockHash.toLowerCase()) continue;
    db.deleteFromBlock(net.chainId, stored.blockNumber);
    db.setCursor(net.chainId, BigInt(stored.blockNumber - 1));
    return;
  }
}

async function fetchRange(client: ChainClient, db: Db, net: SyncNetwork, from: bigint, to: bigint): Promise<RawLog[]> {
  const known = new Set(db.facilities(net.chainId));
  const logs = await client.getLogs({ address: [net.factory, ...known] as Hex[], fromBlock: from, toBlock: to });
  const fresh = new Set<string>();
  for (const log of logs) {
    const event = normalizeLog(net.chainId, log);
    if (event?.event === "FacilityCreated" && !known.has(event.facility)) fresh.add(event.facility);
  }
  if (fresh.size === 0) return logs.sort(byPosition);
  const extra = await client.getLogs({ address: [...fresh] as Hex[], fromBlock: from, toBlock: to });
  return [...logs, ...extra].sort(byPosition);
}

async function store(client: ChainClient, db: Db, net: SyncNetwork, logs: RawLog[]) {
  const times = new Map<bigint, string>();
  const events: StoredEvent[] = [];
  for (const log of logs) {
    const event = normalizeLog(net.chainId, log);
    if (!event) continue;
    if (!times.has(log.blockNumber)) {
      const block = await client.getBlock(log.blockNumber);
      times.set(log.blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
    }
    events.push({ ...event, observedAt: times.get(log.blockNumber)! });
  }
  db.upsertEvents(events);
}

export async function syncChain(client: ChainClient, db: Db, net: SyncNetwork, options: SyncOptions): Promise<SyncState> {
  const head = await client.getBlockNumber();
  await rollbackReorgs(client, db, net, head, options.reorgWindow);
  const cursor = db.cursor(net.chainId);
  const rescanFrom = cursor === null ? net.deploymentBlock : cursor + 1n - options.reorgWindow;
  let next = rescanFrom > net.deploymentBlock ? rescanFrom : net.deploymentBlock;
  let chunk = options.chunk;
  let failures = 0;
  while (next <= head) {
    const to = next + chunk - 1n < head ? next + chunk - 1n : head;
    try {
      const logs = await fetchRange(client, db, net, next, to);
      await store(client, db, net, logs);
      db.setCursor(net.chainId, to);
      next = to + 1n;
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures > options.retries) throw error;
      chunk = chunk / 2n > MIN_CHUNK ? chunk / 2n : MIN_CHUNK;
      await wait((options.backoffMs ?? 0) * failures);
    }
  }
  const indexed = db.cursor(net.chainId);
  return { indexedBlock: indexed ?? head, chainBlock: head };
}
