import { mkdirSync, readFileSync } from "node:fs";
import { getWindow } from "/home/dims/.local/lib/vpsbrowser/browser.mjs";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const target = process.env.CHAIN ?? "robinhood";
const chains = {
  robinhood: defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } } }),
  sepolia: defineChain({ id: 421614, name: "Arbitrum Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } } }),
};
const chain = chains[target];
const sepolia = chain;
const seed = JSON.parse(readFileSync(`${process.env.HOME}/.cache/claude-work/seed-${target}.json`, "utf8"));
const url = process.env.VERIFY_URL ?? "http://127.0.0.1:8051/";
const shotDir = process.env.VERIFY_SHOTS ?? `/home/dims/.cache/claude-work/verify-demo-${target}`;
const transport = http(chain.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain, transport });
const investor = privateKeyToAccount(process.env.DEMO_INVESTOR_PRIVATE_KEY);
const fresh = investor;
const originator = privateKeyToAccount(process.env.DEMO_ORIGINATOR_PRIVATE_KEY);
const facilityAbi = parseAbi(["function seniorAssets() view returns (uint256)", "function juniorAssets() view returns (uint256)", "function seniorShares(address) view returns (uint256)"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
mkdirSync(shotDir, { recursive: true });
console.log(`rantai ${target}, pemodal ${investor.address}`);

let current = fresh;
async function walletRequest(method, params) {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [current.address];
    case "eth_chainId":
      return "0x" + chain.id.toString(16);
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



const read = (address, functionName, args = []) => publicClient.readContract({ address, abi: facilityAbi, functionName, args });
const addressOf = (name) => seed.facilities.find((f) => f.name === name)?.address;
const kindOf = (kind) => seed.facilities.find((f) => f.kind === kind);
const openNames = seed.facilities.filter((f) => f.kind === "open").map((f) => f.name);
const BADGES = ["Seeking capital", "Funded", "Drawn", "Past due", "Late", "Repaid", "Settled", "Defaulted", "Recoveries in", "Closed at loss", "Active"];
const badgeOf = (pageText, name) => {
  const at = pageText.indexOf(name);
  if (at < 0) return null;
  const window = pageText.slice(at + name.length, at + name.length + 100);
  const hits = BADGES.map((badge) => [window.indexOf(badge), badge]).filter(([index]) => index >= 0).sort((a, b) => a[0] - b[0]);
  if (hits.length === 0) console.log(`snippet ${name}: ${JSON.stringify(window)}`);
  return hits.length ? hits[0][1] : "?";
};

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
  const alreadyConnected = await page.evaluate((prefix) => document.body.innerText.includes(prefix), investor.address.slice(0, 6));
  if (!alreadyConnected) {
    await clickPrefix("Connect wallet");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Demo Wallet|Injected|MetaMask/i.test(b.innerText))?.click());
  }
  await waitText(investor.address.slice(0, 6));
  await waitText("View market", 90_000);
  await sleep(4_000);
  const marketsText = await text();
  const network = chain.name;
  record(`jaringan aktif ${network}`, marketsText.includes(network), network);
  const present = openNames.filter((name) => marketsText.includes(name));
  record("Markets menampilkan tiga fasilitas Open demo", present.length === 3, present.join(" | "));
  const enabled = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /View market/i.test(b.innerText) && !b.disabled).length);
  record("tombol View market aktif tepat untuk fasilitas Open", enabled === 3, `${enabled} tombol aktif`);
  await shot("markets");

  const anchored = seed.facilities.find((f) => f.kind === "open");
  await openMarket(anchored.name);
  const detail = await text();
  record("fasilitas Open pertama berlabel Approved dan anchored", /digest matches onchain/i.test(detail), (detail.match(/Approved[^\n]*/i) ?? ["tanpa label"])[0]);
  await shot("market-detail");

  if (target === "robinhood" && !process.env.SKIP_SUPPLY) {
    const before = await read(anchored.address, "seniorAssets");
    await page.evaluate((t) => [...document.querySelectorAll('[role="radio"]')].find((b) => b.innerText.trim() === t)?.click(), "Senior");
    await fill("Amount", "0.5");
    await clickPrefix("Review supply");
    await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').forEach((box) => !box.checked && box.click()));
    await clickPrefix("Approve ");
    await clickPrefix("Supply capital", 120_000);
    await waitText("Position created", 120_000);
    await sleep(4_000);
    const after = await read(anchored.address, "seniorAssets");
    record("supply 0.5 USDG Senior tercatat on-chain", after - before === 500_000n, `seniorAssets ${before} -> ${after}`);
    await shot("supplied");
  }

  await actAs(originator, "Originator");
  await go("My facilities");
  await waitText("Credit limit", 90_000);
  await sleep(5_000);
  const mine = await text();
  for (const f of seed.facilities) {
    const badge = badgeOf(mine, f.name);
    const wanted = { open: ["Seeking capital", "Funded"], active: ["Drawn"], late: ["Past due"], recovered: ["Closed at loss", "Recoveries in", "Defaulted"], repaid: ["Settled", "Repaid"] }[f.kind];
    record(`daftar originator memuat ${f.kind}: ${f.name}`, badge !== null && wanted.includes(badge), `badge ${badge}`);
  }
  await shot("my-facilities");
} catch (error) {
  record("alur terhenti", false, String(error.message).slice(0, 220));
  await shot("error").catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`RINGKAS ${results.length - failed.length}/${results.length} lulus`);
process.exit(failed.length ? 1 : 0);
