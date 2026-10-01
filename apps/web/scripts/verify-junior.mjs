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
const url = process.env.VERIFY_URL ?? "http://127.0.0.1:8041/";
const shotDir = process.env.VERIFY_SHOTS ?? "/home/dims/.cache/claude-work/verify-junior";
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

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "verify-junior");
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

  await actAs(originator, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  await fill("Credit limit", "10");
  await fill("First-loss stake", "3");
  const draftText = await text();
  record("form buka fasilitas menampilkan struktur Junior dari kontrak, bukan Senior only", /Junior\s*0\.8%/i.test(draftText) && !/Junior is not offered/i.test(draftText), (draftText.match(/Junior\s*[\d.]+%/i) ?? ["tidak ditemukan"])[0].replace(/\s+/g, " "));
  await shot("open-form-structure");
  const name = await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.innerText.startsWith("Facility name")).querySelector("input").value);
  const countBefore = (await facilities()).length;
  await clickPrefix("Approve ");
  await clickPrefix("Clone facility and lock first-loss", 120_000);
  await waitText("Listed in Markets", 120_000);
  await sleep(4_000);
  const all = await facilities();
  const facility = all[all.length - 1];
  record("fasilitas baru dibuat", all.length === countBefore + 1, `${name} ${facility}`);

  await actAs(fresh, "Capital provider");
  await openMarket(name);
  const pickerText = await text();
  record("panel supply punya pemilih Senior dan Junior", await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].map((b) => b.innerText.trim()).join(",") === "Senior,Junior"), "Senior,Junior");
  const seniorRoom = await available();
  record("kapasitas Senior awal 6.75 (2,25 kali first-loss 3)", Math.abs(seniorRoom - 6.75) < 0.01, `tampil ${seniorRoom}`);
  await clickPrefix("Get 1,000 test");
  await sleep(8_000);
  await shot("provider-senior-default");

  await page.evaluate(() => [...document.querySelectorAll('[role="radio"]')].find((b) => b.innerText.trim() === "Junior").click());
  await sleep(1_500);
  const juniorRoom = await available();
  record("kapasitas Junior 7 (sisa capital cap) sesudah memilih Junior", Math.abs(juniorRoom - 7) < 0.01, `tampil ${juniorRoom}`);
  record("peringatan risiko Junior tampil", (await text()).includes("Junior absorbs losses right after"), "ada");
  await shot("provider-junior-selected");
  await supplyThroughUi("Junior", 1);
  await shot("junior-supplied");
  await sleep(5_000);
  const junior1 = await read(facility, "juniorAssets");
  record("deposit Junior 1 tercatat di kontrak", junior1 === 1n * U && (await read(facility, "seniorAssets")) === 0n, `juniorAssets ${junior1}`);

  await openMarket(name);
  await sleep(3_000);
  const seniorRoomAfter = await available();
  const expectedSenior = 6;
  record("kapasitas Senior naik setelah Junior hadir (kontrak: min(9, 9, 6) = 6)", Math.abs(seniorRoomAfter - expectedSenior) < 0.01, `tampil ${seniorRoomAfter}`);
  await supplyThroughUi("Senior", 5);
  await shot("senior-supplied");
  await sleep(5_000);
  const senior5 = await read(facility, "seniorAssets");
  record("deposit Senior 5 tercatat di kontrak", senior5 === 5n * U, `seniorAssets ${senior5}`);

  await openMarket(name);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /View risk and underwriting/i.test(b.innerText)).click());
  await sleep(2_500);
  const riskText = await text();
  const providerBar = /Senior 60\.0%/.test(riskText) && /Junior 10\.0%/.test(riskText) && /First-loss 30\.0%/.test(riskText);
  record("modal risiko capital provider menampilkan Senior 60, Junior 10, First-loss 30 dari kontrak", providerBar, (riskText.match(/Senior [\d.]+%[\s\S]{0,40}First-loss [\d.]+%/) ?? ["tidak ditemukan"])[0].replace(/\s+/g, " "));
  await shot("provider-risk-modal");
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
  }, name);
  await waitText("Risk structure", 60_000);
  await sleep(3_000);
  const originatorText = await text();
  const sameNumbers = /Senior\s*60\.0%/i.test(originatorText) && /Junior\s*10\.0%/i.test(originatorText) && /First-loss\s*30\.0%/i.test(originatorText);
  record("sisi originator menampilkan angka yang sama (Senior 60, Junior 10, First-loss 30)", sameNumbers, (originatorText.match(/Senior\s*[\d.]+%[\s\S]{0,60}First-loss\s*[\d.]+%/i) ?? ["tidak ditemukan"])[0].replace(/\s+/g, " "));
  record("tidak ada tulisan Senior only di sisi originator", !originatorText.includes("Senior only") && !originatorText.includes("not offered"), "bersih");
  await shot("originator-structure");

  const principalDraw = 6n * U;
  await wait(await originatorClient.writeContract({ address: facility, abi: facilityAbi, functionName: "drawdown", args: [principalDraw] }));
  const owed = await read(facility, "owed");
  await wait(await originatorClient.writeContract({ address: asset, abi: erc20, functionName: "mint", args: [originator.address, owed] }));
  await wait(await originatorClient.writeContract({ address: asset, abi: erc20, functionName: "approve", args: [facility, owed] }));
  await wait(await originatorClient.writeContract({ address: facility, abi: facilityAbi, functionName: "repay", args: [owed] }));
  const balanceBeforeClaim = await balanceOf(fresh.address);
  console.log(`draw 6, repay ${owed}`);

  await actAs(fresh, "Capital provider");
  await go("Portfolio");
  await sleep(8_000);
  const portfolioText = await text();
  record("portfolio menyebut tranche posisi (Senior and Junior)", portfolioText.includes("Senior and Junior"), portfolioText.includes("Senior and Junior") ? "ada" : "tidak ada");
  await shot("portfolio-tranches");
  await clickPrefix("Claim", 60_000);
  await clickPrefix("Confirm claim", 60_000);
  await sleep(15_000);
  const sharesSenior = await read(facility, "seniorTotalShares");
  const sharesJunior = await read(facility, "juniorTotalShares");
  const balanceAfterClaim = await balanceOf(fresh.address);
  record("klaim menarik kedua tranche (share Senior dan Junior nol)", sharesSenior === 0n && sharesJunior === 0n, `senior ${sharesSenior} junior ${sharesJunior}`);
  record("saldo pemodal naik sesuai pokok plus fee, fasilitas kosong", balanceAfterClaim > balanceBeforeClaim && (await balanceOf(facility)) === 0n, `saldo ${balanceBeforeClaim} -> ${balanceAfterClaim}, fasilitas ${await balanceOf(facility)}`);
  await shot("claimed");
} catch (error) {
  record("alur terhenti", false, String(error.message).slice(0, 220));
  await shot("error").catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`RINGKAS ${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
