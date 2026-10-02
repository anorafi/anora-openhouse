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
const shotDir = process.env.VERIFY_SHOTS ?? "/home/dims/.cache/claude-work/verify-sizing";
const transport = http(sepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: sepolia, transport });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const fresh = privateKeyToAccount(generatePrivateKey());
const asset = deployments.asset;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function mint(address,uint256)"]);
const factoryAbi = parseAbi(["function allFacilities() view returns (address[])", "function setOriginatorApproved(address,bool)", "function approvedOriginators(address) view returns (bool)"]);
const facilityAbi = parseAbi([
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
const approve = await deployerClient.writeContract({ address: deployments.AnoraFactory, abi: factoryAbi, functionName: "setOriginatorApproved", args: [fresh.address, true] });
await publicClient.waitForTransactionReceipt({ hash: approve });
record("wallet originator baru disetujui owner di factory aktif", await publicClient.readContract({ address: deployments.AnoraFactory, abi: factoryAbi, functionName: "approvedOriginators", args: [fresh.address] }), fresh.address);
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

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "verify-sizing");
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

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  const served = await page.evaluate(() => [...document.scripts].map((script) => script.src).find((src) => /assets\/index-/.test(src)) ?? "");
  const expected = (await (await fetch(url)).text()).match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? "";
  record("browser memuat bundel terbaru dari preview", expected !== "" && served.endsWith(expected), `${served.split("/").pop()} vs ${expected.split("/").pop()}`);
  await sleep(2_000);
  await page.evaluate(() => [...document.querySelectorAll("a,button")].find((e) => /Explore markets/i.test(e.innerText))?.click());
  await waitText("Markets");
  const alreadyConnected = await page.evaluate((prefix) => document.body.innerText.includes(prefix), fresh.address.slice(0, 6));
  if (!alreadyConnected) {
    await clickPrefix("Connect wallet");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Demo Wallet|Injected|MetaMask/i.test(b.innerText))?.click());
  }
  await waitText(fresh.address.slice(0, 6));
  await waitText("Claim TestUSDC");
  record("tombol Claim TestUSDC tampil di header untuk wallet tersambung di Sepolia", true, "ada");
  await shot("markets-connected");

  const before = await balanceOf(fresh.address);
  await clickPrefix("Claim TestUSDC");
  const claimed = Date.now();
  while (Date.now() - claimed < 90_000 && (await balanceOf(fresh.address)) === before) await sleep(2_000);
  const after = await balanceOf(fresh.address);
  record("satu klaim faucet mint 10.000 TestUSDC onchain", after - before === 10_000_000_000n, `${before} -> ${after}`);

  await actAs(fresh, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  await sleep(3_000);
  const form = await page.evaluate(() => {
    const read = (prefix) => [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(prefix))?.querySelector("input")?.value;
    return { name: read("Facility name"), limit: read("Credit limit"), firstLoss: read("First-loss stake") };
  });
  const limitValue = Number(form.limit.replace(/,/g, ""));
  const firstLossValue = Number(form.firstLoss.replace(/,/g, ""));
  const balanceUnits = await balanceOf(fresh.address);
  record("first-loss bawaan terjangkau dari satu klaim", BigInt(firstLossValue) * 1_000_000n <= balanceUnits, `limit ${limitValue}, first-loss ${firstLossValue}, saldo ${balanceUnits}`);
  record("first-loss bawaan memenuhi batas bawah 10 persen", firstLossValue >= limitValue * 0.1, `${firstLossValue} >= ${limitValue * 0.1}`);
  const pageText = await text();
  record("tidak ada peringatan di bawah batas bawah", !/below the 10% floor/i.test(pageText), "bersih");
  await shot("open-form-defaults");

  const countBefore = (await facilities()).length;
  await clickPrefix("Approve ");
  await clickPrefix("Clone facility and lock first-loss", 120_000);
  await waitText("Listed in Markets", 120_000);
  await sleep(4_000);
  const all = await facilities();
  const opened = all[all.length - 1];
  const terms = await publicClient.readContract({ address: opened, abi: facilityAbi, functionName: "terms" });
  record("fasilitas dibuka dari draf bawaan tanpa mengubah angka", all.length === countBefore + 1 && terms[0] === BigInt(limitValue) * 1_000_000n && terms[1] === BigInt(firstLossValue) * 1_000_000n, `limit ${terms[0]} first-loss ${terms[1]}`);
  await shot("listed");

  await actAs(fresh, "Capital provider");
  await go("Markets");
  await waitText(form.name.split(" ").slice(0, 2).join(" "), 90_000);
  const listed = (await text()).includes(form.name);
  record("fasilitas baru tampil di Markets", listed, form.name);
  await shot("markets-new-facility");
} catch (error) {
  record("alur terhenti", false, String(error.message ?? error));
  await shot("error").catch(() => {});
}
const passed = results.filter((item) => item.ok).length;
console.log(`RINGKAS ${passed}/${results.length} lulus`);
process.exit(passed === results.length ? 0 : 1);
