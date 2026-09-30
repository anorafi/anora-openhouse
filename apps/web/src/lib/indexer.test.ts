import { describe, expect, it } from "vitest";
import { describeIndexerError, fetchIndexerActivity, IndexerError, toChainLogs } from "./indexer";

const FACILITY = "0x78627d25c5b35eca7326bc65833fff45e7b997ab9";
const PROVIDER = "0xffa9a8409d1eeed0df6abfcf891896b10661e70b";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "4663:0xabc:1",
  chainId: 4663,
  facility: FACILITY,
  event: "Deposited",
  txHash: "0xabc",
  observedAt: "2026-09-30T08:00:00.000Z",
  data: { provider: PROVIDER, tranche: "SENIOR", assets: "6000000", shares: "6000000" },
  ...overrides,
});

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("toChainLogs", () => {
  it("restores bigint amounts and keeps text and addresses as they are", () => {
    const [log] = toChainLogs([item()]);
    expect(log.id).toBe("4663:0xabc:1");
    expect(log.facility).toBe(FACILITY);
    expect(log.eventName).toBe("Deposited");
    expect(log.args.assets).toBe(6_000_000n);
    expect(log.args.provider).toBe(PROVIDER);
    expect(log.args.tranche).toBe("SENIOR");
    expect(log.at).toBe(Date.parse("2026-09-30T08:00:00.000Z"));
    expect(log.txHash).toBe("0xabc");
  });

  it("does not turn numeric-looking names into numbers", () => {
    const [log] = toChainLogs([item({ event: "FacilityCreated", data: { name: "12345", limit: "10000000", firstLoss: "3000000" } })]);
    expect(log.args.name).toBe("12345");
    expect(log.args.limit).toBe(10_000_000n);
  });

  it("uses the block time zero when the indexer has none", () => {
    expect(toChainLogs([item({ observedAt: null })])[0].at).toBe(0);
  });
});

describe("fetchIndexerActivity", () => {
  it("follows the cursor until the last page", async () => {
    const urls: string[] = [];
    const pages = [
      { items: [item({ id: "a" })], nextCursor: "c1" },
      { items: [item({ id: "b" })], nextCursor: null },
    ];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return respond(pages[urls.length - 1]);
    }) as unknown as typeof fetch;
    const logs = await fetchIndexerActivity(fetchImpl, "https://anora-api.dimsky.xyz", 4663);
    expect(logs.map((log) => log.id)).toEqual(["a", "b"]);
    expect(urls[0]).toBe("https://anora-api.dimsky.xyz/v1/activity?chainId=4663&limit=500");
    expect(urls[1]).toContain("cursor=c1");
  });

  it("raises INDEXER_BEHIND with both blocks", async () => {
    const fetchImpl = (async () => respond({ error: { code: "INDEXER_BEHIND", message: "behind", indexedBlock: "100", chainBlock: "900" } }, 503)) as unknown as typeof fetch;
    const error = await fetchIndexerActivity(fetchImpl, "https://x", 1).catch((e) => e);
    expect(error).toBeInstanceOf(IndexerError);
    expect(error.code).toBe("INDEXER_BEHIND");
    expect(describeIndexerError(error)).toContain("800 blocks");
  });

  it("raises RPC_UNAVAILABLE and INDEXER_UNREACHABLE without falling back to anything else", async () => {
    const rpc = (async () => respond({ error: { code: "RPC_UNAVAILABLE", message: "no head" } }, 503)) as unknown as typeof fetch;
    expect((await fetchIndexerActivity(rpc, "https://x", 1).catch((e) => e)).code).toBe("RPC_UNAVAILABLE");
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const error = await fetchIndexerActivity(down, "https://x", 1).catch((e) => e);
    expect(error.code).toBe("INDEXER_UNREACHABLE");
  });
});

describe("describeIndexerError", () => {
  it("gives a plain message per code", () => {
    expect(describeIndexerError(new IndexerError("RPC_UNAVAILABLE", "x"))).toMatch(/chain/i);
    expect(describeIndexerError(new IndexerError("INDEXER_UNREACHABLE", "x"))).toMatch(/reach/i);
    expect(describeIndexerError(new Error("boom"))).toBe("boom");
  });
});
