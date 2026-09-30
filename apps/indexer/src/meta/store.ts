import { Database } from "bun:sqlite";

export interface Draft {
  id: number;
  chainId: number;
  facility: string;
  version: number;
  author: string;
  content: Record<string, unknown>;
  createdAt: string;
}

export interface Approval {
  id: number;
  chainId: number;
  facility: string;
  version: number;
  reviewer: string;
  canonical: string;
  digest: string;
  grade: string;
  createdAt: string;
}

export interface StoredDocument {
  id: string;
  chainId: number;
  facility: string;
  name: string;
  mime: string;
  size: number;
  visibility: "public" | "restricted";
  uploader: string;
  status: "pending" | "stored";
  sha256: string | null;
  path: string | null;
  version: number | null;
  createdAt: string;
}

export interface NewDraft extends Omit<Draft, "id" | "version"> {}
export interface NewApproval extends Omit<Approval, "id"> {}
export interface NewDocument extends Omit<StoredDocument, "status" | "sha256" | "path" | "version"> {}

export interface MetaStore {
  putNonce(row: { nonce: string; address: string; chainId: number; expiresAt: number }): void;
  takeNonce(nonce: string, now: number): { address: string; chainId: number } | null;
  putSession(row: { tokenHash: string; address: string; expiresAt: number }): void;
  session(tokenHash: string, now: number): string | null;
  addDraft(draft: NewDraft): Draft;
  draft(chainId: number, facility: string, version: number): Draft | null;
  drafts(chainId: number, facility: string): Draft[];
  addApproval(approval: NewApproval): Approval;
  latestApproval(chainId: number, facility: string): Approval | null;
  approvals(chainId: number, facility: string): Approval[];
  addDocument(document: NewDocument): StoredDocument;
  markStored(id: string, stored: { sha256: string; path: string }): StoredDocument;
  document(id: string): StoredDocument | null;
  documents(chainId: number, facility: string): StoredDocument[];
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta_nonces (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta_sessions (token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, facility TEXT NOT NULL, version INTEGER NOT NULL,
  author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (chain_id, facility, version)
);
CREATE TABLE IF NOT EXISTS meta_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id INTEGER NOT NULL, facility TEXT NOT NULL, version INTEGER NOT NULL,
  reviewer TEXT NOT NULL, canonical TEXT NOT NULL, digest TEXT NOT NULL, grade TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_approvals_facility ON meta_approvals (chain_id, facility, id);
CREATE TABLE IF NOT EXISTS meta_documents (
  id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, facility TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  visibility TEXT NOT NULL, uploader TEXT NOT NULL, status TEXT NOT NULL, sha256 TEXT, path TEXT, version INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_documents_facility ON meta_documents (chain_id, facility, version);
`;

const toDraft = (row: any): Draft => ({ id: row.id, chainId: row.chain_id, facility: row.facility, version: row.version, author: row.author, content: JSON.parse(row.content), createdAt: row.created_at });
const toApproval = (row: any): Approval => ({ id: row.id, chainId: row.chain_id, facility: row.facility, version: row.version, reviewer: row.reviewer, canonical: row.canonical, digest: row.digest, grade: row.grade, createdAt: row.created_at });
const toDocument = (row: any): StoredDocument => ({
  id: row.id,
  chainId: row.chain_id,
  facility: row.facility,
  name: row.name,
  mime: row.mime,
  size: row.size,
  visibility: row.visibility,
  uploader: row.uploader,
  status: row.status,
  sha256: row.sha256,
  path: row.path,
  version: row.version,
  createdAt: row.created_at,
});

export function openMetaStore(path: string): MetaStore {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const nextVersion = db.query<{ next: number }, [number, string]>("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM meta_drafts WHERE chain_id = ? AND facility = ?");
  const insertDraft = db.query("INSERT INTO meta_drafts (chain_id, facility, version, author, content, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *");
  const nextDocumentVersion = db.query<{ next: number }, [number, string]>("SELECT COALESCE(MAX(version), 0) + 1 AS next FROM meta_documents WHERE chain_id = ? AND facility = ? AND status = 'stored'");

  return {
    putNonce: (row) => void db.query("INSERT INTO meta_nonces (nonce, address, chain_id, expires_at) VALUES (?, ?, ?, ?)").run(row.nonce, row.address, row.chainId, row.expiresAt),
    takeNonce(nonce, now) {
      const row = db.query<any, [string]>("DELETE FROM meta_nonces WHERE nonce = ? RETURNING address, chain_id, expires_at").get(nonce);
      if (!row || row.expires_at < now) return null;
      return { address: row.address, chainId: row.chain_id };
    },
    putSession: (row) => void db.query("INSERT INTO meta_sessions (token_hash, address, expires_at) VALUES (?, ?, ?)").run(row.tokenHash, row.address, row.expiresAt),
    session(tokenHash, now) {
      const row = db.query<any, [string]>("SELECT address, expires_at FROM meta_sessions WHERE token_hash = ?").get(tokenHash);
      if (!row) return null;
      if (row.expires_at < now) {
        db.query("DELETE FROM meta_sessions WHERE token_hash = ?").run(tokenHash);
        return null;
      }
      return row.address;
    },
    addDraft(draft) {
      const create = db.transaction(() => {
        const version = nextVersion.get(draft.chainId, draft.facility)!.next;
        return insertDraft.get(draft.chainId, draft.facility, version, draft.author, JSON.stringify(draft.content), draft.createdAt);
      });
      return toDraft(create());
    },
    draft(chainId, facility, version) {
      const row = db.query<any, [number, string, number]>("SELECT * FROM meta_drafts WHERE chain_id = ? AND facility = ? AND version = ?").get(chainId, facility, version);
      return row ? toDraft(row) : null;
    },
    drafts: (chainId, facility) => db.query<any, [number, string]>("SELECT * FROM meta_drafts WHERE chain_id = ? AND facility = ? ORDER BY version").all(chainId, facility).map(toDraft),
    addApproval: (approval) =>
      toApproval(
        db
          .query("INSERT INTO meta_approvals (chain_id, facility, version, reviewer, canonical, digest, grade, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
          .get(approval.chainId, approval.facility, approval.version, approval.reviewer, approval.canonical, approval.digest, approval.grade, approval.createdAt),
      ),
    latestApproval(chainId, facility) {
      const row = db.query<any, [number, string]>("SELECT * FROM meta_approvals WHERE chain_id = ? AND facility = ? ORDER BY id DESC LIMIT 1").get(chainId, facility);
      return row ? toApproval(row) : null;
    },
    approvals: (chainId, facility) => db.query<any, [number, string]>("SELECT * FROM meta_approvals WHERE chain_id = ? AND facility = ? ORDER BY id").all(chainId, facility).map(toApproval),
    addDocument: (document) => {
      db.query("INSERT INTO meta_documents (id, chain_id, facility, name, mime, size, visibility, uploader, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)").run(
        document.id,
        document.chainId,
        document.facility,
        document.name,
        document.mime,
        document.size,
        document.visibility,
        document.uploader,
        document.createdAt,
      );
      return toDocument(db.query<any, [string]>("SELECT * FROM meta_documents WHERE id = ?").get(document.id));
    },
    markStored(id, stored) {
      const apply = db.transaction(() => {
        const current = db.query<any, [string]>("SELECT * FROM meta_documents WHERE id = ?").get(id);
        if (!current) throw new Error("Unknown document.");
        if (current.status !== "pending") throw new Error("Document is already stored.");
        const version = nextDocumentVersion.get(current.chain_id, current.facility)!.next;
        db.query("UPDATE meta_documents SET status = 'stored', sha256 = ?, path = ?, version = ? WHERE id = ?").run(stored.sha256, stored.path, version, id);
        return db.query<any, [string]>("SELECT * FROM meta_documents WHERE id = ?").get(id);
      });
      return toDocument(apply());
    },
    document(id) {
      const row = db.query<any, [string]>("SELECT * FROM meta_documents WHERE id = ?").get(id);
      return row ? toDocument(row) : null;
    },
    documents: (chainId, facility) =>
      db.query<any, [number, string]>("SELECT * FROM meta_documents WHERE chain_id = ? AND facility = ? AND status = 'stored' ORDER BY version").all(chainId, facility).map(toDocument),
    close: () => db.close(),
  };
}
