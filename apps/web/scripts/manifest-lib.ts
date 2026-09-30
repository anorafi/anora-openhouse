import { parseManifest, type Manifest, type ManifestNetwork } from "../src/config/manifest";

export interface RawDeployment {
  chainId: number;
  asset: string;
  assetSymbol: string;
  faucet: boolean;
  AnoraFactory: string;
  AnoraFacilityImplementation: string;
  minFirstLossBps: number;
  explorer: string;
}

export interface BroadcastRun {
  transactions: { contractName?: string; contractAddress?: string; hash?: string }[];
  receipts: { transactionHash: string; blockNumber: string }[];
}

export interface ChainState {
  factoryCode: string | undefined;
  implementationCode: string | undefined;
  asset: string;
  minFirstLossBps: bigint;
  paused: boolean;
  implementation: string;
  assetDecimals: number;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const empty = (code: string | undefined) => !code || code === "0x";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function findDeploymentBlock(runs: BroadcastRun[], factory: string): { block: bigint; txHash: string } {
  for (const run of runs) {
    const tx = run.transactions.find((t) => t.contractAddress && same(t.contractAddress, factory));
    if (!tx?.hash) continue;
    const receipt = run.receipts.find((r) => same(r.transactionHash, tx.hash as string));
    if (!receipt) throw new Error(`The broadcast that deployed ${factory} has no receipt for ${tx.hash}.`);
    return { block: BigInt(receipt.blockNumber), txHash: tx.hash };
  }
  throw new Error(`No broadcast file deployed the factory ${factory}.`);
}

export function verifyNetworkState(entry: RawDeployment, state: ChainState): Verdict {
  if (empty(state.factoryCode)) return { ok: false, reason: `The factory has no bytecode at ${entry.AnoraFactory}.` };
  if (empty(state.implementationCode)) return { ok: false, reason: `The implementation has no bytecode at ${entry.AnoraFacilityImplementation}.` };
  if (!same(state.asset, entry.asset)) return { ok: false, reason: `The factory asset is ${state.asset}, expected ${entry.asset}.` };
  if (state.minFirstLossBps !== BigInt(entry.minFirstLossBps)) return { ok: false, reason: `minFirstLossBps is ${state.minFirstLossBps}, expected ${entry.minFirstLossBps}.` };
  if (state.paused) return { ok: false, reason: "The factory is paused." };
  if (!same(state.implementation, entry.AnoraFacilityImplementation)) return { ok: false, reason: `The factory implementation is ${state.implementation}, expected ${entry.AnoraFacilityImplementation}.` };
  return { ok: true };
}

export function assembleManifest(input: { defaultChainId: number; gitCommit: string; networks: ManifestNetwork[] }): Manifest {
  const document = { schemaVersion: 1, defaultChainId: input.defaultChainId, gitCommit: input.gitCommit, networks: input.networks };
  return parseManifest(document);
}

export function buildAbiBundle(input: {
  gitCommit: string;
  abi: Record<string, unknown[]>;
  codeHashes: Record<number, { factory: string; facilityImplementation: string }>;
}) {
  return {
    schemaVersion: 1,
    gitCommit: input.gitCommit,
    abi: input.abi,
    codeHashes: Object.fromEntries(Object.entries(input.codeHashes).map(([chainId, hashes]) => [String(chainId), hashes])),
  };
}

export function proxyRpcUrl(indexerApi: string | undefined, chainId: number): string | undefined {
  return indexerApi ? `${indexerApi.replace(/\/+$/, "")}/rpc/${chainId}` : undefined;
}
