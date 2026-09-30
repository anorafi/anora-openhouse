import { mkdirSync, readFileSync } from "node:fs";
import { getWindow } from "/home/dims/.local/lib/vpsbrowser/browser.mjs";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const sepolia = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC ?? "https://rpc.mainnet.chain.robinhood.com"] } },
});
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const erc20Abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
const deployments = JSON.parse(readFileSync(new URL("../../../contracts/deployments.json", import.meta.url), "utf8"));
const factoryAddress = process.env.SMOKE_FACTORY ?? deployments.robinhood.AnoraFactory;
const factoryAbi = [{ type: "function", name: "allFacilities", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }];
const facilityAbi = [
  { type: "function", name: "dueAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "drawdown", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "markLate", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

const url = process.env.SMOKE_URL ?? "http://127.0.0.1:8011/";
const shotDir = process.env.SMOKE_SHOTS ?? "/home/dims/.cache/claude-work/smoke-robinhood";
const paths = (process.env.SMOKE_PATHS ?? "repaid,default").split(",");
const transport = http(sepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: sepolia, transport });
const wallets = {
  investor: privateKeyToAccount(process.env.DEMO_INVESTOR_PRIVATE_KEY),
  originator: privateKeyToAccount(process.env.DEMO_ORIGINATOR_PRIVATE_KEY),
  risk: privateKeyToAccount(process.env.RISK_AGENT_PRIVATE_KEY),
};
let current = wallets.originator;
const balanceOf = (address) => publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [address] });
async function snapshot(label) {
  const investor = await balanceOf(wallets.investor.address);
  const originator = await balanceOf(wallets.originator.address);
  const risk = await balanceOf(wallets.risk.address);
  const facility = await latestFacility().then(balanceOf).catch(() => 0n);
  const fmt = (v) => (Number(v) / 1e6).toFixed(6);
  console.log(`USDG ${label}: investor ${fmt(investor)} originator ${fmt(originator)} risk ${fmt(risk)} facility ${fmt(facility)} total ${fmt(investor + originator + risk + facility)}`);
  return { investor, originator, risk, facility, total: investor + originator + risk + facility };
}
function assertConserved(start, now, label) {
  const wallets3 = now.investor + now.originator + now.risk;
  const startWallets = start.investor + start.originator + start.risk;
  if (wallets3 + now.facility !== startWallets + start.facility) throw new Error(`STOP ${label}: USDG not conserved`);
  if (now.investor < start.investor) throw new Error(`STOP ${label}: investor ended below starting balance`);
  if (now.facility !== 0n) throw new Error(`STOP ${label}: facility still holds ${now.facility}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(shotDir, { recursive: true });

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

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "smoke");
await page.setViewport({ width: 1440, height: 900 });
await page.emulateTimezone(process.env.SMOKE_TZ ?? "Asia/Jakarta");
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
  const info = { uuid: "5f1c2a2e-0000-4000-8000-000000000001", name: "Demo Wallet", icon: "data:image/svg+xml,", rdns: "xyz.dimsky.demo" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

let step = 0;
async function shot(name) {
  step += 1;
  await sleep(1_500);
  const file = `${shotDir}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`shot ${file}`);
}

async function until(check, what, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(check.fn, check.arg)) return;
    await sleep(1_000);
  }
  throw new Error(`timed out: ${what}`);
}

const hasText = (text) => ({ fn: (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), arg: text });
const buttonReady = (text) => ({ fn: (t) => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === t && !b.disabled), arg: text });

async function clickPrefix(prefix, timeout) {
  await until({ fn: (p) => [...document.querySelectorAll("button")].some((b) => b.innerText.trim().startsWith(p) && !b.disabled), arg: prefix }, `button "${prefix}"`, timeout);
  await page.evaluate((p) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith(p) && !b.disabled).click(), prefix);
  console.log(`click ${prefix}`);
}

async function latestFacility() {
  const all = await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "allFacilities" });
  return all[all.length - 1];
}

async function checkDrawdownAfterDue(facility) {
  const due = await publicClient.readContract({ address: facility, abi: facilityAbi, functionName: "dueAt" });
  while (BigInt(Math.floor(Date.now() / 1000)) <= due + 3n) await sleep(1_000);
  const status = await publicClient.readContract({ address: facility, abi: facilityAbi, functionName: "status" });
  try {
    await publicClient.simulateContract({ address: facility, abi: facilityAbi, functionName: "drawdown", args: [1n], account: wallets.originator.address });
    console.log(`drawdown after due: NOT REJECTED (status ${status})`);
  } catch (error) {
    console.log(`drawdown after due rejected (status ${status}): ${String(error.shortMessage ?? error.message).split("\n")[0]}`);
  }
  if (status === 0) {
    const client = createWalletClient({ account: wallets.risk, chain: sepolia, transport });
    const hash = await client.writeContract({ address: facility, abi: facilityAbi, functionName: "markLate" });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`markLate ${hash}`);
  }
}

async function waitForText(text, timeout) { await until(hasText(text), `text "${text}"`, timeout); }

async function click(text, timeout) {
  await until(buttonReady(text), `button "${text}"`, timeout);
  await page.evaluate((t) => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === t && !b.disabled).click(), text);
  console.log(`click ${text}`);
}

async function clickCard(selector, name) {
  await until({ fn: ([s, n]) => [...document.querySelectorAll(s)].some((c) => c.innerText.includes(n)), arg: [selector, name] }, `card ${name}`);
  await page.evaluate(([s, n]) => [...document.querySelectorAll(s)].find((c) => c.innerText.includes(n)).click(), [selector, name]);
  console.log(`open ${name}`);
}

async function fill(labelText, value) {
  await page.evaluate(([labelText, value]) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(labelText));
    const input = label?.querySelector("input, textarea");
    if (!input) throw new Error(`no input under ${labelText}`);
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [labelText, value]);
}

async function actAs(role, workspace) {
  current = wallets[role];
  await page.evaluate((address) => window.__emitWallet("accountsChanged", [address]), current.address);
  await waitForText(current.address.slice(0, 6));
  if (workspace) {
    const already = await page.evaluate((w) => document.querySelector(".workspace-current")?.innerText.trim() === w, workspace);
    if (!already) {
      await click("Switch role");
      await page.evaluate((w) => [...document.querySelectorAll('[role="menuitemradio"]')].find((b) => b.innerText.includes(w)).click(), workspace);
    }
  }
  console.log(`as ${role} ${current.address}`);
}

async function go(label) {
  await page.evaluate((l) => [...document.querySelectorAll(".side-nav button")].find((b) => b.innerText.trim() === l).click(), label);
  await sleep(1_000);
}

async function openFacility(tag, terms) {
  await actAs("originator", "Originator");
  await go("Open a facility");
  await waitForText("Facility terms");
  await fill("Credit limit", terms.limit);
  await fill("First-loss stake", terms.firstLoss);
  await fill("Financing fee", terms.fee);
  await fill("Duration", terms.duration);
  await fill("Grace before default", terms.grace);
  const name = await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.innerText.startsWith("Facility name")).querySelector("input").value);
  await shot(`${tag}-terms`);
  await clickPrefix("Approve ");
  await click("Clone facility and lock first-loss");
  await waitForText("Listed in Markets");
  await shot(`${tag}-listed`);
  return name;
}

async function supply(tag, name, amount) {
  await actAs("investor", "Capital provider");
  await go("Markets");
  await clickCard(".market-card", name);
  await waitForText("Review supply");
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith("Amount")).querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fill("Amount", amount);
  await shot(`${tag}-market`);
  await click("Review supply");
  await page.evaluate(() => document.querySelectorAll('.review-check input[type="checkbox"]').forEach((box) => box.checked || box.click()));
  await clickPrefix("Approve ");
  await click("Supply capital");
  await waitForText("Position created");
  await shot(`${tag}-supplied`);
  await click("View portfolio");
  await waitForText(name);
}

async function manage(name) {
  await actAs("originator", "Originator");
  await go("My facilities");
  await clickCard(".facility-row", name);
  await waitForText("Lifecycle");
}

async function draw(tag, name) {
  await manage(name);
  await click("Review drawdown");
  await click("Draw liquidity");
  await waitForText("Repay facility");
  await shot(`${tag}-drawn`);
}

async function claim(tag, name) {
  await actAs("investor", "Capital provider");
  await go("Portfolio");
  await until({ fn: (n) => [...document.querySelectorAll(".table-row")].some((r) => r.innerText.includes(n) && r.innerText.includes("Claim")), arg: name }, `claim ready on ${name}`);
  await shot(`${tag}-claimable`);
  await page.evaluate((n) => [...document.querySelectorAll(".table-row")].find((r) => r.innerText.includes(n)).querySelector("button").click(), name);
  await until({ fn: (n) => ![...document.querySelectorAll(".table-row")].some((r) => r.innerText.includes(n)), arg: name }, `position closed on ${name}`);
  await shot(`${tag}-claimed`);
}

const start = await snapshot("start");
console.log(`investor ${wallets.investor.address}`);
console.log(`originator ${wallets.originator.address}`);
console.log(`risk agent ${wallets.risk.address}`);
await page.goto(url, { waitUntil: "networkidle2" });
await shot("landing");
await click("Explore markets");
await sleep(2_000);
if (await page.evaluate(buttonReady("Connect wallet").fn, "Connect wallet")) await click("Connect wallet");
await actAs("originator");

if (paths.includes("repaid")) {
  const name = await openFacility("a", { limit: "10", firstLoss: "3", fee: "5", duration: "2", grace: "1" });
  await supply("a", name, "6");
  await draw("a", name);
  await click("Review repayment");
  await click("Repay now");
  await waitForText("Facility complete");
  await shot("a-repaid");
  await claim("a", name);
  const afterA = await snapshot("after A");
  assertConserved(start, afterA, "path A");
}

if (paths.includes("default")) {
  const name = await openFacility("b", { limit: "10", firstLoss: "3", fee: "5", duration: "2", grace: "1" });
  await supply("b", name, "6");
  await draw("b", name);
  await checkDrawdownAfterDue(await latestFacility());
  await waitForText("Past due", 5 * 60_000);
  await shot("b-past-due");

  await actAs("risk");
  await page.evaluate(() => { location.hash = "ops"; });
  await page.reload({ waitUntil: "networkidle2" });
  await waitForText(current.address.slice(0, 6));
  await until({ fn: (n) => [...document.querySelectorAll(".card")].some((c) => c.innerText.includes(n)), arg: name }, "risk card");
  await page.evaluate((n) => {
    const card = [...document.querySelectorAll(".card")].find((c) => c.innerText.includes(n));
    const area = card.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(area, "Buyer missed payment; restructuring refused");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  await until({ fn: (n) => [...[...document.querySelectorAll(".card")].find((c) => c.innerText.includes(n)).querySelectorAll("button")].some((b) => b.innerText.trim() === "Declare default" && !b.disabled), arg: name }, "declare default enabled", 4 * 60_000);
  await shot("b-ops");
  await page.evaluate((n) => [...[...document.querySelectorAll(".card")].find((c) => c.innerText.includes(n)).querySelectorAll("button")].find((b) => b.innerText.trim() === "Declare default").click(), name);
  await until({ fn: (n) => [...document.querySelectorAll(".card")].find((c) => c.innerText.includes(n))?.innerText.includes("Defaulted"), arg: name }, "defaulted");
  await shot("b-defaulted");

  await page.evaluate(() => { location.hash = "facilities"; });
  await page.reload({ waitUntil: "networkidle2" });
  await actAs("originator", "Originator");
  await clickCard(".facility-row", name);
  await waitForText("Remit recoveries");
  await shot("b-remit");
  await click("Review");
  await click("Remit");
  await waitForText("Balance cleared");
  await shot("b-recovered");
  await claim("b", name);
  const afterB = await snapshot("after B");
  assertConserved(start, afterB, "path B");
}

await actAs("originator", "Originator");
await go("Activity");
await shot("ledger-originator");
await actAs("investor", "Capital provider");
await go("Activity");
await waitForText("Principal and return claimed", 90_000).catch(() => console.log("claim not indexed yet"));
await shot("ledger-investor");
process.exit(0);
