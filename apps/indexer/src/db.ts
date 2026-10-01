import { Database } from "bun:sqlite";
import type { IndexedEvent } from "./events";

export interface StoredEvent extends IndexedEvent {}

export interface EventFilter {
  chainId: number;
  account?: string;
  facility?: string;
}

export interface Page {
  items: StoredEvent[];
  nextCursor: string | null;
}

interface Row {
  id: string;
  chain_id: number;
  block_number: number;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  facility: string;
  event: string;
  actor: string | null;
  data: string;
  observed_at: string | null;
}

export interface Db {
  upsertEvents(events: StoredEvent[]): void;
  events(filter: EventFilter): StoredEvent[];
  page(filter: EventFilter, options: { limit: number; cursor?: string }): Page;
  facilities(chainId: number): string[];
  blocksSince(chainId: number, fromBlock: number): { blockNumber: number; blockHash: string }[];
  deleteFromBlock(chainId: number, blockNumber: number): void;
  cursor(chainId: number): bigint | null;
  setCursor(chainId: number, block: bigint): void;
  close(): void;
}

function toEvent(row: Row): StoredEvent {
  return {
    schemaVersion: 1,
    id: row.id,
    chainId: row.chain_id,
    blockNumber: String(row.block_number),
    blockHash: row.block_hash,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    facility: row.facility,
    event: row.event,
    actor: row.actor,
    data: JSON.parse(row.data),
    observedAt: row.observed_at,
  };
}

export function encodeCursor(blockNumber: number, logIndex: number, id: string): string {
  return Buffer.from(JSON.stringify([blockNumber, logIndex, id])).toString("base64url");
}

export function decodeCursor(cursor: string): [number, number, string] | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" && typeof value[2] === "string") return [value[0], value[1], value[2]];
    return null;
  } catch {
    return null;
  }
}

function where(filter: EventFilter): { clause: string; params: (string | number)[] } {
  const parts = ["chain_id = ?"];
  const params: (string | number)[] = [filter.chainId];
  if (filter.account) {
    parts.push("actor = ?");
    params.push(filter.account.toLowerCase());
  }
  if (filter.facility) {
    parts.push("facility = ?");
    params.push(filter.facility.toLowerCase());
  }
  return { clause: parts.join(" AND "), params };
}

export function openDb(path: string): Db {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    facility TEXT NOT NULL,
    event TEXT NOT NULL,
    actor TEXT,
    data TEXT NOT NULL,
    observed_at TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS events_order ON events (chain_id, block_number, log_index)");
  db.exec("CREATE INDEX IF NOT EXISTS events_facility ON events (chain_id, facility)");
  db.exec("CREATE INDEX IF NOT EXISTS events_actor ON events (chain_id, actor)");
  db.exec("CREATE TABLE IF NOT EXISTS cursors (chain_id INTEGER PRIMARY KEY, block INTEGER NOT NULL)");

  const insert = db.prepare(
    `INSERT INTO events (id, chain_id, block_number, block_hash, tx_hash, log_index, facility, event, actor, data, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET block_number = excluded.block_number, block_hash = excluded.block_hash, data = excluded.data, observed_at = excluded.observed_at`,
  );

  return {
    upsertEvents(events) {
      const write = db.transaction((items: StoredEvent[]) => {
        for (const e of items) insert.run(e.id, e.chainId, Number(e.blockNumber), e.blockHash, e.txHash, e.logIndex, e.facility, e.event, e.actor, JSON.stringify(e.data), e.observedAt);
      });
      write(events);
    },
    events(filter) {
      const { clause, params } = where(filter);
      return (db.query(`SELECT * FROM events WHERE ${clause} ORDER BY block_number ASC, log_index ASC`).all(...params) as Row[]).map(toEvent);
    },
    page(filter, options) {
      const { clause, params } = where(filter);
      const cursor = options.cursor ? decodeCursor(options.cursor) : null;
      const cursorClause = cursor ? " AND (block_number < ? OR (block_number = ? AND log_index < ?))" : "";
      const cursorParams = cursor ? [cursor[0], cursor[0], cursor[1]] : [];
      const rows = db
        .query(`SELECT * FROM events WHERE ${clause}${cursorClause} ORDER BY block_number DESC, log_index DESC LIMIT ?`)
        .all(...params, ...cursorParams, options.limit + 1) as Row[];
      const items = rows.slice(0, options.limit).map(toEvent);
      const last = items[items.length - 1];
      const nextCursor = rows.length > options.limit && last ? encodeCursor(Number(last.blockNumber), last.logIndex, last.id) : null;
      return { items, nextCursor };
    },
    facilities(chainId) {
      const rows = db.query("SELECT facility FROM events WHERE chain_id = ? AND event = 'FacilityCreated' ORDER BY block_number ASC, log_index ASC").all(chainId) as { facility: string }[];
      return rows.map((row) => row.facility);
    },
    blocksSince(chainId, fromBlock) {
      const rows = db
        .query("SELECT DISTINCT block_number, block_hash FROM events WHERE chain_id = ? AND block_number >= ? ORDER BY block_number ASC")
        .all(chainId, fromBlock) as { block_number: number; block_hash: string }[];
      return rows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash }));
    },
    deleteFromBlock(chainId, blockNumber) {
      db.query("DELETE FROM events WHERE chain_id = ? AND block_number >= ?").run(chainId, blockNumber);
    },
    cursor(chainId) {
      const row = db.query("SELECT block FROM cursors WHERE chain_id = ?").get(chainId) as { block: number } | null;
      return row ? BigInt(row.block) : null;
    },
    setCursor(chainId, block) {
      db.query("INSERT INTO cursors (chain_id, block) VALUES (?, ?) ON CONFLICT(chain_id) DO UPDATE SET block = excluded.block").run(chainId, Number(block));
    },
    close() {
      db.close();
    },
  };
}
