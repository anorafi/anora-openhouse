import type { Address } from "viem";
import { useChainId, useReadContract } from "wagmi";
import { factoryContract, ZERO_ADDRESS } from "../config/contracts";
import { useFactoryAddress } from "./useDeployment";

const REFETCH_MS = 5_000;

export function useAllFacilityAddresses() {
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const factory = factoryContract(factoryAddress ?? ZERO_ADDRESS);

  return useReadContract({
    ...factory,
    functionName: "allFacilities",
    chainId,
    query: { enabled: !!factoryAddress, refetchInterval: REFETCH_MS },
  });
}

export function useMinFirstLossBps() {
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const factory = factoryContract(factoryAddress ?? ZERO_ADDRESS);

  return useReadContract({
    ...factory,
    functionName: "minFirstLossBps",
    chainId,
    query: { enabled: !!factoryAddress, refetchInterval: false, staleTime: Infinity },
  });
}

export function useRiskAgent() {
  const chainId = useChainId();
  const factoryAddress = useFactoryAddress();
  const factory = factoryContract(factoryAddress ?? ZERO_ADDRESS);

  return useReadContract({
    ...factory,
    functionName: "riskAgent",
    chainId,
    query: { enabled: !!factoryAddress, refetchInterval: REFETCH_MS },
  });
}

export function useIsRiskAgent(address: Address | undefined): boolean {
  const { data: riskAgent } = useRiskAgent();
  if (!address || !riskAgent) return false;
  return address.toLowerCase() === riskAgent.toLowerCase();
}
