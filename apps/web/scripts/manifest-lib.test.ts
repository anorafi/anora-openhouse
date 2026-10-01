import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/config/manifest";
import { assembleManifest, buildAbiBundle, findDeploymentBlock, proxyRpcUrl, verifyNetworkState, type BroadcastRun, type RawDeployment } from "./manifest-lib";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const run = (contract: string, hash: string, block: string): BroadcastRun => ({
  transactions: [{ contractName: "AnoraFactory", contractAddress: contract, hash }],
  receipts: [{ transactionHash: hash, blockNumber: block }],
});

describe("findDeploymentBlock", () => {
  const runs = [run(address(9), "0xaa", "0x10"), run(address(2).toUpperCase().replace("0X", "0x"), "0xbb", "0x1f")];

  it("matches the factory address regardless of case and reads the hex block", () => {
    expect(findDeploymentBlock(runs, address(2))).toEqual({ block: 31n, txHash: "0xbb" });
  });

  it("fails hard when no broadcast produced the factory", () => {
    expect(() => findDeploymentBlock(runs, address(3))).toThrow(/no broadcast/i);
  });

  it("fails hard when the deployment has no receipt", () => {
    const orphan: BroadcastRun = { transactions: [{ contractName: "AnoraFactory", contractAddress: address(4), hash: "0xcc" }], receipts: [] };
    expect(() => findDeploymentBlock([orphan], address(4))).toThrow(/receipt/i);
  });
});

describe("verifyNetworkState", () => {
  const entry: RawDeployment = {
    chainId: 421614,
    asset: address(1),
    assetSymbol: "TestUSDC",
    faucet: true,
    AnoraFactory: address(2),
    AnoraFacilityImplementation: address(3),
    minFirstLossBps: 1000,
    explorer: "https://sepolia.arbiscan.io",
  };
  const good = {
    factoryCode: "0x6080",
    implementationCode: "0x6081",
    asset: address(1),
    minFirstLossBps: 1000n,
    paused: false,
    implementation: address(3),
    assetDecimals: 6,
  };

  it("accepts a network whose chain state matches the record", () => {
    expect(verifyNetworkState(entry, good)).toEqual({ ok: true });
  });

  it("rejects an address with no bytecode", () => {
    expect(verifyNetworkState(entry, { ...good, factoryCode: "0x" })).toEqual({ ok: false, reason: expect.stringMatching(/factory has no bytecode/i) });
    expect(verifyNetworkState(entry, { ...good, implementationCode: undefined })).toEqual({ ok: false, reason: expect.stringMatching(/implementation has no bytecode/i) });
  });

  it("rejects a factory pointing at another asset", () => {
    expect(verifyNetworkState(entry, { ...good, asset: address(8) })).toEqual({ ok: false, reason: expect.stringMatching(/asset/i) });
  });

  it("rejects a different minimum first loss", () => {
    expect(verifyNetworkState(entry, { ...good, minFirstLossBps: 500n })).toEqual({ ok: false, reason: expect.stringMatching(/minFirstLossBps/) });
  });

  it("rejects a paused factory", () => {
    expect(verifyNetworkState(entry, { ...good, paused: true })).toEqual({ ok: false, reason: expect.stringMatching(/paused/i) });
  });

  it("rejects a factory using another implementation", () => {
    expect(verifyNetworkState(entry, { ...good, implementation: address(8) })).toEqual({ ok: false, reason: expect.stringMatching(/implementation/i) });
  });
});

describe("assembleManifest", () => {
  const network = (chainId: number, key: string) => ({
    chainId,
    key,
    name: key,
    enabled: true,
    rpcUrl: "https://rpc.example",
    explorerUrl: "https://explorer.example",
    confirmations: 2,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    asset: { address: address(1), symbol: "TestUSDC", decimals: 6, faucet: true },
    contracts: { factory: address(2), facilityImplementation: address(3) },
    deploymentBlock: "10",
    features: { writes: true, gaslessOriginator: false, duneAnalytics: false },
  });

  it("produces a document the web parser accepts", () => {
    const manifest = assembleManifest({ defaultChainId: 421614, gitCommit: "abc1234", networks: [network(421614, "arbitrum-sepolia"), network(4663, "robinhood")] });
    expect(parseManifest(manifest).networks.map((n) => n.key)).toEqual(["arbitrum-sepolia", "robinhood"]);
  });

  it("refuses to publish a document the web parser rejects", () => {
    expect(() => assembleManifest({ defaultChainId: 1, gitCommit: "abc1234", networks: [network(421614, "arbitrum-sepolia")] })).toThrow(/default/i);
  });
});

describe("buildAbiBundle", () => {
  it("carries both abis, the commit and the code hashes per chain", () => {
    const bundle = buildAbiBundle({
      gitCommit: "abc1234",
      abi: { AnoraFactory: [{ type: "function", name: "asset" }], AnoraFacility: [{ type: "function", name: "deposit" }] },
      codeHashes: { 421614: { factory: "0x11", facilityImplementation: "0x22" } },
    });
    expect(bundle).toEqual({
      schemaVersion: 1,
      gitCommit: "abc1234",
      abi: { AnoraFactory: [{ type: "function", name: "asset" }], AnoraFacility: [{ type: "function", name: "deposit" }] },
      codeHashes: { "421614": { factory: "0x11", facilityImplementation: "0x22" } },
    });
  });
});

describe("proxyRpcUrl", () => {
  it("points at the indexer proxy for the chain", () => {
    expect(proxyRpcUrl("https://anora-api.dimsky.xyz", 421614)).toBe("https://anora-api.dimsky.xyz/rpc/421614");
  });

  it("tolerates a trailing slash", () => {
    expect(proxyRpcUrl("https://anora-api.dimsky.xyz/", 4663)).toBe("https://anora-api.dimsky.xyz/rpc/4663");
  });

  it("returns nothing without an indexer address", () => {
    expect(proxyRpcUrl(undefined, 4663)).toBeUndefined();
  });
});
