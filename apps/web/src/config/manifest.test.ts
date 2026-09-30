import { describe, expect, it } from "vitest";
import { deploymentOf, enabledNetworks, loadManifest, ManifestError, networkFor, parseManifest } from "./manifest";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const network = (overrides: Record<string, unknown> = {}) => ({
  chainId: 421614,
  key: "arbitrum-sepolia",
  name: "Arbitrum Sepolia",
  enabled: true,
  rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  explorerUrl: "https://sepolia.arbiscan.io",
  confirmations: 2,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  asset: { address: address(1), symbol: "TestUSDC", decimals: 6, faucet: true },
  contracts: { factory: address(2), facilityImplementation: address(3) },
  deploymentBlock: "19434064",
  features: { writes: true, gaslessOriginator: false, duneAnalytics: false },
  ...overrides,
});

const robinhood = () =>
  network({
    chainId: 4663,
    key: "robinhood",
    name: "Robinhood Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    asset: { address: address(4), symbol: "USDG", decimals: 6, faucet: false },
    contracts: { factory: address(5), facilityImplementation: address(6) },
    multicall3: address(7),
    alchemyHost: "robinhood-mainnet",
  });

const manifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  defaultChainId: 421614,
  gitCommit: "a071006",
  networks: [network(), robinhood()],
  ...overrides,
});

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const parsed = parseManifest(manifest());
    expect(parsed.defaultChainId).toBe(421614);
    expect(parsed.networks).toHaveLength(2);
    expect(parsed.networks[1].multicall3).toBe(address(7));
    expect(parsed.networks[1].alchemyHost).toBe("robinhood-mainnet");
  });

  it("rejects anything that is not an object", () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest("nope")).toThrow(ManifestError);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseManifest(manifest({ schemaVersion: 2 }))).toThrow(/schema version/i);
  });

  it("rejects a manifest without networks", () => {
    expect(() => parseManifest(manifest({ networks: [] }))).toThrow(/no networks/i);
  });

  it("rejects a malformed contract address", () => {
    const bad = network({ contracts: { factory: "0x123", facilityImplementation: address(3) } });
    expect(() => parseManifest(manifest({ networks: [bad] }))).toThrow(/factory/);
  });

  it("rejects a malformed asset", () => {
    const bad = network({ asset: { address: address(1), symbol: "", decimals: 6, faucet: true } });
    expect(() => parseManifest(manifest({ networks: [bad] }))).toThrow(/asset/);
  });

  it("rejects a non-numeric deployment block", () => {
    expect(() => parseManifest(manifest({ networks: [network({ deploymentBlock: "abc" })] }))).toThrow(/deploymentBlock/);
  });

  it("rejects duplicate chain ids", () => {
    expect(() => parseManifest(manifest({ networks: [network(), network()] }))).toThrow(/duplicate/i);
  });

  it("rejects a default chain that is missing", () => {
    expect(() => parseManifest(manifest({ defaultChainId: 1 }))).toThrow(/default/i);
  });

  it("rejects a default chain that is disabled", () => {
    const disabled = network({ enabled: false });
    expect(() => parseManifest(manifest({ networks: [disabled, robinhood()] }))).toThrow(/default/i);
  });

  it("rejects a manifest where nothing is enabled", () => {
    const off = [network({ enabled: false }), { ...robinhood(), enabled: false }];
    expect(() => parseManifest(manifest({ networks: off, defaultChainId: 4663 }))).toThrow(/enabled/i);
  });

  it("rejects a non-https rpc url", () => {
    expect(() => parseManifest(manifest({ networks: [network({ rpcUrl: "ftp://x" })] }))).toThrow(/rpcUrl/);
  });
});

describe("network lookup", () => {
  const parsed = parseManifest(manifest({ networks: [network(), { ...robinhood(), enabled: false }] }));

  it("lists only enabled networks", () => {
    expect(enabledNetworks(parsed).map((n) => n.chainId)).toEqual([421614]);
  });

  it("finds an enabled network by chain id", () => {
    expect(networkFor(parsed, 421614)?.name).toBe("Arbitrum Sepolia");
  });

  it("does not return a disabled network", () => {
    expect(networkFor(parsed, 4663)).toBeUndefined();
  });

  it("returns undefined for a chain that is not in the manifest", () => {
    expect(networkFor(parsed, 1)).toBeUndefined();
  });
});

describe("deploymentOf", () => {
  it("maps a network to the values the app reads", () => {
    const parsed = parseManifest(manifest());
    const deployment = deploymentOf(parsed.networks[0]);
    expect(deployment).toEqual({
      chainId: 421614,
      factory: address(2),
      asset: address(1),
      assetSymbol: "TestUSDC",
      assetDecimals: 6,
      faucet: true,
      explorer: "https://sepolia.arbiscan.io",
      confirmations: 2,
      writes: true,
      deploymentBlock: 19434064n,
    });
  });
});

describe("loadManifest", () => {
  const respond = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
    (async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body })) as unknown as typeof fetch;

  it("returns the parsed manifest", async () => {
    const parsed = await loadManifest(respond(manifest()), "/manifest.json");
    expect(parsed.networks).toHaveLength(2);
  });

  it("reports an http failure", async () => {
    await expect(loadManifest(respond({}, { ok: false, status: 404 }), "/manifest.json")).rejects.toThrow(/404/);
  });

  it("reports a network failure", async () => {
    const failing = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    await expect(loadManifest(failing, "/manifest.json")).rejects.toThrow(/could not load/i);
  });

  it("reports an invalid document", async () => {
    await expect(loadManifest(respond({ schemaVersion: 9 }), "/manifest.json")).rejects.toThrow(ManifestError);
  });

  it("reports a body that is not json", async () => {
    const broken = (async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } })) as unknown as typeof fetch;
    await expect(loadManifest(broken, "/manifest.json")).rejects.toThrow(/not valid json/i);
  });
});
