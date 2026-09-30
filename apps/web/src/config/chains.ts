import { defineChain, type Chain } from "viem";
import { enabledNetworks, type Manifest, type ManifestNetwork } from "./manifest";

export function chainOf(network: ManifestNetwork): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: [network.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: network.explorerUrl } },
    ...(network.multicall3 ? { contracts: { multicall3: { address: network.multicall3 } } } : {}),
  });
}

export function transportUrl(network: ManifestNetwork, providerKey: string | undefined): string {
  if (providerKey && network.alchemyHost) return `https://${network.alchemyHost}.g.alchemy.com/v2/${providerKey}`;
  return network.rpcUrl;
}

export function orderedNetworks(manifest: Manifest): ManifestNetwork[] {
  const enabled = enabledNetworks(manifest);
  return [
    ...enabled.filter((network) => network.chainId === manifest.defaultChainId),
    ...enabled.filter((network) => network.chainId !== manifest.defaultChainId),
  ];
}
