import { afterEach, describe, expect, it, vi } from "vitest";
import { parseManifest } from "./manifest";
import { createWagmiConfig } from "./wagmi";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const network = (chainId: number, key: string, overrides: Record<string, unknown> = {}) => ({
  chainId,
  key,
  name: key,
  enabled: true,
  rpcUrl: `https://anora-api.dimsky.xyz/rpc/${chainId}`,
  publicRpcUrl: "https://public.example/rpc",
  alchemyHost: "arb-sepolia",
  explorerUrl: "https://explorer.example",
  confirmations: 2,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  asset: { address: address(1), symbol: "TestUSDC", decimals: 6, faucet: true },
  contracts: { factory: address(2), facilityImplementation: address(3) },
  deploymentBlock: "1",
  features: { writes: true, gaslessOriginator: false, duneAnalytics: false, riskModel: false },
  ...overrides,
});

const manifest = parseManifest({ schemaVersion: 1, defaultChainId: 421614, networks: [network(421614, "arbitrum-sepolia"), network(4663, "robinhood")] });

afterEach(() => vi.unstubAllGlobals());

describe("createWagmiConfig", () => {
  it("reads every chain through the manifest rpc url and never through a provider host", () => {
    const config = createWagmiConfig(manifest);
    for (const chainId of [421614, 4663]) {
      const client = config.getClient({ chainId }) as unknown as { transport: { url: string } };
      expect(client.transport.url).toBe(`https://anora-api.dimsky.xyz/rpc/${chainId}`);
      expect(client.transport.url).not.toContain("alchemy");
    }
  });

  it("packs many contract reads into one multicall", () => {
    const config = createWagmiConfig(manifest);
    const client = config.getClient({ chainId: 421614 }) as unknown as { batch?: { multicall?: { batchSize?: number; wait?: number } } };
    expect(client.batch?.multicall?.batchSize).toBeGreaterThanOrEqual(32_768);
    expect(client.batch?.multicall?.wait).toBeGreaterThan(0);
  });

  it("sends concurrent requests as one json-rpc batch", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const parsed = JSON.parse(init.body);
        bodies.push(parsed);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const reply = list.map((call: { id: number }) => ({ jsonrpc: "2.0", id: call.id, result: "0x1" }));
        return new Response(JSON.stringify(Array.isArray(parsed) ? reply : reply[0]), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const config = createWagmiConfig(manifest);
    const client = config.getClient({ chainId: 421614 }) as unknown as { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
    await Promise.all([client.request({ method: "eth_chainId" }), client.request({ method: "eth_blockNumber" }), client.request({ method: "eth_gasPrice" })]);
    expect(bodies).toHaveLength(1);
    expect(Array.isArray(bodies[0])).toBe(true);
    expect((bodies[0] as unknown[]).length).toBe(3);
  });
});
