import type { Address } from "viem";

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export interface ManifestNetwork {
  chainId: number;
  key: string;
  name: string;
  enabled: boolean;
  rpcUrl: string;
  publicRpcUrl?: string;
  explorerUrl: string;
  confirmations: number;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  multicall3?: Address;
  alchemyHost?: string;
  logsApi?: string;
  indexerApi?: string;
  asset: { address: Address; symbol: string; decimals: number; faucet: boolean };
  contracts: { factory: Address; facilityImplementation: Address };
  deploymentBlock: string;
  features: { writes: boolean; gaslessOriginator: boolean; duneAnalytics: boolean };
}

export interface Manifest {
  schemaVersion: 1;
  defaultChainId: number;
  gitCommit?: string;
  networks: ManifestNetwork[];
}

export interface Deployment {
  chainId: number;
  factory: Address;
  asset: Address;
  assetSymbol: string;
  assetDecimals: number;
  faucet: boolean;
  explorer: string;
  confirmations: number;
  writes: boolean;
  deploymentBlock: bigint;
  logsApi?: string;
  indexerApi?: string;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ManifestError(`${where} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ManifestError(`${where} must be a non-empty string.`);
  return value;
}

function integer(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new ManifestError(`${where} must be a non-negative integer.`);
  return value;
}

function flag(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") throw new ManifestError(`${where} must be true or false.`);
  return value;
}

function address(value: unknown, where: string): Address {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new ManifestError(`${where} must be a 20-byte hex address.`);
  return value as Address;
}

function httpsUrl(value: unknown, where: string): string {
  const url = text(value, where);
  if (!/^https?:\/\//.test(url)) throw new ManifestError(`${where} must be an http(s) URL.`);
  return url;
}

function parseNetwork(value: unknown, index: number): ManifestNetwork {
  const at = `networks[${index}]`;
  const raw = record(value, at);
  const nativeCurrency = record(raw.nativeCurrency, `${at}.nativeCurrency`);
  const asset = record(raw.asset, `${at}.asset`);
  const contracts = record(raw.contracts, `${at}.contracts`);
  const features = record(raw.features, `${at}.features`);
  const deploymentBlock = text(raw.deploymentBlock, `${at}.deploymentBlock`);
  if (!/^\d+$/.test(deploymentBlock)) throw new ManifestError(`${at}.deploymentBlock must be a decimal block number.`);
  return {
    chainId: integer(raw.chainId, `${at}.chainId`),
    key: text(raw.key, `${at}.key`),
    name: text(raw.name, `${at}.name`),
    enabled: flag(raw.enabled, `${at}.enabled`),
    rpcUrl: httpsUrl(raw.rpcUrl, `${at}.rpcUrl`),
    ...(raw.publicRpcUrl === undefined ? {} : { publicRpcUrl: httpsUrl(raw.publicRpcUrl, `${at}.publicRpcUrl`) }),
    explorerUrl: httpsUrl(raw.explorerUrl, `${at}.explorerUrl`),
    confirmations: integer(raw.confirmations, `${at}.confirmations`),
    nativeCurrency: {
      name: text(nativeCurrency.name, `${at}.nativeCurrency.name`),
      symbol: text(nativeCurrency.symbol, `${at}.nativeCurrency.symbol`),
      decimals: integer(nativeCurrency.decimals, `${at}.nativeCurrency.decimals`),
    },
    ...(raw.multicall3 === undefined ? {} : { multicall3: address(raw.multicall3, `${at}.multicall3`) }),
    ...(raw.alchemyHost === undefined ? {} : { alchemyHost: text(raw.alchemyHost, `${at}.alchemyHost`) }),
    ...(raw.logsApi === undefined ? {} : { logsApi: httpsUrl(raw.logsApi, `${at}.logsApi`) }),
    ...(raw.indexerApi === undefined ? {} : { indexerApi: httpsUrl(raw.indexerApi, `${at}.indexerApi`) }),
    asset: {
      address: address(asset.address, `${at}.asset.address`),
      symbol: text(asset.symbol, `${at}.asset.symbol`),
      decimals: integer(asset.decimals, `${at}.asset.decimals`),
      faucet: flag(asset.faucet, `${at}.asset.faucet`),
    },
    contracts: {
      factory: address(contracts.factory, `${at}.contracts.factory`),
      facilityImplementation: address(contracts.facilityImplementation, `${at}.contracts.facilityImplementation`),
    },
    deploymentBlock,
    features: {
      writes: flag(features.writes, `${at}.features.writes`),
      gaslessOriginator: flag(features.gaslessOriginator, `${at}.features.gaslessOriginator`),
      duneAnalytics: flag(features.duneAnalytics, `${at}.features.duneAnalytics`),
    },
  };
}

export function parseManifest(input: unknown): Manifest {
  const raw = record(input, "The manifest");
  if (raw.schemaVersion !== 1) throw new ManifestError(`Unsupported manifest schema version: ${String(raw.schemaVersion)}.`);
  if (!Array.isArray(raw.networks) || raw.networks.length === 0) throw new ManifestError("The manifest lists no networks.");
  const networks = raw.networks.map(parseNetwork);
  const ids = new Set<number>();
  for (const network of networks) {
    if (ids.has(network.chainId)) throw new ManifestError(`Duplicate chain id in the manifest: ${network.chainId}.`);
    ids.add(network.chainId);
  }
  if (!networks.some((network) => network.enabled)) throw new ManifestError("No network is enabled in the manifest.");
  const defaultChainId = integer(raw.defaultChainId, "defaultChainId");
  if (!networks.some((network) => network.chainId === defaultChainId && network.enabled)) {
    throw new ManifestError(`The default chain ${defaultChainId} is not an enabled network.`);
  }
  return {
    schemaVersion: 1,
    defaultChainId,
    ...(typeof raw.gitCommit === "string" ? { gitCommit: raw.gitCommit } : {}),
    networks,
  };
}

export function enabledNetworks(manifest: Manifest): ManifestNetwork[] {
  return manifest.networks.filter((network) => network.enabled);
}

export function networkFor(manifest: Manifest, chainId: number): ManifestNetwork | undefined {
  return enabledNetworks(manifest).find((network) => network.chainId === chainId);
}

export function deploymentOf(network: ManifestNetwork): Deployment {
  return {
    chainId: network.chainId,
    factory: network.contracts.factory,
    asset: network.asset.address,
    assetSymbol: network.asset.symbol,
    assetDecimals: network.asset.decimals,
    faucet: network.asset.faucet,
    explorer: network.explorerUrl,
    confirmations: network.confirmations,
    writes: network.features.writes,
    deploymentBlock: BigInt(network.deploymentBlock),
    logsApi: network.logsApi,
    indexerApi: network.indexerApi,
  };
}

export async function loadManifest(fetchImpl: typeof fetch, url: string): Promise<Manifest> {
  let response: Response;
  try {
    response = await fetchImpl(url, { cache: "no-store" });
  } catch {
    throw new ManifestError("Could not load the network manifest. Check your connection and reload.");
  }
  if (!response.ok) throw new ManifestError(`Could not load the network manifest (HTTP ${response.status}).`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ManifestError("The network manifest is not valid JSON.");
  }
  return parseManifest(body);
}
