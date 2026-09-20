import { defineChain } from "viem";
import { createConfig, http, injected } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const rpc = (alchemyHost: string, fallback: string) => (alchemyKey ? `https://${alchemyHost}.g.alchemy.com/v2/${alchemyKey}` : fallback);

export const wagmiConfig = createConfig({
  chains: [arbitrumSepolia, robinhood],
  connectors: [injected()],
  transports: {
    [arbitrumSepolia.id]: http(rpc("arb-sepolia", "https://sepolia-rollup.arbitrum.io/rpc")),
    [robinhood.id]: http(rpc("robinhood-mainnet", "https://rpc.mainnet.chain.robinhood.com")),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
