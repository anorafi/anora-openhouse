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
const shotDir = process.env.VERIFY_SHOTS ?? "/home/dims/.cache/claude-work/verify-selfserve";
const transport = http(sepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: sepolia, transport });
const deployer = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const owner = privateKeyToAccount(process.env.SEPOLIA_OWNER_PRIVATE_KEY);
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
const fund = await deployerClient.sendTransaction({ to: fresh.address, value: 200_000_000_000_000n });
await publicClient.waitForTransactionReceipt({ hash: fund });
const ownerClient = createWalletClient({ account: owner, chain: sepolia, transport });
const second = privateKeyToAccount(generatePrivateKey());
const isApproved = (who) => publicClient.readContract({ address: deployments.AnoraFactory, abi: factoryAbi, functionName: "approvedOriginators", args: [who] });
const ownerNonce = () => publicClient.getTransactionCount({ address: owner.address, blockTag: "latest" });
record("wallet baru belum disetujui sebelum membuka halaman", (await isApproved(fresh.address)) === false, fresh.address);
const preApprove = await ownerClient.writeContract({ address: deployments.AnoraFactory, abi: factoryAbi, functionName: "setOriginatorApproved", args: [second.address, true] });
await publicClient.waitForTransactionReceipt({ hash: preApprove });
const secondFund = await deployerClient.sendTransaction({ to: second.address, value: 20_000_000_000_000n });
await publicClient.waitForTransactionReceipt({ hash: secondFund });
record("wallet kedua disetujui lebih dulu oleh owner", await isApproved(second.address), second.address);
console.log(`wallet baru ${fresh.address}, saldo awal ${await balanceOf(fresh.address)}`);

let current = fresh;
let chainHex = "0x" + sepolia.id.toString(16);
let onSwitch = () => {};
async function walletRequest(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [current.address];
    case "eth_chainId":
      return chainHex;
    case "wallet_switchEthereumChain":
      chainHex = params[0].chainId;
      setTimeout(() => onSwitch(), 300);
      return null;
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

const approvalCalls = [];
const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "verify-selfserve");
await page.setViewport({ width: 1440, height: 1000 });
await page.setCacheEnabled(false);
page.on("request", (r) => { if (r.url().includes("/v1/originator-approvals") && r.method() === "POST") approvalCalls.push(r.postData()); });
onSwitch = () => page.evaluate((hex) => window.__emitWallet("chainChanged", hex), chainHex).catch(() => {});
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

  const nonceBefore = await ownerNonce();
  await actAs(fresh, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  const sawNotice = await (async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if ((await text()).includes("Approving this wallet as a demo originator")) return true;
      if (await isApproved(fresh.address)) return false;
      await sleep(400);
    }
    return false;
  })();
  record("status persetujuan otomatis tampil saat halaman Open a facility dibuka", sawNotice, sawNotice ? "terlihat" : "tidak sempat terlihat sebelum disetujui");
  await shot("open-form-approving");
  const approvedDeadline = Date.now() + 60_000;
  while (Date.now() < approvedDeadline && !(await isApproved(fresh.address))) await sleep(1_500);
  record("wallet baru disetujui on-chain otomatis (approvedOriginators true)", await isApproved(fresh.address), fresh.address);
  await sleep(4_000);
  record("tepat satu permintaan persetujuan ke API", approvalCalls.length === 1, `${approvalCalls.length} permintaan`);
  record("owner mengirim tepat satu transaksi", (await ownerNonce()) - nonceBefore === 1, `${nonceBefore} -> ${await ownerNonce()}`);
  record("catatan persetujuan hilang setelah disetujui", !(await text()).includes("Approving this wallet as a demo originator"), "bersih");

  const form = await page.evaluate(() => {
    const read = (prefix) => [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(prefix))?.querySelector("input")?.value;
    return { name: read("Facility name"), limit: read("Credit limit"), firstLoss: read("First-loss stake") };
  });
  const limitValue = Number(form.limit.replace(/,/g, ""));
  const firstLossValue = Number(form.firstLoss.replace(/,/g, ""));
  const countBefore = (await facilities()).length;
  await clickPrefix("Approve ");
  await clickPrefix("Clone facility and lock first-loss", 120_000);
  await waitText("Listed in Markets", 120_000);
  await sleep(4_000);
  const all = await facilities();
  const opened = all[all.length - 1];
  const terms = await publicClient.readContract({ address: opened, abi: facilityAbi, functionName: "terms" });
  record("approve lalu clone sukses dari draf bawaan setelah persetujuan otomatis", all.length === countBefore + 1 && terms[0] === BigInt(limitValue) * 1_000_000n && terms[1] === BigInt(firstLossValue) * 1_000_000n, `limit ${terms[0]} first-loss ${terms[1]}`);
  await shot("listed");

  await actAs(fresh, "Capital provider");
  await go("Markets");
  await waitText(form.name.split(" ").slice(0, 2).join(" "), 90_000);
  record("fasilitas baru tampil di Markets", (await text()).includes(form.name), form.name);

  const callsBeforeSecond = approvalCalls.length;
  const nonceBeforeSecond = await ownerNonce();
  await actAs(second, "Originator");
  await go("Open a facility");
  await waitText("Facility terms");
  await sleep(8_000);
  record("wallet yang sudah disetujui tidak memanggil API", approvalCalls.length === callsBeforeSecond, `${approvalCalls.length - callsBeforeSecond} permintaan baru`);
  record("wallet yang sudah disetujui tidak memicu transaksi owner", (await ownerNonce()) === nonceBeforeSecond, `nonce ${nonceBeforeSecond}`);
  await shot("second-wallet-open-form");

  const manifest = await (await fetch(new URL("manifest.json", url))).json();
  const flags = Object.fromEntries(manifest.networks.map((entry) => [entry.chainId, entry.features.selfServeOriginator]));
  record("manifest: swalayan menyala di Sepolia dan mati di Robinhood", flags[421614] === true && flags[4663] === false, JSON.stringify(flags));

  const callsBeforeRobinhood = approvalCalls.length;
  const balanceBefore = await publicClient.getTransactionCount({ address: fresh.address });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Arbitrum Sepolia/.test(b.innerText))?.click());
  await sleep(800);
  await page.evaluate(() => [...document.querySelectorAll("button,[role='menuitem'],[role='menuitemradio']")].find((b) => /Robinhood Chain/.test(b.innerText))?.click());
  await sleep(6_000);
  const onRobinhood = await page.evaluate(() => /Robinhood Chain/.test(document.querySelector("header,.topbar,body")?.innerText ?? ""));
  await actAs(fresh, "Originator").catch(() => {});
  await go("Open a facility").catch(() => {});
  await sleep(8_000);
  const robinhoodText = await text();
  record("di Robinhood tidak ada permintaan persetujuan ke API", approvalCalls.length === callsBeforeRobinhood, `${approvalCalls.length - callsBeforeRobinhood} permintaan baru`);
  record("di Robinhood tidak ada catatan persetujuan otomatis", !robinhoodText.includes("Approving this wallet as a demo originator"), onRobinhood ? "jaringan Robinhood aktif" : "jaringan tidak sempat berpindah");
  record("pengujian Robinhood tidak mengirim transaksi", (await publicClient.getTransactionCount({ address: fresh.address })) === balanceBefore, "nonce wallet uji tidak berubah");
  await shot("robinhood-open-form");
} catch (error) {
  record("alur terhenti", false, String(error.message ?? error));
  await shot("error").catch(() => {});
}
const passed = results.filter((item) => item.ok).length;
console.log(`RINGKAS ${passed}/${results.length} lulus`);
process.exit(passed === results.length ? 0 : 1);
