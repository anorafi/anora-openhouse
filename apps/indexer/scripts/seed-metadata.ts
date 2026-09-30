import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { AnoraFacilityAbi } from "../../web/src/abi/AnoraFacility";

const api = process.env.SEED_API ?? "https://anora-api.dimsky.xyz";
const rpc = process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc";
const chainId = arbitrumSepolia.id;
const originator = privateKeyToAccount(process.env.DEMO_ORIGINATOR_PRIVATE_KEY as Hex);
const reviewer = privateKeyToAccount(process.env.RISK_AGENT_PRIVATE_KEY as Hex);
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: originator, chain: arbitrumSepolia, transport: http(rpc) });

const SAMPLES = [
  { company: "Sumatra Coffee Traders Ltd", route: "Indonesia to Japan", financingType: "Export receivables", operatingHistoryYears: 12, verifiedAssets: 31, buyerConcentrationPct: 38, documentCoverage: 1.24 },
  { company: "Kochi Spice Exports Pvt", route: "India to United Arab Emirates", financingType: "Supply-chain finance", operatingHistoryYears: 7, verifiedAssets: 18, buyerConcentrationPct: 52, documentCoverage: 1.09 },
];

async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${api}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${JSON.stringify(body.error ?? body)}`);
  return body as Record<string, any>;
}

async function login(account: typeof originator): Promise<string> {
  const issued = await call("/v1/auth/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address, chainId }) });
  const signature = await account.signMessage({ message: issued.message });
  const opened = await call("/v1/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: issued.message, signature }) });
  return opened.token;
}

const post = (path: string, token: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

function samplePdf(title: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n%${title}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
}

async function upload(token: string, path: string, name: string, visibility: "public" | "restricted") {
  const bytes = samplePdf(name);
  const slot = await post(`${path}/documents/upload-url`, token, { name, mime: "application/pdf", size: bytes.length, visibility });
  const stored = await call(slot.uploadUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: bytes });
  return stored;
}

const listed = (name: string) => (process.env[name] ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
const withoutAnchor = new Set(listed("SEED_SKIP_ANCHOR"));
const facilities: string[] = listed("SEED_FACILITIES").length
  ? listed("SEED_FACILITIES")
  : ((await call(`/v1/facilities?chainId=${chainId}`)).items as { address: string; originator: string }[])
      .filter((item) => item.originator.toLowerCase() === originator.address.toLowerCase())
      .map((item) => item.address)
      .slice(0, SAMPLES.length);

const originatorToken = await login(originator);
const reviewerToken = await login(reviewer);

for (const [index, facility] of facilities.entries()) {
  const path = `/v1/facilities/${chainId}/${facility}`;
  const draft = await post(`${path}/metadata/versions`, originatorToken, SAMPLES[index]);
  const approval = await post(`${path}/underwriting/approve`, reviewerToken, { version: draft.version, grade: index === 0 ? "A" : "B+", note: "Sample review for the Arbitrum Sepolia demo." });
  let hash: Hex | null = null;
  if (!withoutAnchor.has(facility.toLowerCase())) {
    hash = await wallet.writeContract({ address: facility as Hex, abi: AnoraFacilityAbi, functionName: "attachEvidence", args: [approval.digest as Hex] });
    await publicClient.waitForTransactionReceipt({ hash });
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (index === 0) {
    await upload(originatorToken, path, "invoice-sample.pdf", "public");
    await upload(originatorToken, path, "buyer-contract-sample.pdf", "restricted");
  }
  const read = await call(`${path}/metadata`);
  console.log(JSON.stringify({ facility, version: draft.version, digest: approval.digest, attachTx: hash, anchored: read.anchored }));
}
