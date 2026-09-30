import { describe, expect, it } from "vitest";
import abiBundle from "../../public/abi.json";
import publishedManifest from "../../public/manifest.json";
import { deploymentOf, networkFor, parseManifest } from "./manifest";

describe("published manifest", () => {
  const manifest = parseManifest(publishedManifest);

  it("is accepted by the runtime parser", () => {
    expect(manifest.schemaVersion).toBe(1);
  });

  it("serves Arbitrum Sepolia by default with a faucet asset", () => {
    expect(manifest.defaultChainId).toBe(421614);
    const deployment = deploymentOf(networkFor(manifest, 421614)!);
    expect(deployment.assetSymbol).toBe("TestUSDC");
    expect(deployment.faucet).toBe(true);
  });

  it("serves Robinhood Chain with real USDG", () => {
    const deployment = deploymentOf(networkFor(manifest, 4663)!);
    expect(deployment.assetSymbol).toBe("USDG");
    expect(deployment.faucet).toBe(false);
  });

  it("reads every chain through the indexer proxy and keeps a public fallback", () => {
    for (const network of manifest.networks) {
      expect(network.rpcUrl).toBe(`${network.indexerApi}/rpc/${network.chainId}`);
      expect(network.publicRpcUrl).toBeDefined();
      expect(network.publicRpcUrl).not.toContain("/rpc/" + network.chainId);
      expect(JSON.stringify(network)).not.toMatch(/g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/);
    }
  });

  it("registers multicall3 on every chain so contract reads collapse into one call", () => {
    for (const network of manifest.networks) expect(network.multicall3, network.key).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
  });

  it("does not know other chains", () => {
    expect(networkFor(manifest, 1)).toBeUndefined();
  });

  it("carries an abi bundle with both contracts and a code hash per chain", () => {
    const bundle = abiBundle as { abi: Record<string, unknown>; gitCommit: string; codeHashes: Record<string, { factory: string }> };
    expect(Object.keys(bundle.abi).sort()).toEqual(["AnoraFacility", "AnoraFactory"]);
    expect(bundle.gitCommit).toBe(manifest.gitCommit);
    expect(Object.keys(bundle.codeHashes).sort()).toEqual(["421614", "4663"]);
    expect(bundle.codeHashes["421614"].factory).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
