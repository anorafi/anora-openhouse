import { createPublicClient, createWalletClient, fallback, http, isAddress, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface ApprovalsChain {
  isApproved(chainId: number, factory: Address, who: Address): Promise<boolean>;
  approve(chainId: number, factory: Address, who: Address): Promise<Hex>;
}

export interface SelfServeChain {
  chainId: number;
  factory: Address;
}

export interface ApprovalsDeps {
  chains: SelfServeChain[];
  ownerReady: boolean;
  now: () => number;
  chain: ApprovalsChain;
}

const PATH = "/v1/originator-approvals";
const PER_ADDRESS_MS = 60_000;

const factoryAbi = parseAbi(["function approvedOriginators(address) view returns (bool)", "function setOriginatorApproved(address originator, bool approved)"]);

function send(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const fail = (status: number, code: string, message: string, headers: Record<string, string> = {}) => send({ error: { code, message } }, status, headers);

export function createApprovalRoutes(deps: ApprovalsDeps) {
  const lastSent = new Map<string, number>();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  return async (request: Request, url: URL): Promise<Response | null> => {
    if (request.method !== "POST" || url.pathname.replace(/\/+$/, "") !== PATH) return null;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
      if (body === null || typeof body !== "object") throw new Error("not an object");
    } catch {
      return fail(400, "INVALID_REQUEST", "The request body must be a JSON object.");
    }
    const target = deps.chains.find((entry) => entry.chainId === body.chainId);
    if (!target) return fail(400, "CHAIN_NOT_SUPPORTED", "Self-serve originator approval is not available on this chain.");
    if (typeof body.address !== "string" || !isAddress(body.address)) return fail(400, "INVALID_ADDRESS", "Address must be a valid wallet address.");
    if (!deps.ownerReady) return fail(503, "OWNER_UNAVAILABLE", "The approval key is not configured.");
    const who = body.address as Address;
    const key = `${target.chainId}:${who.toLowerCase()}`;
    try {
      if (await deps.chain.isApproved(target.chainId, target.factory, who)) return send({ approved: true, alreadyApproved: true, tx: null });
    } catch {
      return fail(502, "APPROVAL_FAILED", "The approval status could not be read.");
    }
    const previous = lastSent.get(key);
    if (previous !== undefined && deps.now() - previous < PER_ADDRESS_MS) {
      return fail(429, "RATE_LIMITED", "This wallet was approved a moment ago. Try again shortly.", { "retry-after": String(Math.ceil((PER_ADDRESS_MS - (deps.now() - previous)) / 1000)) });
    }
    lastSent.set(key, deps.now());
    try {
      const tx = await serial(() => deps.chain.approve(target.chainId, target.factory, who));
      return send({ approved: true, alreadyApproved: false, tx });
    } catch {
      return fail(502, "APPROVAL_FAILED", "The approval transaction failed.");
    }
  };
}

export function createApprovalsChain(options: { ownerKey?: Hex; urls: Record<number, string[]> }): ApprovalsChain {
  const owner = () => {
    if (!options.ownerKey) throw new Error("The approval key is not configured.");
    return privateKeyToAccount(options.ownerKey);
  };
  const transport = (chainId: number) => {
    const urls = options.urls[chainId];
    if (!urls?.length) throw new Error(`No rpc url for chain ${chainId}.`);
    return fallback(urls.map((url) => http(url, { retryCount: 2, retryDelay: 400, timeout: 20_000 })));
  };
  return {
    async isApproved(chainId, factory, who) {
      const client = createPublicClient({ transport: transport(chainId) });
      return client.readContract({ address: factory, abi: factoryAbi, functionName: "approvedOriginators", args: [who] });
    },
    async approve(chainId, factory, who) {
      const wallet = createWalletClient({ account: owner(), transport: transport(chainId) });
      const client = createPublicClient({ transport: transport(chainId) });
      const hash = await wallet.writeContract({ address: factory, abi: factoryAbi, functionName: "setOriginatorApproved", args: [who, true], chain: null });
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error("Approval transaction reverted.");
      return hash;
    },
  };
}
