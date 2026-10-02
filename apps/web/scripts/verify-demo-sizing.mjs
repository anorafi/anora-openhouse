import { mkdirSync, readFileSync } from "node:fs";
import { getWindow } from "/home/dims/.local/lib/vpsbrowser/browser.mjs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const sepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc"] } },
});
const deployments = JSON.parse(readFileSync(new URL("../../../contracts/deployments.json", import.meta.url), "utf8")).arbitrumSepolia;
const url = process.env.VERIFY_URL ?? "http://127.0.0.1:8031/";
const shotDir = process.env.VERIFY_SHOTS ?? "/home/dims/.cache/claude-work/verify-demo-sizing";
const transport = http(sepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: sepolia, transport });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const fresh = privateKeyToAccount(generatePrivateKey());
const demoOriginator = privateKeyToAccount(process.env.DEMO_ORIGINATOR_PRIVATE_KEY);
const seeded = JSON.parse(readFileSync("/home/dims/.cache/claude-work/seed-sepolia-sized.json", "utf8")).facilities;
const byName = (name) => seeded.find((item) => item.name === name).address;
const asset = deployments.asset;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function mint(address,uint256)"]);
const factoryAbi = parseAbi(["function allFacilities() view returns (address[])", "function setOriginatorApproved(address,bool)", "function approvedOriginators(address) view returns (bool)"]);
const facilityAbi = parseAbi([
  "function status() view returns (uint8)",
  "function juniorAssets() view returns (uint256)",
  "function seniorAssets() view returns (uint256)",
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

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "verify-demo-sizing");
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

const FACILITY = "Mekong Rubber Consignment 81";
const LATE = ["Cebu Shrimp Export 84", "Colombo Tea Auction 85"];
const ACTIVE = "Karachi Textile Shipment 86";
const statusOf = (address) => publicClient.readContract({ address, abi: facilityAbi, functionName: "status" });

async function openMarket(name) {
  await go("Markets");
  await waitText(name, 90_000);
  await page.evaluate((target) => {
    const buttons = [...document.querySelectorAll("button,a")].filter((b) => /View market/i.test(b.innerText));
    const pick = buttons.find((button) => {
      let node = button;
      for (let level = 0; level < 8 && node; level += 1) {
        node = node.parentElement;
        if (node && node.innerText.includes(target)) return buttons.filter((other) => node.contains(other)).length === 1;
      }
      return false;
    });
    pick.click();
  }, name);
  await waitText("Wallet balance");
}

async function supplyTranche(tranche, amount) {
  await page.evaluate((label) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.innerText.trim() === label).click(), tranche);
  await sleep(500);
  await fill("Amount", String(amount));
  await clickPrefix("Review supply");
  await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').forEach((box) => !box.checked && box.click()));
  await clickPrefix("Approve ");
  await clickPrefix("Supply capital", 120_000);
  await waitText("Position created", 120_000);
}

try {
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const states = await Promise.all(LATE.map((name) => statusOf(byName(name))));
    if (states.every((value) => value === 1)) break;
    await sleep(10_000);
  }
  for (const name of LATE) record(`fasilitas cadangan ${name} ditandai telat oleh keeper`, (await statusOf(byName(name))) === 1, `status ${await statusOf(byName(name))}`);
  record(`fasilitas cadangan ${ACTIVE} masih Open dengan pokok ditarik`, (await statusOf(byName(ACTIVE))) === 0, `status ${await statusOf(byName(ACTIVE))}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(2_000);
  await page.evaluate(() => [...document.querySelectorAll("a,button")].find((e) => /Explore markets/i.test(e.innerText))?.click());
  await waitText("Markets");
  const alreadyConnected = await page.evaluate((prefix) => document.body.innerText.includes(prefix), fresh.address.slice(0, 6));
  if (!alreadyConnected) {
    await clickPrefix("Connect wallet");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Demo Wallet|Injected|MetaMask/i.test(b.innerText))?.click());
  }
  await waitText(fresh.address.slice(0, 6));

  const before = await balanceOf(fresh.address);
  await clickPrefix("Claim TestUSDC");
  const claimed = Date.now();
  while (Date.now() - claimed < 90_000 && (await balanceOf(fresh.address)) === before) await sleep(2_000);
  record("klaim faucet memberi 10.000 TestUSDC", (await balanceOf(fresh.address)) - before === 10_000_000_000n, `${before} -> ${await balanceOf(fresh.address)}`);

  const markets = await text();
  for (const name of [FACILITY, "Sihanoukville Rice Cargo 82", "Surabaya Coffee Forward 83"]) record(`Markets menampilkan fasilitas Open ${name}`, markets.includes(name), "ada");
  await shot("markets-sized");

  const address = byName(FACILITY);
  const readTranches = async () => [await publicClient.readContract({ address, abi: facilityAbi, functionName: "seniorAssets" }), await publicClient.readContract({ address, abi: facilityAbi, functionName: "juniorAssets" })];
  const [seniorBefore, juniorBefore] = await readTranches();
  await openMarket(FACILITY);
  const detail = await text();
  const capacity = (detail.match(/AVAILABLE TO INVEST\s*([\d.,]+)/i) ?? [])[1];
  record("kapasitas tersedia berada di ribuan", Number((capacity ?? "0").replace(/,/g, "")) >= 1_000, `tampil ${capacity}`);
  await shot("supply-panel");
  await supplyTranche("Senior", 1000);
  await shot("supplied-senior");
  await openMarket(FACILITY);
  await supplyTranche("Junior", 1000);
  await shot("supplied-junior");
  let seniorAssets = seniorBefore;
  let juniorAssets = juniorBefore;
  const settle = Date.now();
  while (Date.now() - settle < 45_000) {
    [seniorAssets, juniorAssets] = await readTranches();
    if (seniorAssets - seniorBefore === 1_000_000_000n && juniorAssets - juniorBefore === 1_000_000_000n) break;
    await sleep(3_000);
  }
  record("supply Senior 1.000 dan Junior 1.000 menaikkan masing-masing tranche di kontrak", seniorAssets - seniorBefore === 1_000_000_000n && juniorAssets - juniorBefore === 1_000_000_000n, `senior ${seniorBefore} -> ${seniorAssets}, junior ${juniorBefore} -> ${juniorAssets}`);

  await go("Portfolio");
  await waitText(FACILITY, 60_000);
  const waitStart = Date.now();
  const readTotal = async () => Number((((await text()).match(/TOTAL SUPPLIED\s*([\d.,]+)/i) ?? [])[1] ?? "0").replace(/,/g, ""));
  let total = await readTotal();
  while (total < 2_000 && Date.now() - waitStart < 60_000) {
    await sleep(3_000);
    total = await readTotal();
  }
  const portfolio = await text();
  record("portofolio menampilkan pembaruan yang tampak", portfolio.includes(FACILITY) && total >= 2_000, `total supplied ${total} setelah ${Math.round((Date.now() - waitStart) / 1000)} detik menunggu indexer`);
  await shot("portfolio");

  await actAs(demoOriginator, "Originator");
  await go("My facilities");
  await waitText("Facilities", 60_000);
  await sleep(4_000);
  const list = await text();
  const rows = (name) => { const index = list.indexOf(name); return index < 0 ? "" : list.slice(index, index + 260); };
  for (const name of LATE) record(`daftar originator menampilkan ${name} sebagai Past due`, /Past due/.test(rows(name)), (rows(name).match(/Past due|Drawn|Funded|Seeking capital|Closed at loss|Settled/) ?? ["tidak ditemukan"])[0]);
  record(`daftar originator menampilkan ${ACTIVE} sebagai Drawn`, /Drawn/.test(rows(ACTIVE)), (rows(ACTIVE).match(/Past due|Drawn|Funded|Seeking capital|Closed at loss|Settled/) ?? ["tidak ditemukan"])[0]);
  await shot("my-facilities");
} catch (error) {
  record("alur terhenti", false, String(error.message ?? error));
  await shot("error").catch(() => {});
}
const passed = results.filter((item) => item.ok).length;
console.log(`RINGKAS ${passed}/${results.length} lulus`);
process.exit(passed === results.length ? 0 : 1);
