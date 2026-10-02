import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { writeFileSync } from "node:fs";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";
import { AnoraFactoryAbi } from "../../web/src/abi/AnoraFactory";
import { TestUSDCAbi } from "../../web/src/abi/TestUSDC";
import { encodeFacilityName } from "../../web/src/lib/facilityName";
import { demoPlan, lockedInOpen, sizedPlan, usdc, validatePlan, type DemoChain, type FacilitySpec } from "./demoPlan";
import { metadataApi } from "./metadataApi";

const target = (process.env.CHAIN ?? "robinhood") as DemoChain;
const profile = process.env.PROFILE === "sized" ? "sized" : "curated";
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com"] } },
});
const chain = target === "robinhood" ? robinhood : arbitrumSepolia;
const rpc = target === "robinhood" ? robinhood.rpcUrls.default.http[0] : process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc";
const manifest = await Bun.file(new URL("../../web/public/manifest.json", import.meta.url)).json();
const network = manifest.networks.find((entry: { chainId: number }) => entry.chainId === chain.id);
const factory = network.contracts.factory as Address;
const asset = network.asset.address as Address;
const faucet = network.asset.faucet as boolean;

const key = (name: string) => privateKeyToAccount(process.env[name] as Hex);
const deployer = key("DEPLOYER_PRIVATE_KEY");
const originator = key("DEMO_ORIGINATOR_PRIVATE_KEY");
const investor = key("DEMO_INVESTOR_PRIVATE_KEY");
const reviewer = key("RISK_AGENT_PRIVATE_KEY");

const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallets = new Map<string, ReturnType<typeof createWalletClient>>();
const walletFor = (account: ReturnType<typeof key>) => {
  if (!wallets.has(account.address)) wallets.set(account.address, createWalletClient({ account, chain, transport: http(rpc) }));
  return wallets.get(account.address)!;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ...data }));
const now = async () => Number((await publicClient.getBlock()).timestamp);

async function write(account: ReturnType<typeof key>, address: Address, abi: readonly unknown[], functionName: string, args: unknown[]) {
  const hash = await walletFor(account).writeContract({ address, abi, functionName, args, chain, account } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

const read = <T,>(address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
  publicClient.readContract({ address, abi, functionName, args } as never) as Promise<T>;

const balanceOf = (who: Address) => read<bigint>(asset, TestUSDCAbi, "balanceOf", [who]);

async function ensureAllowance(owner: ReturnType<typeof key>, spender: Address, amount: number) {
  const current = await read<bigint>(asset, TestUSDCAbi, "allowance", [owner.address, spender]);
  if (current < BigInt(amount)) await write(owner, asset, TestUSDCAbi, "approve", [spender, BigInt(amount) * 4n]);
}

async function ensureGas() {
  const minimum = target === "robinhood" ? 600_000_000_000_000n : 2_000_000_000_000_000n;
  for (const account of [originator, investor, reviewer]) {
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance >= minimum) continue;
    const hash = await walletFor(deployer).sendTransaction({ to: account.address, value: minimum - balance, chain, account: deployer });
    await publicClient.waitForTransactionReceipt({ hash });
    log("gas-topup", { to: account.address, wei: (minimum - balance).toString() });
  }
}

async function ensureAssetBalance(account: ReturnType<typeof key>, needed: number) {
  const balance = await balanceOf(account.address);
  if (balance >= BigInt(needed)) return;
  if (faucet) {
    await write(deployer, asset, TestUSDCAbi, "mint", [account.address, BigInt(needed) * 4n]);
    log("mint", { to: account.address, amount: needed * 4 });
    return;
  }
  throw new Error(`${account.address} holds ${balance} of the asset, needs ${needed}`);
}

const ledgerWallets = { originator: originator.address, investor: investor.address, deployer: deployer.address, riskAgent: reviewer.address };
async function snapshot() {
  const out: Record<string, string> = {};
  for (const [name, address] of Object.entries(ledgerWallets)) out[name] = (await balanceOf(address as Address)).toString();
  return out;
}

const plan = profile === "sized" ? sizedPlan(target) : demoPlan(target);
validatePlan(plan);
const firstLossTotal = plan.reduce((sum, spec) => sum + spec.firstLoss, 0);
const investorNeed = plan.filter((spec) => spec.kind !== "open").reduce((sum, spec) => sum + spec.junior + spec.senior, 0);
const before = await snapshot();
log("ledger-before", before);
log("plan", { profile, chain: target, factory, asset, facilities: plan.length, lockedInOpen: lockedInOpen(plan), firstLossTotal, investorNeed });

if (!(await read<boolean>(factory, AnoraFactoryAbi, "approvedOriginators", [originator.address]))) throw new Error("originator is not approved on the factory");
if ((await read<string>(factory, AnoraFactoryAbi, "riskAgent")).toLowerCase() !== reviewer.address.toLowerCase()) throw new Error("risk agent mismatch on the factory");

await ensureGas();
await ensureAssetBalance(originator, firstLossTotal + (profile === "sized" ? usdc(20_000) : usdc(0.3)));
await ensureAssetBalance(investor, investorNeed);

const created = new Map<FacilitySpec, Address>();
await ensureAllowance(originator, factory, firstLossTotal);
for (const spec of plan) {
  const hash = await write(originator, factory, AnoraFactoryAbi, "createFacility", [
    encodeFacilityName(spec),
    {
      limit: BigInt(spec.limit),
      firstLoss: BigInt(spec.firstLoss),
      tenor: BigInt(spec.tenorSeconds),
      grace: BigInt(spec.graceSeconds),
      financingFeeBps: BigInt(Math.round(spec.feePct * 100)),
      lateFeePerDayBps: 10n,
      seniorPerJuniorBps: 22_500n,
      seniorFeeShareBps: 6_000n,
      capitalCap: BigInt(spec.limit),
    },
  ]);
  const all = await read<Address[]>(factory, AnoraFactoryAbi, "allFacilities");
  const address = all[all.length - 1];
  created.set(spec, address);
  log("created", { kind: spec.kind, name: spec.name, address, tx: hash });
}

const timed = plan.filter((spec) => spec.kind === "late" || spec.kind === "recovered");
const others = plan.filter((spec) => spec.kind === "active" || spec.kind === "repaid");

async function fund(spec: FacilitySpec) {
  const address = created.get(spec)!;
  await ensureAllowance(investor, address, spec.junior + spec.senior);
  await write(investor, address, AnoraFacilityAbi, "deposit", [1, BigInt(spec.junior)]);
  await write(investor, address, AnoraFacilityAbi, "deposit", [0, BigInt(spec.senior)]);
  await write(originator, address, AnoraFacilityAbi, "drawdown", [BigInt(spec.draw)]);
  log("drawn", { kind: spec.kind, address, junior: spec.junior, senior: spec.senior, draw: spec.draw });
}

async function claim(spec: FacilitySpec) {
  const address = created.get(spec)!;
  const seniorShares = await read<bigint>(address, AnoraFacilityAbi, "seniorShares", [investor.address]);
  const juniorShares = await read<bigint>(address, AnoraFacilityAbi, "juniorShares", [investor.address]);
  if (seniorShares > 0n) await write(investor, address, AnoraFacilityAbi, "withdraw", [0, seniorShares]);
  if (juniorShares > 0n) await write(investor, address, AnoraFacilityAbi, "withdraw", [1, juniorShares]);
  log("claimed", { address, seniorShares: seniorShares.toString(), juniorShares: juniorShares.toString() });
}

for (const spec of timed) await fund(spec);
for (const spec of others) await fund(spec);

const repaid = plan.find((spec) => spec.kind === "repaid");
if (repaid) {
  const address = created.get(repaid)!;
  const owed = await read<bigint>(address, AnoraFacilityAbi, "owed");
  await ensureAllowance(originator, address, Number(owed) + 1);
  await write(originator, address, AnoraFacilityAbi, "repay", [owed]);
  await claim(repaid);
  log("repaid-cycle", { address, owed: owed.toString(), facilityBalance: (await balanceOf(address)).toString() });
}

const recovered = plan.find((spec) => spec.kind === "recovered");
if (recovered) {
  const address = created.get(recovered)!;
  const dueAt = Number(await read<bigint>(address, AnoraFacilityAbi, "dueAt"));
  while ((await now()) <= dueAt) await sleep(5_000);
  const status = Number(await read<number>(address, AnoraFacilityAbi, "status"));
  if (status === 0) await write(originator, address, AnoraFacilityAbi, "markLate", []);
  const lateSince = Number(await read<bigint>(address, AnoraFacilityAbi, "lateSince"));
  while ((await now()) < lateSince + recovered.graceSeconds) await sleep(5_000);
  await write(reviewer, address, AnoraFacilityAbi, "declareDefault", ["Buyer missed payment; restructuring refused"]);
  const [firstLossLoss, juniorLoss, seniorLoss] = await read<[bigint, bigint, bigint]>(address, AnoraFacilityAbi, "losses");
  const loss = firstLossLoss + juniorLoss + seniorLoss;
  await ensureAllowance(originator, address, Number(loss) + 1);
  await write(originator, address, AnoraFacilityAbi, "recordRecovery", [loss]);
  await claim(recovered);
  log("recovered-cycle", { address, loss: loss.toString(), facilityBalance: (await balanceOf(address)).toString() });
}

const metaApi = metadataApi(process.env.SEED_API ?? "https://anora-api.dimsky.xyz", chain.id);
const originatorToken = await metaApi.login(originator);
const reviewerToken = await metaApi.login(reviewer);
const grades = ["A", "B+", "A-"];
let index = 0;
for (const spec of plan.filter((entry) => entry.kind === "open" && entry.metadata)) {
  const address = created.get(spec)!;
  const path = `/v1/facilities/${chain.id}/${address}`;
  const draft = await metaApi.post(`${path}/metadata/versions`, originatorToken, {
    company: spec.company,
    route: spec.route.replace("→", "to"),
    financingType: spec.type,
    operatingHistoryYears: 6 + index * 3,
    verifiedAssets: 14 + index * 9,
    buyerConcentrationPct: 34 + index * 8,
    documentCoverage: 1.12 + index * 0.09,
  });
  const approval = await metaApi.post(`${path}/underwriting/approve`, reviewerToken, { version: draft.version, grade: grades[index % grades.length], note: "Sample review for the demo." });
  let attachTx: Hex | null = null;
  if (spec.metadata === "anchored") {
    attachTx = await write(originator, address, AnoraFacilityAbi, "attachEvidence", [approval.digest as Hex]);
    await sleep(3_000);
  }
  if (index === 0) {
    await metaApi.upload(originatorToken, path, "invoice-sample.pdf", "public");
    await metaApi.upload(originatorToken, path, "buyer-contract-sample.pdf", "restricted");
  }
  const state = await metaApi.call(`${path}/metadata`);
  log("metadata", { name: spec.name, address, mode: spec.metadata, digest: approval.digest, attachTx, anchored: state.anchored });
  index += 1;
}

const after = await snapshot();
log("ledger-after", after);
const facilities = [...created.entries()].map(([spec, address]) => ({ kind: spec.kind, name: spec.name, address }));
const summary = { chain: target, factory, before, after, facilities };
writeFileSync(`${process.env.HOME}/.cache/claude-work/seed-${target}${profile === "sized" ? "-sized" : ""}.json`, JSON.stringify(summary, null, 2));
log("done", { facilities: facilities.length });
