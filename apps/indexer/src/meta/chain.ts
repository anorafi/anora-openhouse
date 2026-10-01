import { createPublicClient, http, type Hex } from "viem";
import { AnoraFacilityAbi } from "../../../web/src/abi/AnoraFacility";
import type { ChainReader } from "./service";

interface Reader {
  readContract(request: { address: Hex; abi: typeof AnoraFacilityAbi; functionName: "originator" | "riskAgent" | "evidenceHash" }): Promise<string>;
}

export function createChainReader(clients: Record<number, Reader>): ChainReader {
  return {
    async facility(chainId, address) {
      const client = clients[chainId];
      if (!client) throw new Error(`No rpc client for chain ${chainId}.`);
      const read = (functionName: "originator" | "riskAgent" | "evidenceHash") => client.readContract({ address: address as Hex, abi: AnoraFacilityAbi, functionName });
      const [originator, riskAgent, evidenceHash] = await Promise.all([read("originator"), read("riskAgent"), read("evidenceHash")]);
      return { originator, riskAgent, evidenceHash };
    },
  };
}

export function createRpcReaders(networks: { chainId: number; rpcUrl: string }[]): Record<number, Reader> {
  return Object.fromEntries(
    networks.map((network) => [network.chainId, createPublicClient({ transport: http(network.rpcUrl, { retryCount: 2, retryDelay: 400, timeout: 20_000 }) }) as unknown as Reader]),
  );
}
