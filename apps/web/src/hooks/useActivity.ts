import { useQuery } from "@tanstack/react-query";
import type { Address, Log } from "viem";
import { useChainId, usePublicClient } from "wagmi";
import { AnoraFacilityAbi } from "../abi";
import type { FacilityData } from "./useFacilities";

const BLOCK_WINDOW = 50_000n;
const PARTICIPANT_EVENTS = ["Deposited", "Withdrawn"] as const;
const ORIGINATOR_EVENTS = ["Drawn", "Repaid", "MarkedLate", "DefaultDeclared", "Recovered"] as const;
const EVENT_ABI = AnoraFacilityAbi.filter((item) => item.type === "event");

export interface ActivityRow {
  key: string;
  facility: FacilityData;
  eventName: string;
  blockNumber: bigint;
  txHash: `0x${string}`;
  args: Record<string, unknown>;
}

export function useActivity(facilities: FacilityData[], me: Address | undefined) {
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const addressKey = facilities.map((f) => f.address).join(",");

  return useQuery({
    queryKey: ["activity", chainId, addressKey, me],
    enabled: !!publicClient && !!me && facilities.length > 0,
    refetchInterval: 15_000,
    queryFn: async (): Promise<ActivityRow[]> => {
      const latest = await publicClient!.getBlockNumber();
      const fromBlock = latest > BLOCK_WINDOW ? latest - BLOCK_WINDOW : 0n;

      const perFacility = await Promise.all(
        facilities.map(async (facility) => {
          try {
            const logs = await publicClient!.getLogs({
              address: facility.address,
              events: EVENT_ABI,
              fromBlock,
              toBlock: latest,
            });
            return logs.map((log) => ({ log, facility }));
          } catch {
            return [];
          }
        }),
      );

      return perFacility
        .flat()
        .filter(({ log, facility }) => isRelevant(log, facility, me!))
        .sort((a, b) => {
          if (a.log.blockNumber === b.log.blockNumber) return Number(b.log.logIndex ?? 0) - Number(a.log.logIndex ?? 0);
          return (b.log.blockNumber ?? 0n) > (a.log.blockNumber ?? 0n) ? 1 : -1;
        })
        .slice(0, 50)
        .map(({ log, facility }) => ({
          key: `${log.transactionHash}-${log.logIndex}`,
          facility,
          eventName: (log as Log & { eventName?: string }).eventName ?? "Unknown",
          blockNumber: log.blockNumber ?? 0n,
          txHash: log.transactionHash!,
          args: ((log as Log & { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>,
        }));
    },
  });
}

function isRelevant(log: Log, facility: FacilityData, me: Address): boolean {
  const eventName = (log as Log & { eventName?: string }).eventName;
  const args = (log as Log & { args?: Record<string, unknown> }).args ?? {};
  if (eventName && (PARTICIPANT_EVENTS as readonly string[]).includes(eventName)) {
    const provider = args.provider as Address | undefined;
    return !!provider && provider.toLowerCase() === me.toLowerCase();
  }
  if (eventName && (ORIGINATOR_EVENTS as readonly string[]).includes(eventName)) {
    return facility.originator.toLowerCase() === me.toLowerCase();
  }
  return false;
}
