import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { AnoraFacilityAbi, AnoraFactoryAbi, TestUSDCAbi } from "../src/abi";
import { createFacilityCall, planFacility } from "../src/lib/facilityPlan";
import { encodeFacilityName } from "../src/lib/facilityName";
import { toUnits } from "../src/lib/book";

const mode = process.env.MODE ?? "full";
const target = process.env.CHAIN ?? "sepolia";
const deployments = JSON.parse(readFileSync(new URL("../../../contracts/deployments.ano41.json", import.meta.url), "utf8"));

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const isSepolia = target === "sepolia";
const chain = isSepolia ? arbitrumSepolia : robinhood;
const section = deployments[isSepolia ? "arbitrumSepolia" : "robinhood"];
const factory = section.AnoraFactory as Address;
const asset = section.asset as Address;
const transport = http(isSepolia ? process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc" : "https://rpc.mainnet.chain.robinhood.com");
const pub = createPublicClient({ chain, transport });

const account = (name: string) => privateKeyToAccount(process.env[name] as Hex);
const deployer = account("DEPLOYER_PRIVATE_KEY");
const investor = account("DEMO_INVESTOR_PRIVATE_KEY");
const originator = account("DEMO_ORIGINATOR_PRIVATE_KEY");
const riskAgent = account("RISK_AGENT_PRIVATE_KEY");
const wallet = (who: ReturnType<typeof account>) => createWalletClient({ account: who, chain, transport });

const SENIOR = 0;
const JUNIOR = 1;
const U = 1_000_000n;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results: { id: string; ok: boolean; detail: string }[] = [];

function step(id: string, ok: boolean, detail: string) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

async function send(who: ReturnType<typeof account>, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
  const estimate = await pub.estimateContractGas({ account: who.address, address, abi, functionName, args } as never);
  const hash = await wallet(who).writeContract({ address, abi, functionName, args, chain, gas: (estimate * 3n) / 2n } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return { hash, receipt };
}

async function revertName(who: ReturnType<typeof account>, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
  try {
    await pub.simulateContract({ account: who.address, address, abi, functionName, args } as never);
    return null;
  } catch (error) {
    if (error instanceof BaseError) {
      const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError);
      if (reverted instanceof ContractFunctionRevertedError) return reverted.data?.errorName ?? reverted.reason ?? "revert";
    }
    return "revert";
  }
}

const read = <T,>(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) =>
  pub.readContract({ address, abi, functionName, args } as never) as Promise<T>;

const balanceOf = (who: Address) => read<bigint>(asset, TestUSDCAbi, "balanceOf", [who]);

async function timestamp() {
  return Number((await pub.getBlock()).timestamp);
}

async function waitUntil(target: number) {
  while ((await timestamp()) <= target) await sleep(3000);
}

async function topUpGas() {
  const floor = isSepolia ? 400_000_000_000_000n : 500_000_000_000_000n;
  const amount = isSepolia ? 1_000_000_000_000_000n : 600_000_000_000_000n;
  for (const who of [investor, originator, riskAgent]) {
    const balance = await pub.getBalance({ address: who.address });
    if (balance < floor) {
      const hash = await wallet(deployer).sendTransaction({ to: who.address, value: amount, chain } as never);
      await pub.waitForTransactionReceipt({ hash });
      console.log(`gas top-up ${who.address} ${amount}`);
    }
  }
}

async function ensureFunds(who: ReturnType<typeof account>, amount: bigint) {
  if (!isSepolia) return;
  if ((await balanceOf(who.address)) < amount) await send(deployer, asset, TestUSDCAbi, "mint", [who.address, amount * 2n]);
}

async function approve(who: ReturnType<typeof account>, spender: Address, amount: bigint) {
  await send(who, asset, TestUSDCAbi, "approve", [spender, amount]);
}

interface OpenInput {
  model: boolean;
  name: string;
  limit: number;
  firstLoss: number;
  tenor: number;
  grace: number;
}

async function open(input: OpenInput) {
  await ensureFunds(originator, 20n * U);
  const firstLoss = toUnits(input.firstLoss);
  await approve(originator, factory, firstLoss);
  const plan = planFacility({
    riskModel: input.model,
    faucet: true,
    limit: input.limit,
    firstLoss: input.firstLoss,
    financingType: "Export receivables",
    route: "Indonesia to Singapore",
    tenorSeconds: input.tenor,
    graceSeconds: input.grace,
  });
  const base = {
    limit: toUnits(input.limit),
    firstLoss,
    tenor: BigInt(input.tenor),
    grace: BigInt(input.grace),
    financingFeeBps: 500n,
    lateFeePerDayBps: 10n,
    seniorFeeShareBps: 6000n,
  };
  const name = encodeFacilityName({ name: input.name, company: "E2E Originator", route: "Indonesia to Singapore", type: "Export receivables", icon: "x" });
  const call = createFacilityCall(name, base, plan);
  const { hash, receipt } = await send(originator, factory, AnoraFactoryAbi, call.functionName, call.args);
  const created = parseEventLogs({ abi: AnoraFactoryAbi, logs: receipt.logs, eventName: "FacilityCreated" })[0];
  const frozen = parseEventLogs({ abi: AnoraFactoryAbi, logs: receipt.logs, eventName: "TermsFrozen" })[0];
  return { facility: created.args.facility as Address, hash, gas: receipt.gasUsed, plan, frozen, base };
}

const terms = (facility: Address) =>
  read<readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]>(facility, AnoraFacilityAbi, "terms");

async function fullCycle(label: string, facility: Address, draw: bigint) {
  const owedBefore = await read<bigint>(facility, AnoraFacilityAbi, "owed");
  await send(originator, facility, AnoraFacilityAbi, "drawdown", [draw]);
  const owed = await read<bigint>(facility, AnoraFacilityAbi, "owed");
  await ensureFunds(originator, owed + 2n * U);
  await approve(originator, facility, owed);
  await send(originator, facility, AnoraFacilityAbi, "repay", [owed]);
  const status = await read<number>(facility, AnoraFacilityAbi, "status");
  step(`${label} pelunasan penuh menutup fasilitas`, status === 3, `status ${status}, owed ${owed}, owedBefore ${owedBefore}`);
  const seniorShares = await read<bigint>(facility, AnoraFacilityAbi, "seniorShares", [investor.address]);
  const juniorShares = await read<bigint>(facility, AnoraFacilityAbi, "juniorShares", [investor.address]);
  if (seniorShares > 0n) await send(investor, facility, AnoraFacilityAbi, "withdraw", [SENIOR, seniorShares]);
  if (juniorShares > 0n) await send(investor, facility, AnoraFacilityAbi, "withdraw", [JUNIOR, juniorShares]);
  const left = await balanceOf(facility);
  step(`${label} semua pemegang klaim, saldo fasilitas nol`, left === 0n, `saldo ${left}`);
}

async function runCycleOnly() {
  const wallets = { investor: investor.address, originator: originator.address, deployer: deployer.address };
  const sum = async () => {
    const values: Record<string, bigint> = {};
    for (const [key, address] of Object.entries(wallets)) values[key] = await balanceOf(address);
    return values;
  };
  const before = await sum();
  console.log(JSON.stringify({ event: "ledger-before", ...Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.toString()])) }));
  const created = await open({ model: true, name: "E2E Cycle", limit: 2, firstLoss: 0.2, tenor: 120, grace: 60 });
  step("siklus kecil: fasilitas dibuat dengan model", created.plan.modelVersion === 1, `facility ${created.facility} tx ${created.hash}`);
  const facility = created.facility;
  await approve(investor, facility, 1n * U);
  await send(investor, facility, AnoraFacilityAbi, "deposit", [JUNIOR, 100_000n]);
  const capacity = await read<bigint>(facility, AnoraFacilityAbi, "seniorCapacity");
  const seniorAmount = capacity < 200_000n ? capacity : 200_000n;
  await send(investor, facility, AnoraFacilityAbi, "deposit", [SENIOR, seniorAmount]);
  const liquidity = await read<bigint>(facility, AnoraFacilityAbi, "liquidity");
  await fullCycle("siklus kecil", facility, liquidity);
  const after = await sum();
  console.log(JSON.stringify({ event: "ledger-after", ...Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.toString()])) }));
  const totalBefore = Object.values(before).reduce((a, b) => a + b, 0n);
  const totalAfter = Object.values(after).reduce((a, b) => a + b, 0n);
  step("siklus kecil: total saldo wallet tidak berubah", totalBefore === totalAfter, `sebelum ${totalBefore} sesudah ${totalAfter}`);
}

async function runFull() {
  const owner = await read<Address>(factory, AnoraFactoryAbi, "riskAgent");
  step("factory ANO-41 terpasang dan risk agent benar", owner.toLowerCase() === riskAgent.address.toLowerCase(), `factory ${factory}`);

  const legacy = await open({ model: false, name: "E2E Legacy", limit: 10, firstLoss: 3, tenor: 120, grace: 60 });
  const legacyTerms = await terms(legacy.facility);
  const legacyCapacity = await read<bigint>(legacy.facility, AnoraFacilityAbi, "seniorCapacity");
  const legacyVersion = await read<bigint>(legacy.facility, AnoraFacilityAbi, "modelVersion");
  step("a createFacility lama: rasio 22500 dan kapasitas Senior 6.75", legacyTerms[6] === 22_500n && legacyCapacity === 6_750_000n && legacyVersion === 0n, `rasio ${legacyTerms[6]} kapasitas ${legacyCapacity} modelVersion ${legacyVersion} tx ${legacy.hash}`);

  const model = await open({ model: true, name: "E2E Model", limit: 10, firstLoss: 3, tenor: 120, grace: 60 });
  const modelTerms = await terms(model.facility);
  const onchainHash = await read<Hex>(model.facility, AnoraFacilityAbi, "snapshotHash");
  const onchainVersion = await read<bigint>(model.facility, AnoraFacilityAbi, "modelVersion");
  const eventOk = model.frozen !== undefined && model.frozen.args.snapshotHash === model.plan.snapshotHash && Number(model.frozen.args.modelVersion) === model.plan.modelVersion;
  step(
    "b createFacilityWithModel: terms per fasilitas sesuai kalkulator",
    modelTerms[6] === BigInt(model.plan.seniorPerJuniorBps) && modelTerms[8] === model.plan.capitalCap,
    `rasio ${modelTerms[6]} cap ${modelTerms[8]} tx ${model.hash}`,
  );
  step("b TermsFrozen dan snapshot cocok dengan hash kalkulator", eventOk && onchainHash === model.plan.snapshotHash && onchainVersion === BigInt(model.plan.modelVersion), `hash ${onchainHash} versi ${onchainVersion}`);

  const facility = model.facility;
  await ensureFunds(investor, 100n * U);
  await approve(investor, facility, 100n * U);
  const capital = async () => {
    const [firstLossReserve, juniorAssets, seniorAssets] = await Promise.all([
      read<bigint>(facility, AnoraFacilityAbi, "firstLossReserve"),
      read<bigint>(facility, AnoraFacilityAbi, "juniorAssets"),
      read<bigint>(facility, AnoraFacilityAbi, "seniorAssets"),
    ]);
    return { firstLossReserve, juniorAssets, seniorAssets, total: firstLossReserve + juniorAssets + seniorAssets };
  };
  const allowedSenior = async () => {
    const state = await capital();
    const capacity = await read<bigint>(facility, AnoraFacilityAbi, "seniorCapacity");
    const room = modelTerms[8] - state.total;
    return capacity < room ? capacity : room;
  };
  const allowed0 = await allowedSenior();
  const over = await revertName(investor, facility, AnoraFacilityAbi, "deposit", [SENIOR, allowed0 + 1n]);
  step("c Senior di atas batas revert", over === "SeniorCapacityExceeded" || over === "CapitalCapExceeded", `batas ${allowed0} revert ${over}`);

  const junior = 2n * U;
  await send(investor, facility, AnoraFacilityAbi, "deposit", [JUNIOR, junior]);
  const allowed1 = await allowedSenior();
  const seniorAmount = allowed1 - 10_000n;
  await send(investor, facility, AnoraFacilityAbi, "deposit", [SENIOR, seniorAmount]);
  const state = await capital();
  step("c Senior hingga batas diterima", state.seniorAssets === seniorAmount && seniorAmount <= allowed1, `senior ${state.seniorAssets} batas ${allowed1}`);

  const modelLiquidity = await read<bigint>(facility, AnoraFacilityAbi, "liquidity");
  await fullCycle("d lunas model", facility, modelLiquidity < 3n * U ? modelLiquidity : 3n * U);

  await ensureFunds(originator, 20n * U);
  await approve(originator, factory, 2n * U);
  const rawTerms = {
    limit: 20n * U,
    firstLoss: 2n * U,
    tenor: 120n,
    grace: 60n,
    financingFeeBps: 500n,
    lateFeePerDayBps: 10n,
    seniorPerJuniorBps: 22_500n,
    seniorFeeShareBps: 6000n,
    capitalCap: 20n * U,
  };
  const rawName = encodeFacilityName({ name: "E2E Protection", company: "E2E Originator", route: "Indonesia to Singapore", type: "Export receivables", icon: "x" });
  const rawSnapshot = keccak256(toBytes("e2e-protection"));
  const rawCreate = await send(originator, factory, AnoraFactoryAbi, "createFacilityWithModel", [rawName, rawTerms, 1n, rawSnapshot]);
  const protection = parseEventLogs({ abi: AnoraFactoryAbi, logs: rawCreate.receipt.logs, eventName: "FacilityCreated" })[0].args.facility as Address;
  await approve(investor, protection, 100n * U);
  await send(investor, protection, AnoraFacilityAbi, "deposit", [JUNIOR, 3n * U]);
  const pCapacity = await read<bigint>(protection, AnoraFacilityAbi, "seniorCapacity");
  const pSenior = pCapacity - 50_000n;
  await send(investor, protection, AnoraFacilityAbi, "deposit", [SENIOR, pSenior]);
  const pOver = await revertName(investor, protection, AnoraFacilityAbi, "deposit", [SENIOR, 60_000n]);
  step("c Senior di atas batas pada fasilitas proteksi revert", pOver === "SeniorCapacityExceeded", `senior ${pSenior} kapasitas ${pCapacity} revert ${pOver}`);
  const required = (pSenior * 10_000n + 22_499n) / 22_500n;
  const safe = 2n * U + 3n * U - required;
  const pJuniorShares = await read<bigint>(protection, AnoraFacilityAbi, "juniorShares", [investor.address]);
  const breach = await revertName(investor, protection, AnoraFacilityAbi, "withdraw", [JUNIOR, pJuniorShares]);
  step("d penarikan semua Junior yang melanggar proteksi Senior revert", breach === "JuniorProtectionBreached", `shares ${pJuniorShares} revert ${breach} ruang aman ${safe}`);
  const slightlyOver = await revertName(investor, protection, AnoraFacilityAbi, "withdraw", [JUNIOR, safe + 1n]);
  step("d penarikan sedikit di atas ruang aman revert", slightlyOver === "JuniorProtectionBreached", `shares ${safe + 1n} revert ${slightlyOver}`);
  const safeShares = safe / 2n;
  const okRevert = await revertName(investor, protection, AnoraFacilityAbi, "withdraw", [JUNIOR, safeShares]);
  await send(investor, protection, AnoraFacilityAbi, "withdraw", [JUNIOR, safeShares]);
  step("d penarikan Junior yang aman berhasil", okRevert === null, `shares ${safeShares}`);
  const pLiquidity = await read<bigint>(protection, AnoraFacilityAbi, "liquidity");
  await fullCycle("d lunas proteksi", protection, pLiquidity < 4n * U ? pLiquidity : 4n * U);

  const dflt = await open({ model: true, name: "E2E Default", limit: 10, firstLoss: 3, tenor: 40, grace: 20 });
  const df = dflt.facility;
  const dTerms = await terms(df);
  await approve(investor, df, 100n * U);
  await send(investor, df, AnoraFacilityAbi, "deposit", [JUNIOR, 2n * U]);
  const dCapacity = await read<bigint>(df, AnoraFacilityAbi, "seniorCapacity");
  const dSenior = dCapacity < 4n * U ? dCapacity : 4n * U;
  await send(investor, df, AnoraFacilityAbi, "deposit", [SENIOR, dSenior]);
  const dLiquidity = await read<bigint>(df, AnoraFacilityAbi, "liquidity");
  const dDraw = dLiquidity < 4n * U ? dLiquidity : 4n * U;
  await send(originator, df, AnoraFacilityAbi, "drawdown", [dDraw]);
  const dueAt = Number(await read<bigint>(df, AnoraFacilityAbi, "dueAt"));
  await waitUntil(dueAt + 8);
  const beforeLate = await read<number>(df, AnoraFacilityAbi, "status");
  let lateBy = "script";
  if (beforeLate === 0) {
    try {
      await send(deployer, df, AnoraFacilityAbi, "markLate", []);
    } catch {
      lateBy = "keeper";
    }
  } else {
    lateBy = "keeper";
  }
  const lateSince = Number(await read<bigint>(df, AnoraFacilityAbi, "lateSince"));
  step("e fasilitas ditandai telat setelah jatuh tempo", (await read<number>(df, AnoraFacilityAbi, "status")) === 1, `ditandai oleh ${lateBy}, lateSince ${lateSince}`);
  await waitUntil(lateSince + Number(dTerms[3]) + 8);
  const { hash: defaultHash } = await send(riskAgent, df, AnoraFacilityAbi, "declareDefault", ["E2E default drill"]);
  const dStatus = await read<number>(df, AnoraFacilityAbi, "status");
  step("e fasilitas default diketok risk agent baru", dStatus === 2, `status ${dStatus} tx ${defaultHash}`);
  const earlyJunior = await read<bigint>(df, AnoraFacilityAbi, "juniorShares", [investor.address]);
  const blockedInDefault = await revertName(investor, df, AnoraFacilityAbi, "withdraw", [JUNIOR, earlyJunior / 10n]);
  step("e penarikan Junior tidak diblokir proteksi saat Defaulted", blockedInDefault !== "JuniorProtectionBreached", `hasil ${blockedInDefault}`);
  const [lossFirst, lossJunior, lossSenior] = await read<readonly [bigint, bigint, bigint]>(df, AnoraFacilityAbi, "losses");
  const loss = lossFirst + lossJunior + lossSenior;
  await ensureFunds(originator, loss + 2n * U);
  await approve(originator, df, loss);
  await send(originator, df, AnoraFacilityAbi, "recordRecovery", [loss]);
  const dSeniorShares = await read<bigint>(df, AnoraFacilityAbi, "seniorShares", [investor.address]);
  const dJuniorShares = await read<bigint>(df, AnoraFacilityAbi, "juniorShares", [investor.address]);
  if (dSeniorShares > 0n) await send(investor, df, AnoraFacilityAbi, "withdraw", [SENIOR, dSeniorShares]);
  if (dJuniorShares > 0n) await send(investor, df, AnoraFacilityAbi, "withdraw", [JUNIOR, dJuniorShares]);
  const dLeft = await balanceOf(df);
  step("e pemulihan penuh dan klaim, saldo fasilitas nol", dLeft === 0n, `kerugian ${loss} saldo ${dLeft}`);

  step("f gas: createFacilityWithModel dibanding createFacility", model.gas > 0n && legacy.gas > 0n, `lama ${legacy.gas} model ${model.gas} selisih ${model.gas - legacy.gas}`);
}

async function main() {
  await topUpGas();
  if (mode === "cycle") await runCycleOnly();
  else await runFull();
  const passed = results.filter((item) => item.ok).length;
  console.log(`RINGKAS ${passed}/${results.length} lulus`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.log(`FAIL alur terhenti: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  console.log(`RINGKAS ${results.filter((item) => item.ok).length}/${results.length + 1} lulus`);
  process.exit(1);
});
