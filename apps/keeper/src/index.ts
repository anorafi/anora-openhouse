import { createPublicClient, createWalletClient, defineChain, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import deployments from "../../../contracts/deployments.json";
import { AnoraFactoryAbi } from "../../web/src/abi/AnoraFactory";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";
import { facilitiesToMarkLate, type FacilitySnapshot } from "./select";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com"] } },
});

const targets: { chain: Chain; factory: `0x${string}`; rpc: string }[] = [
  { chain: robinhood, factory: deployments.robinhood.AnoraFactory as `0x${string}`, rpc: robinhood.rpcUrls.default.http[0] },
  {
    chain: arbitrumSepolia,
    factory: deployments.arbitrumSepolia.AnoraFactory as `0x${string}`,
    rpc: process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc",
  },
];

const account = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as `0x${string}`);
const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? "60000");

async function snapshot(client: ReturnType<typeof createPublicClient>, factory: `0x${string}`): Promise<FacilitySnapshot[]> {
  const addresses = (await client.readContract({ address: factory, abi: AnoraFactoryAbi, functionName: "allFacilities" })) as `0x${string}`[];
  const reads = addresses.flatMap((address) => [
    { address, abi: AnoraFacilityAbi, functionName: "status" } as const,
    { address, abi: AnoraFacilityAbi, functionName: "principal" } as const,
    { address, abi: AnoraFacilityAbi, functionName: "dueAt" } as const,
  ]);
  const results = await client.multicall({ contracts: reads, allowFailure: false });
  return addresses.map((address, i) => ({
    address,
    status: Number(results[i * 3]),
    principal: results[i * 3 + 1] as bigint,
    dueAt: results[i * 3 + 2] as bigint,
  }));
}

async function tick() {
  for (const target of targets) {
    const transport = http(target.rpc);
    const client = createPublicClient({ chain: target.chain, transport });
    const wallet = createWalletClient({ account, chain: target.chain, transport });
    try {
      const facilities = await snapshot(client, target.factory);
      const block = await client.getBlock();
      const due = facilitiesToMarkLate(facilities, block.timestamp);
      console.log(`${new Date().toISOString()} ${target.chain.name}: ${facilities.length} facilities, ${due.length} past due`);
      for (const address of due) {
        const hash = await wallet.writeContract({ address, abi: AnoraFacilityAbi, functionName: "markLate" });
        console.log(`  markLate ${address} tx ${hash}`);
        await client.waitForTransactionReceipt({ hash });
      }
    } catch (error) {
      console.error(`${target.chain.name}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
}

console.log(`keeper ${account.address} every ${intervalMs / 1000}s`);
await tick();
setInterval(tick, intervalMs);
