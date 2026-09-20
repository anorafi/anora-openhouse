import { getWindow } from "/home/dims/.local/lib/vpsbrowser/browser.mjs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { defineChain } from "viem";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const url = process.env.SMOKE_URL ?? "https://openhouse.anora.finance/";
const shotDir = process.env.SMOKE_SHOTS ?? "/home/dims/.cache/claude-work/smoke";
const chain = process.env.SMOKE_CHAIN === "robinhood" ? robinhood : arbitrumSepolia;
const rpc = chain === robinhood ? robinhood.rpcUrls.default.http[0] : process.env.ARBITRUM_SEPOLIA_RPC;
const unit = BigInt(process.env.SMOKE_UNIT ?? (chain === robinhood ? "1" : "1000"));
const amount = (n) => (BigInt(n) * unit).toString();
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const transport = http(rpc);
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ account, chain, transport });
const chainIdHex = "0x" + chain.id.toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function walletRequest(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return chainIdHex;
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "eth_sendTransaction": {
      const tx = params[0];
      return walletClient.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    }
    case "personal_sign":
      return account.signMessage({ message: { raw: params[0] } });
    default:
      return publicClient.request({ method, params });
  }
}

const { page } = await getWindow(process.env.VBROWSER_AGENT ?? "smoke");
await page.exposeFunction("__walletRequest", async (method, params) => {
  const result = await walletRequest(method, params);
  return JSON.parse(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? "0x" + v.toString(16) : v)));
});
await page.evaluateOnNewDocument(() => {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    request: ({ method, params }) => window.__walletRequest(method, params ?? []),
    on: (e, fn) => ((listeners[e] ??= []).push(fn), provider),
    removeListener: (e, fn) => ((listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn)), provider),
  };
  window.ethereum = provider;
  const info = { uuid: "5f1c2a2e-0000-4000-8000-000000000001", name: "Smoke Wallet", icon: "data:image/svg+xml,", rdns: "xyz.dimsky.smoke" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

let step = 0;
async function shot(name) {
  step += 1;
  const file = `${shotDir}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`shot ${file}`);
}

async function clickButton(text, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate((t) => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === t && !b.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    }, text);
    if (clicked) {
      console.log(`click ${text}`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`button not clickable: ${text}`);
}

async function waitForButton(text, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate((t) => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === t && !b.disabled), text);
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`button never enabled: ${text}`);
}

async function waitForText(text, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text)) return;
    await sleep(500);
  }
  throw new Error(`text never appeared: ${text}`);
}

async function setInput(selector, value, { index = 0 } = {}) {
  await page.evaluate(
    ({ selector, value, index }) => {
      const el = document.querySelectorAll(selector)[index];
      if (!el) throw new Error(`no element ${selector}[${index}]`);
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value, index },
  );
}

async function setLabeledInput(labelText, value) {
  await page.evaluate(
    ({ labelText, value }) => {
      const label = [...document.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(labelText));
      const el = label?.querySelector("input");
      if (!el) throw new Error(`no input under label ${labelText}`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { labelText, value },
  );
}

async function setSelect(index, value) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await page.evaluate((i) => document.querySelectorAll("select").length > i, index)) break;
    await sleep(500);
  }
  await page.evaluate(
    ({ index, value }) => {
      const el = document.querySelectorAll("select")[index];
      if (!el) throw new Error(`no select at index ${index}`);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { index, value },
  );
}

async function checkAllBoxes() {
  await page.evaluate(() => {
    document.querySelectorAll('.review-check input[type="checkbox"]').forEach((el) => {
      if (!el.checked) el.click();
    });
  });
}

async function waitForCard(cardText, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(
      (t) => [...document.querySelectorAll(".card, .market-card")].some((c) => c.innerText.includes(t)),
      cardText,
    );
    if (ok) return;
    await sleep(1_000);
  }
  throw new Error(`card never appeared: ${cardText}`);
}

async function scopedClick(cardText, buttonText, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(
      ({ cardText, buttonText }) => {
        const card = [...document.querySelectorAll(".card, .market-card")].find((c) => c.innerText.includes(cardText));
        if (!card) return false;
        const btn = [...card.querySelectorAll("button")].find((b) => b.innerText.trim() === buttonText && !b.disabled);
        if (!btn) return false;
        btn.click();
        return true;
      },
      { cardText, buttonText },
    );
    if (clicked) {
      console.log(`click [${cardText}] ${buttonText}`);
      return;
    }
    await sleep(500);
  }
  throw new Error(`button not clickable in card "${cardText}": ${buttonText}`);
}

async function scopedHasEnabledButton(cardText, buttonText) {
  return page.evaluate(
    ({ cardText, buttonText }) => {
      const card = [...document.querySelectorAll(".card, .market-card")].find((c) => c.innerText.includes(cardText));
      if (!card) return false;
      return [...card.querySelectorAll("button")].some((b) => b.innerText.trim() === buttonText && !b.disabled);
    },
    { cardText, buttonText },
  );
}

async function scopedWaitForButton(cardText, buttonText, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await scopedHasEnabledButton(cardText, buttonText)) return;
    await sleep(2_000);
  }
  throw new Error(`button never enabled in card "${cardText}": ${buttonText}`);
}

async function scopedWaitUntilGone(cardText, text, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const stillThere = await page.evaluate(
      ({ cardText, text }) => {
        const card = [...document.querySelectorAll(".card, .market-card")].find((c) => c.innerText.includes(cardText));
        return !!card && card.innerText.includes(text);
      },
      { cardText, text },
    );
    if (!stillThere) return;
    await sleep(1_000);
  }
  throw new Error(`text never left card "${cardText}": ${text}`);
}

async function scopedWaitForText(cardText, text, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(
      ({ cardText, text }) => {
        const card = [...document.querySelectorAll(".card, .market-card")].find((c) => c.innerText.includes(cardText));
        return !!card && card.innerText.toLowerCase().includes(text.toLowerCase());
      },
      { cardText, text },
    );
    if (ok) return;
    await sleep(1_000);
  }
  throw new Error(`text never appeared in card "${cardText}": ${text}`);
}

async function scopedSetInput(cardText, selector, value) {
  await page.evaluate(
    ({ cardText, selector, value }) => {
      const card = [...document.querySelectorAll(".card, .market-card")].find((c) => c.innerText.includes(cardText));
      if (!card) throw new Error(`card not found: ${cardText}`);
      const el = card.querySelector(selector);
      if (!el) throw new Error(`no element ${selector} in card ${cardText}`);
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { cardText, selector, value },
  );
}

async function pageText() {
  return page.evaluate(() => document.body.innerText);
}

const fmt = (n) => Number(amount(n)).toLocaleString("en-US");
const tenorMinutes = Number(process.env.SMOKE_TENOR_MIN ?? "2");
const graceMinutes = Number(process.env.SMOKE_GRACE_MIN ?? "1");
const facilityName = process.env.SMOKE_RESUME || `Smoke ${Date.now()}`;

console.log(`wallet ${account.address}`);
console.log(`facility ${facilityName}`);
await page.goto(url, { waitUntil: "networkidle2" });
await shot("landing");

const alreadyConnected = await page.evaluate((prefix) => document.body.innerText.includes(prefix), account.address.slice(0, 6));
if (!alreadyConnected) await clickButton("Connect wallet");
await waitForText(account.address.slice(0, 6));
await shot("connected");

const resuming = !!process.env.SMOKE_RESUME;
const from = process.env.SMOKE_FROM ?? (resuming ? "default" : "start");

if (from === "start") {
  await clickButton("Originate");
  await waitForText("New facility");

  if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Get test USDC (100,000)"))) {
    await clickButton("Get test USDC (100,000)");
    await waitForButton("Get test USDC (100,000)");
  }
  await shot("funded");

  await setLabeledInput("Name", facilityName);
  await setLabeledInput("Credit limit", amount(20));
  await setLabeledInput("First-loss stake", amount(2));
  await setLabeledInput("Tenor", String(tenorMinutes));
  await setLabeledInput("Grace period", String(graceMinutes));
  await setLabeledInput("Capital cap", amount(1000));
  const needsStakeApproval = await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Approve first-loss stake" && !b.disabled),
  );
  if (needsStakeApproval) {
    await clickButton("Approve first-loss stake");
    await waitForButton("Open facility");
  }
  await clickButton("Open facility");
  await waitForCard(facilityName);
  await shot("facility-opened");

  await scopedClick(facilityName, "View →");
  await waitForText(facilityName);
  const facilityHash = await page.evaluate(() => location.hash);
  await checkAllBoxes();

  await setSelect(0, "Junior");
  await setInput('input[placeholder^="Amount"]', amount(10));
  if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Approve" && !b.disabled))) {
    await clickButton("Approve");
    await waitForButton("Deposit");
  }
  await clickButton("Deposit");
  await waitForText("Capital supplied successfully.");
  await shot("junior-deposited");

  await page.evaluate((h) => { location.hash = h; }, facilityHash);
  await waitForText(facilityName);
  await checkAllBoxes();
  await setSelect(0, "Senior");
  await setInput('input[placeholder^="Amount"]', amount(20));
  await clickButton("Deposit");
  await waitForText("Capital supplied successfully.");
  await shot("senior-deposited");
}

if (from === "start" || from === "drawdown") {
  await clickButton("Originate");
  await waitForCard(facilityName);
  await scopedSetInput(facilityName, 'input[placeholder="Drawdown amount"]', amount(15));
  await scopedClick(facilityName, "Drawdown");
  await scopedWaitUntilGone(facilityName, "Owed (live): 0 ");
  await shot("drawn");

  await clickButton("Risk");
  await waitForCard(facilityName);
  await scopedWaitForButton(facilityName, "Mark late", { timeout: (tenorMinutes + 2) * 60_000 });
  await shot("past-due");

  await scopedClick(facilityName, "Mark late");
  await scopedWaitForText(facilityName, "Late");
  await shot("marked-late");
} else {
  await clickButton("Risk");
  await waitForCard(facilityName);
}

await scopedSetInput(facilityName, 'textarea[placeholder="Default reason"]', "buyer failed to pay; restructuring refused");
await scopedWaitForButton(facilityName, "Declare default", { timeout: (graceMinutes + 2) * 60_000 });
await scopedClick(facilityName, "Declare default");
await scopedWaitForText(facilityName, "Defaulted");
await shot("defaulted");

const needsRecoveryApproval = await scopedHasEnabledButton(facilityName, "Approve");
await scopedSetInput(facilityName, 'input[placeholder="Recovery amount"]', amount(Number(process.env.SMOKE_RECOVERY ?? "15")));
if (needsRecoveryApproval) {
  await scopedClick(facilityName, "Approve");
  await scopedWaitForButton(facilityName, "Record recovery");
}
await scopedClick(facilityName, "Record recovery");
await scopedWaitForText(facilityName, "first-loss 0", { timeout: 60_000 }).catch(() => {});
await sleep(6_000);
await shot("recovered");

if (process.env.SMOKE_WITHDRAW !== "0") {
  await clickButton("Originate");
  await waitForCard(facilityName);
  await scopedClick(facilityName, "View →");
  await waitForText(facilityName);

  for (const tranche of ["Senior", "Junior"]) {
    const shares = await page.evaluate((t) => {
      const m = document.body.innerText.match(new RegExp(`${t} ([\\d,\\.]+)`));
      return m ? m[1].replace(/,/g, "") : "0";
    }, tranche);
    if (shares === "0") continue;
    await setSelect(1, tranche);
    await setInput('input[placeholder^="Shares"]', shares);
    await clickButton("Withdraw");
    await waitForButton("Withdraw", { timeout: 90_000 }).catch(() => {});
    await sleep(3_000);
  }
  await shot("withdrawn");
}

console.log("---- final page text ----");
console.log(await pageText());
process.exit(0);
