import { describe, expect, it } from "vitest";
import { deploymentFor, supportedChainIds } from "./deployments";

describe("deploymentFor", () => {
  it("returns the Arbitrum Sepolia deployment with a live factory", () => {
    const deployment = deploymentFor(421614);
    expect(deployment).toBeDefined();
    expect(deployment?.factory).toBe("0x04f037908F2BdFdD75363E5eBc5F46f6b5834d22");
    expect(deployment?.assetSymbol).toBe("TestUSDC");
    expect(deployment?.faucet).toBe(true);
  });

  it("returns the Robinhood Chain deployment with a live factory", () => {
    const deployment = deploymentFor(4663);
    expect(deployment).toBeDefined();
    expect(deployment?.factory).toBe("0x9300dbB89FC8a64dcD61511c9d17f5B5eF3E039b");
    expect(deployment?.assetSymbol).toBe("USDG");
    expect(deployment?.faucet).toBe(false);
  });

  it("returns undefined for an unsupported chain", () => {
    expect(deploymentFor(1)).toBeUndefined();
  });
});

describe("supportedChainIds", () => {
  it("lists both configured chains", () => {
    expect(supportedChainIds().sort()).toEqual([421614, 4663]);
  });
});
