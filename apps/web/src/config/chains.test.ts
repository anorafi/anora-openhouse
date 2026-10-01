import { describe, expect, it } from "vitest";
import { chainOf, orderedNetworks } from "./chains";
import { parseManifest, type ManifestNetwork } from "./manifest";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const network = (overrides: Partial<ManifestNetwork> = {}): ManifestNetwork => ({
  chainId: 421614,
  key: "arbitrum-sepolia",
  name: "Arbitrum Sepolia",
  enabled: true,
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  explorerUrl: "https://sepolia.arbiscan.io",
  confirmations: 2,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  asset: { address: address(1) as `0x${string}`, symbol: "TestUSDC", decimals: 6, faucet: true },
  contracts: { factory: address(2) as `0x${string}`, facilityImplementation: address(3) as `0x${string}` },
  deploymentBlock: "1",
  features: { writes: true, gaslessOriginator: false, duneAnalytics: false, riskModel: false },
  ...overrides,
});

describe("chainOf", () => {
  it("describes the chain from the manifest entry", () => {
    const chain = chainOf(network());
    expect(chain.id).toBe(421614);
    expect(chain.name).toBe("Arbitrum Sepolia");
    expect(chain.nativeCurrency.symbol).toBe("ETH");
    expect(chain.rpcUrls.default.http).toEqual(["https://sepolia-rollup.arbitrum.io/rpc"]);
    expect(chain.blockExplorers?.default.url).toBe("https://sepolia.arbiscan.io");
    expect(chain.contracts).toBeUndefined();
  });

  it("gives wagmi a multicall3 contract to batch reads with", () => {
    const chain = chainOf(network({ multicall3: address(7) as `0x${string}` }));
    expect(chain.contracts?.multicall3).toEqual({ address: address(7) });
  });

  it("registers multicall3 when the manifest provides it", () => {
    const chain = chainOf(network({ multicall3: address(7) as `0x${string}` }));
    expect(chain.contracts?.multicall3?.address).toBe(address(7));
  });
});

describe("orderedNetworks", () => {
  const other = (chainId: number, enabled = true) => ({ ...network({ chainId, key: `k${chainId}`, name: `n${chainId}`, enabled }), asset: { address: address(1), symbol: "X", decimals: 6, faucet: false }, contracts: { factory: address(2), facilityImplementation: address(3) } });
  const manifest = parseManifest({ schemaVersion: 1, defaultChainId: 4663, networks: [network(), other(4663), other(5, false)] });

  it("puts the default chain first and drops disabled ones", () => {
    expect(orderedNetworks(manifest).map((n) => n.chainId)).toEqual([4663, 421614]);
  });
});
