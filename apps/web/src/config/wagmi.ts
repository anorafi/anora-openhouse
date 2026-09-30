import type { Chain } from "viem";
import { createConfig, http, injected } from "wagmi";
import { chainOf, orderedNetworks, transportUrl } from "./chains";
import type { Manifest } from "./manifest";

export function createWagmiConfig(manifest: Manifest, providerKey: string | undefined) {
  const networks = orderedNetworks(manifest);
  const chains = networks.map(chainOf) as [Chain, ...Chain[]];
  return createConfig({
    chains,
    connectors: [injected()],
    transports: Object.fromEntries(networks.map((network) => [network.chainId, http(transportUrl(network, providerKey))])),
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof createWagmiConfig>;
  }
}
