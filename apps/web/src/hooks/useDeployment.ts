import type { Address } from "viem";
import { useChainId } from "wagmi";
import { deploymentFor, type Deployment } from "../config/deployments";

export function useDeployment(): Deployment | undefined {
  const chainId = useChainId();
  return deploymentFor(chainId);
}

export function useFactoryAddress(): Address | undefined {
  return useDeployment()?.factory;
}

export function useAssetAddress(): Address | undefined {
  return useDeployment()?.asset;
}
