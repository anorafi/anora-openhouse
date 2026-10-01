import { useMemo } from "react";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { useManifest } from "../config/ManifestContext";
import { deploymentOf, networkFor, type Deployment } from "../config/manifest";

export function useDeployment(): Deployment | undefined {
  const chainId = useChainId();
  const manifest = useManifest();
  return useMemo(() => {
    const network = networkFor(manifest, chainId);
    return network ? deploymentOf(network) : undefined;
  }, [manifest, chainId]);
}

export function useFactoryAddress(): Address | undefined {
  return useDeployment()?.factory;
}

export function useAssetAddress(): Address | undefined {
  return useDeployment()?.asset;
}
