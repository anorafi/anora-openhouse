import { describe, expect, test } from "bun:test";
import { createChainReader } from "./chain";

const FACILITY = "0x78627d25c5B35ECa7326BC65833FF45E7b997AB9";
const answers: Record<string, string> = {
  originator: "0x9b62Bc224F93a8958EDe04b12c6C29d363dE04aF",
  riskAgent: "0x77E6296ff0b10eDc6e74a38c491c3e28c501D064",
  evidenceHash: `0x${"ab".repeat(32)}`,
};

describe("chain reader", () => {
  test("reads the originator, the risk agent, and the evidence hash of a facility", async () => {
    const calls: string[] = [];
    const reader = createChainReader({
      421614: {
        readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
          calls.push(`${address}:${functionName}`);
          return answers[functionName];
        },
      },
    } as never);
    expect(await reader.facility(421614, FACILITY)).toEqual({ originator: answers.originator, riskAgent: answers.riskAgent, evidenceHash: answers.evidenceHash });
    expect(calls.sort()).toEqual([`${FACILITY}:evidenceHash`, `${FACILITY}:originator`, `${FACILITY}:riskAgent`]);
  });

  test("fails for a chain without a client", async () => {
    await expect(createChainReader({} as never).facility(1, FACILITY)).rejects.toThrow();
  });

  test("passes a failing rpc through", async () => {
    const reader = createChainReader({ 1: { readContract: async () => Promise.reject(new Error("rpc down")) } } as never);
    await expect(reader.facility(1, FACILITY)).rejects.toThrow("rpc down");
  });
});
