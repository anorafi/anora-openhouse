import { describe, expect, it } from "vitest";
import { describeMetadataError, documentRows, fetchDocuments, fetchMetadata, MetadataError, reviewLabel, signIn, type UnderwritingRecord } from "./metadata";

const API = "https://anora-api.dimsky.xyz";
const FACILITY = "0x78627d25c5b35eca7326bc65833fff45e7b997ab9";
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const record = (overrides: Partial<UnderwritingRecord> = {}): UnderwritingRecord => ({
  status: "approved",
  version: 1,
  digest: `0x${"ab".repeat(32)}`,
  anchored: true,
  reviewer: "0x77e6296ff0b10edc6e74a38c491c3e28c501d064",
  approvedAt: "2026-09-30T09:00:00.000Z",
  metadata: { company: "PT Nusantara", route: "Indonesia to Singapore", financingType: "Export receivables", operatingHistoryYears: 9, verifiedAssets: 22, buyerConcentrationPct: 46, documentCoverage: 1.18 },
  underwriting: { grade: "A", note: "ok", reviewedAt: "2026-09-30T09:00:00.000Z" },
  ...overrides,
});

describe("fetchMetadata", () => {
  it("returns the approved record from the service", async () => {
    let requested = "";
    const state = await fetchMetadata(async (url) => ((requested = String(url)), respond(record())), API, 421614, FACILITY);
    expect(requested).toBe(`${API}/v1/facilities/421614/${FACILITY}/metadata`);
    expect(state).toEqual({ kind: "record", record: record() });
  });

  it("treats a missing record as none", async () => {
    expect(await fetchMetadata(async () => respond({ error: { code: "METADATA_NOT_FOUND", message: "none" } }, 404), API, 421614, FACILITY)).toEqual({ kind: "none" });
  });

  it("raises a typed error when the service or the chain read fails", async () => {
    await expect(fetchMetadata(async () => respond({ error: { code: "METADATA_UNAVAILABLE", message: "rpc down" } }, 503), API, 421614, FACILITY)).rejects.toMatchObject({ code: "METADATA_UNAVAILABLE" });
    await expect(fetchMetadata(async () => Promise.reject(new Error("offline")), API, 421614, FACILITY)).rejects.toMatchObject({ code: "METADATA_UNAVAILABLE" });
    await expect(fetchMetadata(async () => respond({ error: { code: "FACILITY_NOT_FOUND", message: "x" } }, 404), API, 421614, FACILITY)).rejects.toBeInstanceOf(MetadataError);
  });
});

describe("reviewLabel", () => {
  it("says the digest matches onchain for an anchored record", () => {
    const label = reviewLabel({ kind: "record", record: record() });
    expect(label).toEqual({ sample: false, text: "Approved by reviewer 0x77e6…d064, digest matches onchain" });
  });

  it("says the record is not anchored yet when the digest differs", () => {
    expect(reviewLabel({ kind: "record", record: record({ anchored: false }) })).toEqual({ sample: false, text: "Approved, not yet anchored onchain" });
  });

  it("keeps the sample label only when there is no record", () => {
    expect(reviewLabel({ kind: "none" })).toEqual({ sample: true, text: "Sample data · no approved underwriting record" });
  });
});

describe("documents", () => {
  it("adds the bearer token only when signed in and lists what the service returns", async () => {
    let headers: Record<string, string> = {};
    const items = [{ id: "d1", name: "invoice.pdf", mime: "application/pdf", size: 10, sha256: "ab".repeat(32), version: 1, visibility: "public", restricted: false, url: "/v1/downloads/d1?exp=1&sig=2" }];
    const list = await fetchDocuments(async (_url, init) => ((headers = (init?.headers ?? {}) as Record<string, string>), respond({ manifestVersion: 1, items })), API, 421614, FACILITY, "tok");
    expect(headers.authorization).toBe("Bearer tok");
    expect(list.items).toHaveLength(1);
    await fetchDocuments(async (_url, init) => ((headers = (init?.headers ?? {}) as Record<string, string>), respond({ manifestVersion: 0, items: [] })), API, 421614, FACILITY);
    expect(headers.authorization).toBeUndefined();
  });

  it("links only documents the reader may open and asks the rest to sign in", () => {
    const rows = documentRows(
      [
        { id: "d1", name: "invoice.pdf", mime: "application/pdf", size: 10, sha256: "ab".repeat(32), version: 1, visibility: "public", restricted: false, url: "/v1/downloads/d1?exp=1&sig=2" },
        { id: "d2", name: "contract.pdf", mime: "application/pdf", size: 10, sha256: "cd".repeat(32), version: 2, visibility: "restricted", restricted: true, url: null },
      ],
      API,
    );
    expect(rows[0]).toMatchObject({ title: "invoice.pdf", badge: "Public", href: `${API}/v1/downloads/d1?exp=1&sig=2`, signIn: false });
    expect(rows[1]).toMatchObject({ title: "contract.pdf", badge: "Restricted", href: null, signIn: true });
    expect(rows[1].detail).toContain("cdcdcdcdcdcd");
  });
});

describe("signIn", () => {
  it("asks for a nonce, signs the message, and returns the session token", async () => {
    const calls: string[] = [];
    const token = await signIn(
      async (url, init) => {
        calls.push(`${init?.method} ${String(url).replace(API, "")}`);
        return String(url).endsWith("/nonce") ? respond({ message: "sign me" }) : respond({ token: "t".repeat(64) });
      },
      API,
      { address: "0x9b62bc224f93a8958ede04b12c6c29d363de04af", chainId: 421614, sign: async (message) => `signed:${message}` },
    );
    expect(token).toBe("t".repeat(64));
    expect(calls).toEqual(["POST /v1/auth/nonce", "POST /v1/auth/verify"]);
  });

  it("raises a typed error when the signature is refused", async () => {
    await expect(
      signIn(async (url) => (String(url).endsWith("/nonce") ? respond({ message: "m" }) : respond({ error: { code: "INVALID_SIGNATURE", message: "bad" } }, 401)), API, { address: "0x9b62bc224f93a8958ede04b12c6c29d363de04af", chainId: 421614, sign: async () => "sig" }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });
});

describe("describeMetadataError", () => {
  it("names the typed code so the outage is explicit", () => {
    expect(describeMetadataError(new MetadataError("METADATA_UNAVAILABLE", "rpc down"))).toBe("METADATA_UNAVAILABLE: rpc down");
    expect(describeMetadataError(new Error("x"))).toBe("METADATA_UNAVAILABLE: x");
  });
});
