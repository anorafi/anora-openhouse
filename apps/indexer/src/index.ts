import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import { parseManifest } from "../../web/src/config/manifest";
import { createHandler, type ChainStatus } from "./api";
import { createChainClient } from "./client";
import { openDb } from "./db";
import { syncChain, type ChainClient } from "./sync";

const manifestPath = process.env.INDEXER_MANIFEST ?? new URL("../../web/public/manifest.json", import.meta.url).pathname;
const dbPath = process.env.INDEXER_DB ?? `${process.env.HOME}/.local/share/anora-indexer/index.db`;
const port = Number(process.env.INDEXER_PORT ?? "8105");
const intervalMs = Number(process.env.INDEXER_INTERVAL_MS ?? "5000");
const maxLag = BigInt(process.env.INDEXER_MAX_LAG ?? "400");
const chunk = BigInt(process.env.INDEXER_CHUNK ?? "2000");
const reorgWindow = BigInt(process.env.INDEXER_REORG_WINDOW ?? "128");
const origins = (process.env.INDEXER_ORIGINS ?? "https://openhouse.anora.finance").split(",");

const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
const networks = manifest.networks.filter((network) => network.enabled);
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const status = new Map<number, ChainStatus>();

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
  const client = watch(createChainClient(network.rpcUrl), network.chainId);
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

const handler = createHandler({
  db,
  networks: networks.map((network) => ({ chainId: network.chainId, key: network.key, name: network.name, confirmations: network.confirmations })),
  status,
  maxLag,
  now: () => Math.floor(Date.now() / 1000),
  origins,
});

Bun.serve({ port, hostname: "127.0.0.1", fetch: handler });
console.log(`indexer listening on 127.0.0.1:${port}, db ${dbPath}, chains ${networks.map((network) => network.key).join(", ")}`);
for (const network of networks) void loop(network);
