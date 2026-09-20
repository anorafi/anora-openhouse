import { createPublicClient, createWalletClient, defineChain, http, webSocket, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import deployments from "../../../contracts/deployments.json";
import { AnoraFactoryAbi } from "../../web/src/abi/AnoraFactory";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";
import { facilitiesToMarkLate, type FacilitySnapshot } from "./select";
import { delayUntilDue } from "./schedule";

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
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function wsUrl(rpc: string): string | undefined {
  return rpc.includes("g.alchemy.com") ? rpc.replace("https://", "wss://") : undefined;
}

async function markLateNow(target: (typeof targets)[number], address: `0x${string}`) {
  const transport = http(target.rpc);
  const client = createPublicClient({ chain: target.chain, transport });
  const wallet = createWalletClient({ account, chain: target.chain, transport });
  const status = await client.readContract({ address, abi: AnoraFacilityAbi, functionName: "status" });
  if (Number(status) !== 0) return;
  const hash = await wallet.writeContract({ address, abi: AnoraFacilityAbi, functionName: "markLate" });
  console.log(`  markLate ${address} tx ${hash}`);
  await client.waitForTransactionReceipt({ hash });
}

function schedule(target: (typeof targets)[number], address: `0x${string}`, dueAt: bigint) {
  const key = `${target.chain.id}:${address.toLowerCase()}`;
  clearTimeout(timers.get(key));
  const delay = delayUntilDue(dueAt, BigInt(Math.floor(Date.now() / 1000)));
  console.log(`  scheduled markLate ${address} in ${Math.round(delay / 1000)}s`);
  timers.set(
    key,
    setTimeout(() => markLateNow(target, address).catch((e) => console.error((e as Error).message.split("\n")[0])), delay),
  );
}

function watchDrawn(target: (typeof targets)[number]) {
  const ws = wsUrl(target.rpc);
  if (!ws) return;
  const client = createPublicClient({ chain: target.chain, transport: webSocket(ws) });
  client.watchContractEvent({
    abi: AnoraFacilityAbi,
    eventName: "Drawn",
    onLogs: (logs) => {
      for (const log of logs) {
        const dueAt = (log.args as { dueAt?: bigint }).dueAt;
        if (dueAt) schedule(target, log.address, dueAt);
      }
    },
    onError: (e) => console.error(`${target.chain.name} ws: ${e.message.split("\n")[0]}`),
  });
  console.log(`${target.chain.name}: listening for Drawn over websocket`);
}
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
for (const target of targets) watchDrawn(target);
await tick();
setInterval(tick, intervalMs);
