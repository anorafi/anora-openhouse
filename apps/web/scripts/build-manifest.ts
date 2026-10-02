import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createPublicClient, http, keccak256, parseAbi, type Address } from "viem";
import type { ManifestNetwork } from "../src/config/manifest";
import { assembleManifest, buildAbiBundle, findDeploymentBlock, proxyRpcUrl, verifyNetworkState, type BroadcastRun, type RawDeployment } from "./manifest-lib";

const root = join(dirname(new URL(import.meta.url).pathname), "../../..");
const publicDir = join(root, "apps/web/public");

interface ChainMeta {
  key: string;
  name: string;
  rpcUrl: string;
  confirmations: number;
  multicall3?: Address;
  alchemyHost?: string;
  logsApi: string;
  indexerApi?: string;
}

const INDEXER_API = process.env.INDEXER_API ?? "https://anora-api.dimsky.xyz";

const META: Record<string, ChainMeta> = {
  arbitrumSepolia: {
    key: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    confirmations: 2,
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    alchemyHost: "arb-sepolia",
    logsApi: "https://arbitrum-sepolia.blockscout.com/api/v2",
    indexerApi: INDEXER_API,
  },
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    confirmations: 2,
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    alchemyHost: "robinhood-mainnet",
    logsApi: "https://robinhoodchain.blockscout.com/api/v2",
    indexerApi: INDEXER_API,
  },
};

const DEFAULT_CHAIN_ID = Number(process.env.DEFAULT_CHAIN_ID ?? 4663);

const factoryAbi = parseAbi([
  "function asset() view returns (address)",
  "function minFirstLossBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function implementation() view returns (address)",
]);
const tokenAbi = parseAbi(["function decimals() view returns (uint8)"]);

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function artifactAbi(path: string): unknown[] {
  const file = join(root, path);
  if (!existsSync(file)) throw new Error(`Missing ${path}. Run "forge build" in contracts first.`);
  return JSON.parse(readFileSync(file, "utf8")).abi;
}

function broadcastRuns(chainId: number): BroadcastRun[] {
  const dir = join(root, "contracts/broadcast/Deploy.s.sol", String(chainId));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^run-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as BroadcastRun);
}

async function buildNetwork(key: string, entry: RawDeployment) {
  const meta = META[key];
  if (!meta) throw new Error(`No chain metadata for "${key}" in build-manifest.ts.`);
  const client = createPublicClient({ transport: http(meta.rpcUrl) });
  const factory = entry.AnoraFactory as Address;
  const [factoryCode, asset, minFirstLossBps, paused, implementation] = await Promise.all([
    client.getCode({ address: factory }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "asset" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "minFirstLossBps" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "paused" }),
    client.readContract({ address: factory, abi: factoryAbi, functionName: "implementation" }),
  ]);
  const implementationCode = await client.getCode({ address: entry.AnoraFacilityImplementation as Address });
  const assetDecimals = await client.readContract({ address: entry.asset as Address, abi: tokenAbi, functionName: "decimals" });
  if (meta.multicall3) {
    const multicallCode = await client.getCode({ address: meta.multicall3 });
    if (!multicallCode || multicallCode === "0x") throw new Error(`${meta.name} (${entry.chainId}): no multicall3 contract at ${meta.multicall3}.`);
  }
  const verdict = verifyNetworkState(entry, { factoryCode, implementationCode, asset, minFirstLossBps, paused, implementation, assetDecimals });
  if (!verdict.ok) throw new Error(`${meta.name} (${entry.chainId}): ${verdict.reason}`);

  const { block } = findDeploymentBlock(broadcastRuns(entry.chainId), factory);
  const network: ManifestNetwork = {
    chainId: entry.chainId,
    key: meta.key,
    name: meta.name,
    enabled: true,
    rpcUrl: proxyRpcUrl(meta.indexerApi, entry.chainId) ?? meta.rpcUrl,
    publicRpcUrl: meta.rpcUrl,
    explorerUrl: entry.explorer,
    confirmations: meta.confirmations,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    ...(meta.multicall3 ? { multicall3: meta.multicall3 } : {}),
    ...(meta.alchemyHost ? { alchemyHost: meta.alchemyHost } : {}),
    logsApi: meta.logsApi,
    ...(meta.indexerApi ? { indexerApi: meta.indexerApi } : {}),
    asset: { address: entry.asset as Address, symbol: entry.assetSymbol, decimals: assetDecimals, faucet: entry.faucet },
    contracts: { factory, facilityImplementation: entry.AnoraFacilityImplementation as Address },
    deploymentBlock: block.toString(),
    features: { writes: true, gaslessOriginator: false, duneAnalytics: false, riskModel: process.env.RISK_MODEL === "1", selfServeOriginator: entry.faucet && process.env.SELF_SERVE_ORIGINATOR !== "0" },
  };
  return {
    network,
    hashes: { factory: keccak256(factoryCode as `0x${string}`), facilityImplementation: keccak256(implementationCode as `0x${string}`) },
  };
}

const deployments = JSON.parse(readFileSync(join(root, "contracts/deployments.json"), "utf8")) as Record<string, RawDeployment>;
const gitCommit = git(["log", "-1", "--format=%h", "--", "contracts/src"]);

const built = await Promise.all(Object.entries(deployments).map(([key, entry]) => buildNetwork(key, entry)));
const manifest = assembleManifest({ defaultChainId: DEFAULT_CHAIN_ID, gitCommit, networks: built.map((item) => item.network) });
const bundle = buildAbiBundle({
  gitCommit,
  abi: {
    AnoraFactory: artifactAbi("contracts/out/AnoraFactory.sol/AnoraFactory.json"),
    AnoraFacility: artifactAbi("contracts/out/AnoraFacility.sol/AnoraFacility.json"),
  },
  codeHashes: Object.fromEntries(built.map((item) => [item.network.chainId, item.hashes])),
});

mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(join(publicDir, "abi.json"), JSON.stringify(bundle, null, 2) + "\n");
for (const item of built) {
  console.log(`${item.network.name}: block ${item.network.deploymentBlock}, factory ${item.network.contracts.factory}`);
}
console.log(`wrote manifest.json and abi.json (code commit ${gitCommit})`);
