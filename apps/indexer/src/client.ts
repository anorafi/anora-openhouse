import { createPublicClient, fallback, http, type Hex } from "viem";
import type { RawLog } from "./events";
import type { ChainClient } from "./sync";

export function createChainClient(rpcUrls: string | string[]): ChainClient {
  const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
  const nodes = urls.map((url) => http(url, { retryCount: 3, retryDelay: 500, timeout: 30_000 }));
  const client = createPublicClient({ transport: nodes.length > 1 ? fallback(nodes) : nodes[0] });
  return {
    getBlockNumber: () => client.getBlockNumber(),
    async getLogs({ address, fromBlock, toBlock }) {
      const logs = await client.getLogs({ address, fromBlock, toBlock });
      return logs
        .filter((log) => log.blockNumber !== null && log.blockHash !== null && log.transactionHash !== null && log.logIndex !== null)
        .map((log) => ({
          address: log.address as Hex,
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
          blockNumber: log.blockNumber as bigint,
          blockHash: log.blockHash as Hex,
          transactionHash: log.transactionHash as Hex,
          logIndex: log.logIndex as number,
        })) satisfies RawLog[];
    },
    async getBlock(blockNumber) {
      const block = await client.getBlock({ blockNumber });
      return { hash: block.hash, timestamp: block.timestamp };
    },
  };
}
