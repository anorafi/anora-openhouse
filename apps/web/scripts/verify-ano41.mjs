import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { planFacility } from "../src/lib/facilityPlan";
import { toUnits } from "../src/lib/book";
import { getWindow } from "/home/dims/.local/lib/vpsbrowser/browser.mjs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const sepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc"] } },
});
const deployments = JSON.parse(readFileSync(new URL("../../../contracts/deployments.ano41.json", import.meta.url), "utf8")).arbitrumSepolia;
const url = process.env.VERIFY_URL ?? "http://127.0.0.1:8061/";
const shotDir = process.env.VERIFY_SHOTS ?? "/home/dims/.cache/claude-work/verify-ano41";
const transport = http(sepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: sepolia, transport });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const originator = privateKeyToAccount(process.env.DEMO_ORIGINATOR_PRIVATE_KEY);
const fresh = privateKeyToAccount(generatePrivateKey());
const asset = deployments.asset;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
const factoryAbi = parseAbi(["function allFacilities() view returns (address[])"]);
const facilityAbi = parseAbi([
  "function seniorAssets() view returns (uint256)",
  "function juniorAssets() view returns (uint256)",
  "function seniorTotalShares() view returns (uint256)",
  "function juniorTotalShares() view returns (uint256)",
  "function owed() view returns (uint256)",
  "function principal() view returns (uint256)",
  "function drawdown(uint256)",
  "function repay(uint256)",
  "function modelVersion() view returns (uint256)",
  "function snapshotHash() view returns (bytes32)",
  "function seniorCapacity() view returns (uint256)",
  "function deposit(uint8,uint256) returns (uint256)",
  "error SeniorCapacityExceeded()",
  "error CapitalCapExceeded()",
  "function terms() view returns (uint256 limit,uint256 firstLoss,uint256 tenor,uint256 grace,uint256 financingFeeBps,uint256 lateFeePerDayBps,uint256 seniorPerJuniorBps,uint256 seniorFeeShareBps,uint256 capitalCap)",
]);
const balanceOf = (who) => publicClient.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [who] });
const facilities = () => publicClient.readContract({ address: deployments.AnoraFactory, abi: factoryAbi, functionName: "allFacilities" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
mkdirSync(shotDir, { recursive: true });

const deployerClient = createWalletClient({ account: deployer, chain: sepolia, transport });
const fund = await deployerClient.sendTransaction({ to: fresh.address, value: 1_000_000_000_000_000n });
await publicClient.waitForTransactionReceipt({ hash: fund });
const topUp = await deployerClient.writeContract({ address: asset, abi: erc20, functionName: "mint", args: [originator.address, 200_000_000n] });
await publicClient.waitForTransactionReceipt({ hash: topUp });
console.log(`wallet baru ${fresh.address}, saldo awal ${await balanceOf(fresh.address)}`);

let current = fresh;
async function walletRequest(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [current.address];
    case "eth_chainId":
      return "0x" + sepolia.id.toString(16);
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "eth_sendTransaction": {
      const tx = params[0];
      const client = createWalletClient({ account: current, chain: sepolia, transport });
      return client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    case "personal_sign":
      return current.signMessage({ message: { raw: params[0] } });
    default:
      return publicClient.request({ method, params });
  }
}

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "verify-ano41");
await page.setViewport({ width: 1440, height: 1000 });
await page.setCacheEnabled(false);
await page.exposeFunction("__walletRequest", async (method, params) => {
  const result = await walletRequest(method, params);
  return JSON.parse(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)));
});
await page.evaluateOnNewDocument(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    request: ({ method, params }) => window.__walletRequest(method, params ?? []),
    on: (event, fn) => ((listeners[event] ??= []).push(fn), provider),
    removeListener: (event, fn) => ((listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn)), provider),
  };
  window.ethereum = provider;
  window.__emitWallet = (event, arg) => (listeners[event] ?? []).forEach((fn) => fn(arg));
  const info = { uuid: "5f1c2a2e-0000-4000-8000-000000000002", name: "Demo Wallet", icon: "data:image/svg+xml,", rdns: "xyz.dimsky.demo" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

let step = 0;
async function shot(name) {
  step += 1;
  await sleep(1_200);
  const file = `${shotDir}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`shot ${file}`);
}
const text = () => page.evaluate(() => document.body.innerText);
async function until(fn, arg, what, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(1_000);
  }
  throw new Error(`timed out: ${what}`);
}
const waitText = (t, timeout) => until((x) => document.body.innerText.toLowerCase().includes(x.toLowerCase()), t, `text "${t}"`, timeout);
async function clickPrefix(prefix, timeout) {
  await until((p) => [...document.querySelectorAll("button")].some((b) => b.innerText.trim().startsWith(p) && !b.disabled), prefix, `button "${prefix}"`, timeout);
  await page.evaluate((p) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith(p) && !b.disabled).click(), prefix);
  console.log(`click ${prefix}`);
}
async function fill(labelText, value) {
  await page.evaluate(([labelText, value]) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(labelText));
    const input = label?.querySelector("input");
    if (!input) throw new Error(`no input under ${labelText}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [labelText, value]);
}
async function selectUnit(value) {
  await page.evaluate((v) => {
    const select = document.querySelector("select.unit-select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, v);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function actAs(account, workspace) {
  current = account;
  await page.evaluate((address) => window.__emitWallet("accountsChanged", [address]), account.address);
  await waitText(account.address.slice(0, 6));
  if (workspace) {
    const already = await page.evaluate((w) => document.querySelector(".workspace-current")?.innerText.trim() === w, workspace);
    if (!already) {
      await clickPrefix("Switch role");
      await page.evaluate((w) => [...document.querySelectorAll('[role="menuitemradio"]')].find((b) => b.innerText.includes(w)).click(), workspace);
    }
  }
}
async function go(label) {
  await page.evaluate((l) => [...document.querySelectorAll(".side-nav button")].find((b) => b.innerText.trim() === l).click(), label);
  await sleep(1_000);
}


const U = 1_000_000n;
const read = (address, functionName) => publicClient.readContract({ address, abi: facilityAbi, functionName });
const originatorClient = createWalletClient({ account: originator, chain: sepolia, transport });
const wait = (hash) => publicClient.waitForTransactionReceipt({ hash });

async function openMarket(name) {
  await go("Markets");
  await waitText("View market", 90_000);
  await sleep(2_000);
  const opened = await page.evaluate((n) => {
    const cards = [...document.querySelectorAll("button")].filter((b) => /View market/i.test(b.innerText));
    for (const button of cards) {
      let node = button;
      for (let i = 0; i < 6 && node; i += 1) {
        node = node.parentElement;
        if (node && node.innerText.includes(n) && node.querySelectorAll("button").length <= 3) { button.click(); return true; }
      }
    }
    return false;
  }, name);
  if (!opened) throw new Error(`card for ${name} not found in Markets`);
  await waitText("Wallet balance");
  await sleep(3_000);
}
const available = async () => page.evaluate(() => Number((document.body.innerText.match(/AVAILABLE TO INVEST\s*([\d.,]+)/i) ?? [])[1]?.replace(/,/g, "")));
async function supplyThroughUi(tranche, amount) {
  await page.evaluate((t) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.innerText.trim() === t).click(), tranche);
  await sleep(1_000);
  await fill("Amount", String(amount));
  await clickPrefix("Review supply");
  await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').forEach((box) => !box.checked && box.click()));
  await clickPrefix("Approve ");
  await clickPrefix("Supply capital", 120_000);
  await waitText("Position created", 120_000);
}


const dist = new URL("../dist/manifest.json", import.meta.url);
function setManifest(riskModel) {
  const manifest = JSON.parse(readFileSync(dist, "utf8"));
  manifest.defaultChainId = 421614;
  for (const network of manifest.networks) {
    if (network.chainId === 421614) {
      network.contracts.factory = deployments.AnoraFactory;
      network.contracts.facilityImplementation = deployments.AnoraFacilityImplementation;
      network.features = { ...network.features, riskModel };
      delete network.indexerApi;
    }
  }
  writeFileSync(dist, JSON.stringify(manifest, null, 2));
}
const deployerWallet = createWalletClient({ account: deployer, chain: sepolia, transport });
const money = (value) => Number(value) / 1_000_000;
const shownCapacity = async () => page.evaluate(() => Number((document.body.innerText.match(/Open to capital providers\s*([\d.,]+)/i) ?? [])[1]?.replace(/,/g, "")));
const formInputs = async () =>
  page.evaluate(() => {
    const t = document.body.innerText;
    const label = (name) => [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(name));
    const selects = [...document.querySelectorAll("select")].map((s) => s.value);
    const route = label("Trade route")?.querySelector("input")?.value ?? "";
    const duration = t.match(/Duration\s*(\d+) (days|minutes|hours), then (\d+) (days|minutes|hours) grace/i);
    return { financingType: selects[0] ?? "", route, tenor: duration ? Number(duration[1]) : 0, tenorUnit: duration?.[2] ?? "", grace: duration ? Number(duration[3]) : 0 };
  });
const unitSeconds = (unit) => (unit === "days" ? 86_400 : unit === "hours" ? 3_600 : 60);
async function expectedPlan(limit, firstLoss, riskModel) {
  const form = await formInputs();
  return planFacility({
    riskModel,
    faucet: true,
    limit,
    firstLoss,
    financingType: form.financingType,
    route: form.route,
    tenorSeconds: form.tenor * unitSeconds(form.tenorUnit),
    graceSeconds: form.grace * unitSeconds(form.tenorUnit),
  });
}

async function boot() {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(2_000);
  await page.evaluate(() => [...document.querySelectorAll("a,button")].find((e) => /Explore markets/i.test(e.innerText))?.click());
  await waitText("Markets");
  const alreadyConnected = await page.evaluate((prefix) => document.body.innerText.includes(prefix), current.address.slice(0, 6));
  if (!alreadyConnected) {
    await clickPrefix("Connect wallet");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Demo Wallet|Injected|MetaMask/i.test(b.innerText))?.click());
  }
  await waitText(current.address.slice(0, 6));
}

async function createThroughUi() {
  const name = await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.innerText.startsWith("Facility name")).querySelector("input").value);
  const before = (await facilities()).length;
  await clickPrefix("Approve ");
  await clickPrefix("Clone facility and lock first-loss", 120_000);
  await waitText("Listed in Markets", 120_000);
  await sleep(4_000);
  const all = await facilities();
  return { name, facility: all[all.length - 1], created: all.length === before + 1 };
}

async function chooseSeniorAmount(amount) {
  await fill("Amount", String(amount));
  await sleep(800);
}

try {
  await wait(await deployerWallet.writeContract({ address: asset, abi: erc20, functionName: "mint", args: [fresh.address, 100n * U] }));

  setManifest(true);
  await boot();
  await actAs(originator, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  await fill("Credit limit", "10");
  await fill("First-loss stake", "3");
  await sleep(1_500);
  const draftA = await shownCapacity();
  const planA = await expectedPlan(10, 3, true);
  record("flag nyala: draf limit 10 dan first-loss 3 memakai model, bukan 6.75", Math.abs(draftA - planA.seniorOpen) < 0.01 && Math.abs(draftA - 6.75) > 0.05, `tampil ${draftA} kalkulator ${planA.seniorOpen} rasio ${planA.seniorPerJuniorBps}`);
  await shot("flag-on-draft-a");
  await fill("Credit limit", "20");
  await fill("First-loss stake", "4");
  await sleep(1_500);
  const draftB = await shownCapacity();
  const planB = await expectedPlan(20, 4, true);
  record("flag nyala: draf berubah otomatis saat input berubah", draftB !== draftA && Math.abs(draftB - planB.seniorOpen) < 0.01, `tampil ${draftB} kalkulator ${planB.seniorOpen}`);
  await shot("flag-on-draft-b");
  await fill("Credit limit", "10");
  await fill("First-loss stake", "3");
  await sleep(1_500);
  const planCreate = await expectedPlan(10, 3, true);
  const made = await createThroughUi();
  record("flag nyala: fasilitas dibuat lewat UI", made.created, `${made.name} ${made.facility}`);
  const facility = made.facility;
  const onTerms = await read(facility, "terms");
  const onVersion = await read(facility, "modelVersion");
  const onHash = await read(facility, "snapshotHash");
  record("flag nyala: terms on-chain per fasilitas sama dengan kalkulator", onVersion === BigInt(planCreate.modelVersion) && onTerms[6] === BigInt(planCreate.seniorPerJuniorBps) && onTerms[8] === planCreate.capitalCap, `versi ${onVersion} rasio ${onTerms[6]} cap ${onTerms[8]}`);
  record("flag nyala: snapshot yang dibekukan sama dengan hash kalkulator", onHash === planCreate.snapshotHash, `${onHash}`);

  await actAs(fresh, "Capital provider");
  await openMarket(made.name);
  const providerRoom = await available();
  const onCapacity = await read(facility, "seniorCapacity");
  record("flag nyala: kapasitas Senior di sisi pemodal sama dengan kontrak dan kalkulator", Math.abs(providerRoom - money(onCapacity)) < 0.01 && Math.abs(providerRoom - planCreate.seniorOpen) < 0.01, `tampil ${providerRoom} kontrak ${money(onCapacity)} kalkulator ${planCreate.seniorOpen}`);
  await supplyThroughUi("Senior", 2);
  let supplied = 0n;
  for (let attempt = 0; attempt < 20 && supplied !== 2n * U; attempt += 1) {
    await sleep(2_000);
    supplied = await read(facility, "seniorAssets");
  }
  record("flag nyala: supply valid diterima", supplied === 2n * U, `seniorAssets ${supplied}`);
  await openMarket(made.name);
  const roomAfter = await available();
  await chooseSeniorAmount(String(roomAfter + 1));
  const blockedUi = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("Review supply"));
    return { disabled: button ? button.disabled : true, text: /Only\s+[\d.,]+\s+is open to supply/i.test(document.body.innerText) };
  });
  await shot("flag-on-over-cap-ui");
  record("flag nyala: supply di atas batas ditolak di UI", blockedUi.disabled && blockedUi.text, JSON.stringify(blockedUi));
  const capNow = await read(facility, "seniorCapacity");
  let revertName = "tidak revert";
  try {
    await publicClient.simulateContract({ account: fresh.address, address: facility, abi: facilityAbi, functionName: "deposit", args: [0, capNow + 1n] });
  } catch (error) {
    const full = `${error.shortMessage ?? ""} ${error.message ?? ""} ${error.cause?.data?.errorName ?? ""} ${error.cause?.reason ?? ""}`;
    revertName = full.match(/SeniorCapacityExceeded|CapitalCapExceeded/)?.[0] ?? full.slice(0, 120);
  }
  record("flag nyala: supply di atas batas revert di kontrak", revertName === "SeniorCapacityExceeded" || revertName === "CapitalCapExceeded", `batas ${capNow} revert ${revertName}`);

  await openMarket(made.name);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /View risk and underwriting/i.test(b.innerText)).click());
  await sleep(2_500);
  const riskText = await text();
  const providerBar = (riskText.match(/Senior ([\d.]+)%[\s\S]{0,40}First-loss ([\d.]+)%/) ?? []).slice(1, 3).join("/");
  await page.evaluate(() => document.querySelector(".modal-close")?.click());
  await actAs(originator, "Originator");
  await go("My facilities");
  await sleep(5_000);
  await page.evaluate((n) => {
    const cards = [...document.querySelectorAll("button")].filter((b) => /Manage|Draw liquidity/i.test(b.innerText));
    for (const button of cards) {
      let node = button;
      for (let i = 0; i < 6 && node; i += 1) { node = node.parentElement; if (node && node.innerText.includes(n) && node.querySelectorAll("button").length <= 3) { button.click(); return; } }
    }
    throw new Error("facility card not found for originator");
  }, made.name);
  await waitText("Risk structure", 60_000);
  await sleep(3_000);
  const originatorText = await text();
  const originatorBar = (originatorText.match(/Senior\s*([\d.]+)%[\s\S]{0,60}First-loss\s*([\d.]+)%/i) ?? []).slice(1, 3).join("/");
  record("flag nyala: struktur di sisi originator dan pemodal identik", providerBar !== "" && providerBar === originatorBar, `pemodal ${providerBar} originator ${originatorBar}`);
  await shot("flag-on-originator-structure");

  setManifest(false);
  await boot();
  await actAs(originator, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  await fill("Credit limit", "10");
  await fill("First-loss stake", "3");
  await sleep(1_500);
  const offDraft = await shownCapacity();
  record("flag mati: draf identik dengan sekarang (6.75)", Math.abs(offDraft - 6.75) < 0.005, `tampil ${offDraft}`);
  await shot("flag-off-draft");
  const legacy = await createThroughUi();
  const legacyTerms = await read(legacy.facility, "terms");
  const legacyVersion = await read(legacy.facility, "modelVersion");
  const legacyCapacity = await read(legacy.facility, "seniorCapacity");
  record("flag mati: fasilitas lewat createFacility lama dengan rasio 22500", legacyVersion === 0n && legacyTerms[6] === 22_500n && legacyCapacity === 6_750_000n, `versi ${legacyVersion} rasio ${legacyTerms[6]} kapasitas ${legacyCapacity}`);
} catch (error) {
  record("alur terhenti", false, String(error.message).slice(0, 220));
  await shot("error").catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`RINGKAS ${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
