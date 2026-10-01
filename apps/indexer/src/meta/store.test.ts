import { beforeEach, describe, expect, test } from "bun:test";
import { openMetaStore, type MetaStore } from "./store";

const FACILITY = "0x78627d25c5b35eca7326bc65833ff45e7b997ab9";
const A = "0x9b62bc224f93a8958ede04b12c6c29d363de04af";

let store: MetaStore;
beforeEach(() => {
  store = openMetaStore(":memory:");
});

describe("nonces", () => {
  test("a nonce is consumed once", () => {
    store.putNonce({ nonce: "n1", address: A, chainId: 421614, expiresAt: 100 });
    expect(store.takeNonce("n1", 50)).toMatchObject({ address: A, chainId: 421614 });
    expect(store.takeNonce("n1", 50)).toBeNull();
  });

  test("an expired nonce is rejected", () => {
    store.putNonce({ nonce: "n2", address: A, chainId: 421614, expiresAt: 100 });
    expect(store.takeNonce("n2", 101)).toBeNull();
  });
});

describe("sessions", () => {
  test("resolves an unexpired token and forgets an expired one", () => {
    store.putSession({ tokenHash: "h1", address: A, expiresAt: 100 });
    expect(store.session("h1", 50)).toBe(A);
    expect(store.session("h1", 101)).toBeNull();
    expect(store.session("missing", 50)).toBeNull();
  });
});

describe("metadata versions", () => {
  test("numbers drafts per facility and never rewrites them", () => {
    const first = store.addDraft({ chainId: 421614, facility: FACILITY, author: A, content: { company: "X" }, createdAt: "t1" });
    const second = store.addDraft({ chainId: 421614, facility: FACILITY, author: A, content: { company: "Y" }, createdAt: "t2" });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(store.draft(421614, FACILITY, 1)?.content).toEqual({ company: "X" });
    expect(store.drafts(421614, FACILITY)).toHaveLength(2);
  });

  test("keeps every approval and returns the latest one", () => {
    store.addDraft({ chainId: 421614, facility: FACILITY, author: A, content: { company: "X" }, createdAt: "t1" });
    store.addApproval({ chainId: 421614, facility: FACILITY, version: 1, reviewer: A, canonical: "{}", digest: "0x01", grade: "A", createdAt: "t2" });
    store.addApproval({ chainId: 421614, facility: FACILITY, version: 1, reviewer: A, canonical: "{ }", digest: "0x02", grade: "B", createdAt: "t3" });
    expect(store.latestApproval(421614, FACILITY)?.digest).toBe("0x02");
    expect(store.approvals(421614, FACILITY)).toHaveLength(2);
    expect(store.latestApproval(421614, "0x0000000000000000000000000000000000000001")).toBeNull();
  });
});

describe("documents", () => {
  test("versions the manifest as documents are stored", () => {
    const one = store.addDocument({ id: "d1", chainId: 421614, facility: FACILITY, name: "a.pdf", mime: "application/pdf", size: 10, visibility: "public", uploader: A, createdAt: "t1" });
    expect(one.status).toBe("pending");
    expect(store.documents(421614, FACILITY)).toHaveLength(0);
    store.markStored("d1", { sha256: "ab", path: "p1" });
    store.addDocument({ id: "d2", chainId: 421614, facility: FACILITY, name: "b.png", mime: "image/png", size: 5, visibility: "restricted", uploader: A, createdAt: "t2" });
    store.markStored("d2", { sha256: "cd", path: "p2" });
    const list = store.documents(421614, FACILITY);
    expect(list.map((item) => [item.id, item.version])).toEqual([["d1", 1], ["d2", 2]]);
    expect(store.document("d2")?.sha256).toBe("cd");
  });

  test("a stored document cannot be stored again", () => {
    store.addDocument({ id: "d1", chainId: 421614, facility: FACILITY, name: "a.pdf", mime: "application/pdf", size: 10, visibility: "public", uploader: A, createdAt: "t1" });
    store.markStored("d1", { sha256: "ab", path: "p1" });
    expect(() => store.markStored("d1", { sha256: "zz", path: "p9" })).toThrow();
  });
});
