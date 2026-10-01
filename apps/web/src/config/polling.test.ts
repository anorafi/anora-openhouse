import { describe, expect, it } from "vitest";
import { CHAIN_POLL_MS, INDEXER_POLL_MS } from "./polling";

const sources = import.meta.glob("../hooks/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("polling", () => {
  it("reads the chain no more often than every fifteen seconds", () => {
    expect(CHAIN_POLL_MS).toBeGreaterThanOrEqual(15_000);
    expect(INDEXER_POLL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("keeps every hook on the shared intervals instead of its own number", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/refetchInterval:\s*\d/);
      expect(source, file).not.toMatch(/REFETCH_MS\s*=\s*\d/);
    }
  });

  it("does not poll in a hidden tab", () => {
    for (const [file, source] of Object.entries(sources)) expect(source, file).not.toMatch(/refetchIntervalInBackground:\s*true/);
  });
});
