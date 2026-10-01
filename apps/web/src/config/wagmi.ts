import type { Chain } from "viem";
import { createConfig, http, injected } from "wagmi";
import { chainOf, orderedNetworks } from "./chains";
import type { Manifest } from "./manifest";

const RPC_BATCH = { batchSize: 100, wait: 16 };
const MULTICALL_BATCH = { batchSize: 65_536, wait: 16 };

export function createWagmiConfig(manifest: Manifest) {
  const networks = orderedNetworks(manifest);
  const chains = networks.map(chainOf) as [Chain, ...Chain[]];
  return createConfig({
    chains,
    connectors: [injected()],
    batch: { multicall: MULTICALL_BATCH },
    transports: Object.fromEntries(networks.map((network) => [network.chainId, http(network.rpcUrl, { batch: RPC_BATCH })])),
  });
}

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof createWagmiConfig>;
  }
}
