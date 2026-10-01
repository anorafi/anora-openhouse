import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Address, type Hex } from "viem";
import { useChainId } from "wagmi";
import { AnoraFacilityAbi, AnoraFactoryAbi } from "../abi";
import type { ChainLog } from "../lib/history";
import { fetchIndexerActivity } from "../lib/indexer";
import { useDeployment } from "./useDeployment";
import { INDEXER_POLL_MS } from "../config/polling";

const MAX_PAGES = 5;
const EVENT_ABI = [...AnoraFacilityAbi, ...AnoraFactoryAbi].filter((item) => item.type === "event");

interface BlockscoutLog {
  address: { hash: string };
  block_timestamp: string;
  data: Hex;
  index: number;
  topics: (Hex | null)[];
  transaction_hash: Hex;
}

async function fetchLogs(api: string, address: Address): Promise<BlockscoutLog[]> {
  const items: BlockscoutLog[] = [];
  let query = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(`${api}/addresses/${address}/logs${query}`);
    if (!response.ok) break;
    const body = (await response.json()) as { items: BlockscoutLog[]; next_page_params: Record<string, string> | null };
    items.push(...body.items);
    if (!body.next_page_params) break;
    query = `?${new URLSearchParams(body.next_page_params)}`;
  }
  return items;
}

function decode(item: BlockscoutLog): ChainLog | null {
  const topics = item.topics.filter((topic): topic is Hex => topic !== null);
  if (topics.length === 0) return null;
  try {
    const { eventName, args } = decodeEventLog({ abi: EVENT_ABI, data: item.data, topics: topics as [Hex, ...Hex[]] });
    const named = (args ?? {}) as Record<string, unknown>;
    return {
      id: `${item.transaction_hash}-${item.index}`,
      facility: (eventName === "FacilityCreated" ? named.facility : item.address.hash) as Address,
      eventName,
      args: named,
      at: Date.parse(item.block_timestamp),
      txHash: item.transaction_hash,
    };
  } catch {
    return null;
  }
}

export function useHistory(facilities: readonly Address[]) {
  const chainId = useChainId();
  const deployment = useDeployment();
  const factory = deployment?.factory;
  const indexerApi = deployment?.indexerApi;
  const api = deployment?.logsApi;

  return useQuery({
    queryKey: ["history", indexerApi ? "indexer" : "explorer", chainId, factory, indexerApi ? "" : facilities.join(",")],
    enabled: (!!indexerApi || !!api) && !!factory,
    refetchInterval: INDEXER_POLL_MS,
    retry: indexerApi ? 1 : 3,
    queryFn: async () => {
      if (indexerApi) return fetchIndexerActivity(fetch, indexerApi, chainId);
      const pages = await Promise.all([factory!, ...facilities].map((address) => fetchLogs(api!, address).catch(() => [])));
      return pages.flat().map(decode).filter((log): log is ChainLog => log !== null);
    },
  });
}
