import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import { parseManifest } from "../../web/src/config/manifest";
import { createApprovalRoutes, createApprovalsChain } from "./approvals";
import { createHandler, type ChainStatus } from "./api";
import { createChainClient } from "./client";
import { openDb } from "./db";
import { createLimiter } from "./limit";
import { createChainReader, createRpcReaders } from "./meta/chain";
import { createMetaRoutes } from "./meta/service";
import { openMetaStore } from "./meta/store";
import { createRpcProxy } from "./rpc";
import { syncChain, type ChainClient } from "./sync";
import { upstreamsFor } from "./upstreams";

const manifestPath = process.env.INDEXER_MANIFEST ?? new URL("../../web/public/manifest.json", import.meta.url).pathname;
const dbPath = process.env.INDEXER_DB ?? `${process.env.HOME}/.local/share/anora-indexer/index.db`;
const port = Number(process.env.INDEXER_PORT ?? "8105");
const intervalMs = Number(process.env.INDEXER_INTERVAL_MS ?? "5000");
const maxLag = BigInt(process.env.INDEXER_MAX_LAG ?? "400");
const chunk = BigInt(process.env.INDEXER_CHUNK ?? "2000");
const reorgWindow = BigInt(process.env.INDEXER_REORG_WINDOW ?? "128");
const origins = (process.env.INDEXER_ORIGINS ?? "https://openhouse.anora.finance").split(",");
const dataDir = dirname(dbPath);
const metaDbPath = process.env.META_DB ?? `${dataDir}/metadata.db`;
const documentsDir = process.env.META_DOCUMENTS ?? `${dataDir}/documents`;
const secretPath = process.env.META_SECRET_FILE ?? `${dataDir}/meta.secret`;
const metaDomain = process.env.META_DOMAIN ?? "openhouse.anora.finance";
const maxFileBytes = Number(process.env.META_MAX_FILE_BYTES ?? String(5 * 1024 * 1024));

const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const networks = manifest.networks.filter((network) => network.enabled);
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const status = new Map<number, ChainStatus>();
const providerKey = process.env.ALCHEMY_API_KEY;
const upstreamMap = new Map(networks.map((network) => [network.chainId, upstreamsFor(network, providerKey)]));
const rpcProxy = createRpcProxy({
  upstreams: (chainId) => upstreamMap.get(chainId),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  onFailure: (info) => console.error(`rpc ${info.chainId} ${info.host}: ${info.reason} (${info.methods.slice(0, 4).join(",")}${info.methods.length > 4 ? `,+${info.methods.length - 4}` : ""})`),
});
const directUrls = (network: (typeof networks)[number]) => upstreamMap.get(network.chainId)?.length ? (upstreamMap.get(network.chainId) as string[]) : [network.rpcUrl];

function watch(client: ChainClient, chainId: number): ChainClient {
  return {
    ...client,
    async getBlockNumber() {
      const head = await client.getBlockNumber();
      const current = status.get(chainId);
      status.set(chainId, { indexedBlock: current?.indexedBlock ?? null, chainBlock: head, error: null });
      return head;
    },
  };
}

async function loop(network: (typeof networks)[number]) {
  const client = watch(createChainClient(directUrls(network)), network.chainId);
  const target = { chainId: network.chainId, factory: network.contracts.factory as Hex, deploymentBlock: BigInt(network.deploymentBlock), confirmations: network.confirmations };
  status.set(network.chainId, { indexedBlock: db.cursor(network.chainId), chainBlock: null, error: null });
  for (;;) {
    try {
      const state = await syncChain(client, db, target, { chunk, reorgWindow, retries: 6, backoffMs: 1000 });
      status.set(network.chainId, { indexedBlock: state.indexedBlock, chainBlock: state.chainBlock, error: null });
    } catch (error) {
      const current = status.get(network.chainId);
      status.set(network.chainId, { indexedBlock: db.cursor(network.chainId), chainBlock: current?.chainBlock ?? null, error: (error as Error).message.split("\n")[0] });
      console.error(`${network.key}: ${(error as Error).message.split("\n")[0]}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

mkdirSync(documentsDir, { recursive: true });
if (!existsSync(secretPath)) {
  writeFileSync(secretPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  chmodSync(secretPath, 0o600);
}
const secret = new Uint8Array(Buffer.from(readFileSync(secretPath, "utf8").trim(), "hex"));
const clock = () => Math.floor(Date.now() / 1000);

const meta = createMetaRoutes({
  store: openMetaStore(metaDbPath),
  chain: createChainReader(createRpcReaders(networks.map((network) => ({ chainId: network.chainId, rpcUrl: directUrls(network)[0] })))),
  db,
  auth: { domain: metaDomain, chains: networks.map((network) => network.chainId), now: clock, nonceTtl: 300, sessionTtl: 3600 },
  secret,
  documentsDir,
  maxFileBytes,
});

const selfServe = networks.filter((network) => network.features.selfServeOriginator).map((network) => ({ chainId: network.chainId, factory: network.contracts.factory as Hex }));
const ownerKey = process.env.SEPOLIA_OWNER_PRIVATE_KEY as Hex | undefined;
const approvals = createApprovalRoutes({
  chains: selfServe,
  ownerReady: Boolean(ownerKey && /^0x[0-9a-fA-F]{64}$/.test(ownerKey)),
  now: () => Date.now(),
  chain: createApprovalsChain({ ownerKey, urls: Object.fromEntries(networks.map((network) => [network.chainId, directUrls(network)])) }),
});

const handler = createHandler({
  db,
  networks: networks.map((network) => ({ chainId: network.chainId, key: network.key, name: network.name, confirmations: network.confirmations })),
  status,
  maxLag,
  now: clock,
  origins,
  meta,
  approvals,
  limiter: createLimiter({ now: () => Date.now() }),
  rpc: (chainId, payload) => rpcProxy.handle(chainId, payload),
});

Bun.serve({ port, hostname: "127.0.0.1", fetch: (request, server) => handler(request, server.requestIP(request)?.address) });
console.log(`indexer listening on 127.0.0.1:${port}, db ${dbPath}, chains ${networks.map((network) => network.key).join(", ")}`);
for (const network of networks) void loop(network);
