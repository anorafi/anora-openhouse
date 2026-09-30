type Id = string | number | null;

interface Call {
  id: Id;
  method: string;
  params: unknown;
}

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

type Outcome = { result: unknown } | { error: RpcError };

export interface RpcReply {
  status: number;
  body: unknown;
}

export interface RpcProxyOptions {
  upstreams: (chainId: number) => string[] | undefined;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;
  now: () => number;
  timeoutMs?: number;
  maxBatch?: number;
  maxLogRange?: bigint;
  maxEntries?: number;
  onFailure?: (info: { chainId: number; host: string; reason: string; methods: string[] }) => void;
}

const ALLOWED = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getBalance",
  "eth_getCode",
  "eth_getLogs",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_sendRawTransaction",
  "net_version",
]);

const UNSHARED = new Set(["eth_sendRawTransaction", "eth_getTransactionCount"]);
const FACT_METHODS = new Set(["eth_chainId", "net_version", "eth_getCode"]);
const SHORT_METHODS = new Set(["eth_call", "eth_getBalance", "eth_blockNumber", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_estimateGas"]);
const SETTLED_METHODS = new Set(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);

const SHORT_MS = 3_000;
const LOGS_MS = 5_000;
const FACT_MS = 3_600_000;
const SETTLED_MS = 60_000;
const NON_HEX_TAGS = new Set(["latest", "pending", "safe", "finalized"]);

const failure = (code: number, message: string): Outcome => ({ error: { code, message } });
const UNAVAILABLE: RpcError = { code: -32000, message: "RPC_UNAVAILABLE: no upstream node answered." };
const unavailable: Outcome = { error: UNAVAILABLE };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCall(value: unknown): Call | null {
  if (!isRecord(value)) return null;
  if (typeof value.method !== "string") return null;
  const id = value.id;
  if (id !== null && typeof id !== "string" && typeof id !== "number") return null;
  return { id, method: value.method, params: value.params };
}

function hexNumber(value: unknown): bigint | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? BigInt(value) : null;
}

function logsWithinRange(params: unknown, maxRange: bigint): boolean {
  const filter = Array.isArray(params) ? params[0] : undefined;
  if (!isRecord(filter)) return false;
  if (filter.blockHash !== undefined) return true;
  const from = filter.fromBlock ?? "latest";
  const to = filter.toBlock ?? "latest";
  const fromTag = typeof from === "string" && NON_HEX_TAGS.has(from);
  const toTag = typeof to === "string" && NON_HEX_TAGS.has(to);
  if (fromTag && toTag) return true;
  const fromNumber = hexNumber(from);
  const toNumber = hexNumber(to);
  if (fromNumber === null || toNumber === null) return false;
  return toNumber >= fromNumber && toNumber - fromNumber <= maxRange;
}

function ttlOf(call: Call): number {
  if (FACT_METHODS.has(call.method)) return FACT_MS;
  if (SHORT_METHODS.has(call.method)) return SHORT_MS;
  if (SETTLED_METHODS.has(call.method)) return SETTLED_MS;
  if (call.method === "eth_getLogs") {
    const filter = Array.isArray(call.params) ? call.params[0] : undefined;
    return isRecord(filter) && filter.blockHash !== undefined ? SETTLED_MS : LOGS_MS;
  }
  if (call.method === "eth_getBlockByNumber") {
    const tag = Array.isArray(call.params) ? call.params[0] : undefined;
    return hexNumber(tag) !== null ? SETTLED_MS : SHORT_MS;
  }
  return 0;
}

function cacheable(call: Call, outcome: Outcome): boolean {
  if (!("result" in outcome)) return false;
  if (SETTLED_METHODS.has(call.method) && outcome.result === null) return false;
  return true;
}

export function createRpcProxy(options: RpcProxyOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBatch = options.maxBatch ?? 100;
  const maxLogRange = options.maxLogRange ?? 10_000n;
  const maxEntries = options.maxEntries ?? 2_000;
  const cache = new Map<string, { expires: number; outcome: Outcome }>();
  const inflight = new Map<string, Promise<Outcome>>();

  const remember = (key: string, outcome: Outcome, ttl: number) => {
    const now = options.now();
    if (cache.size >= maxEntries) {
      for (const [entry, value] of cache) if (value.expires <= now) cache.delete(entry);
      for (const entry of cache.keys()) {
        if (cache.size < maxEntries) break;
        cache.delete(entry);
      }
    }
    cache.set(key, { expires: now + ttl, outcome });
  };

  async function forward(chainId: number, urls: string[], calls: Call[]): Promise<Outcome[]> {
    const single = calls.length === 1;
    const payload = single
      ? { jsonrpc: "2.0", id: 0, method: calls[0].method, params: calls[0].params ?? [] }
      : calls.map((call, index) => ({ jsonrpc: "2.0", id: index, method: call.method, params: call.params ?? [] }));
    const body = JSON.stringify(payload);
    const methods = calls.map((call) => call.method);
    for (const url of urls) {
      const report = (reason: string) => options.onFailure?.({ chainId, host: new URL(url).host, reason, methods });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await options.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal });
        if (!response.ok) {
          report(`status ${response.status}`);
          continue;
        }
        const parsed = (await response.json()) as unknown;
        const list = single ? [parsed] : Array.isArray(parsed) ? parsed : null;
        if (!list || list.length !== calls.length) {
          report("malformed answer");
          continue;
        }
        const outcomes: (Outcome | undefined)[] = new Array(calls.length).fill(undefined);
        for (const entry of list) {
          if (!isRecord(entry)) continue;
          const index = single ? 0 : Number(entry.id);
          if (!Number.isInteger(index) || index < 0 || index >= calls.length) continue;
          if (isRecord(entry.error) && typeof entry.error.code === "number" && typeof entry.error.message === "string") {
            outcomes[index] = { error: entry.error as unknown as RpcError };
          } else if ("result" in entry) {
            outcomes[index] = { result: entry.result };
          }
        }
        if (outcomes.every((outcome) => outcome !== undefined)) return outcomes as Outcome[];
        report("malformed answer");
      } catch (error) {
        const aborted = controller.signal.aborted;
        const text = String((error as Error)?.message ?? error).split("\n")[0].replaceAll(url, "").replace(/https?:\/\/\S+/g, "");
        report(aborted ? "timeout" : `network: ${text.trim()}`);
        continue;
      } finally {
        clearTimeout(timer);
      }
    }
    return calls.map(() => unavailable);
  }

  async function handle(chainId: number, payload: unknown): Promise<RpcReply> {
    const urls = options.upstreams(chainId);
    if (!urls || urls.length === 0) return { status: 404, body: { jsonrpc: "2.0", id: null, error: { code: -32000, message: `Chain ${chainId} is not proxied.` } } };

    const batch = Array.isArray(payload);
    const raw = batch ? payload : [payload];
    if (raw.length === 0 || raw.length > maxBatch) return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } } };
    const calls: Call[] = [];
    for (const entry of raw) {
      const call = parseCall(entry);
      if (!call) return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } } };
      calls.push(call);
    }

    const promises: Promise<Outcome>[] = [];
    const fresh: { call: Call; key: string | null; resolve: (outcome: Outcome) => void }[] = [];
    const now = options.now();

    for (const call of calls) {
      if (!ALLOWED.has(call.method)) {
        promises.push(Promise.resolve(failure(-32601, "Method not allowed.")));
        continue;
      }
      if (call.method === "eth_getLogs" && !logsWithinRange(call.params, maxLogRange)) {
        promises.push(Promise.resolve(failure(-32602, "Log range is too wide or open-ended.")));
        continue;
      }
      const shared = !UNSHARED.has(call.method);
      const key = shared ? `${chainId}:${call.method}:${JSON.stringify(call.params ?? [])}` : null;
      if (key) {
        const hit = cache.get(key);
        if (hit && hit.expires > now) {
          promises.push(Promise.resolve(hit.outcome));
          continue;
        }
        const joined = inflight.get(key);
        if (joined) {
          promises.push(joined);
          continue;
        }
      }
      let resolve: (outcome: Outcome) => void = () => {};
      const promise = new Promise<Outcome>((done) => (resolve = done));
      if (key) inflight.set(key, promise);
      fresh.push({ call, key, resolve });
      promises.push(promise);
    }

    if (fresh.length > 0) {
      void (async () => {
        let outcomes: Outcome[];
        try {
          outcomes = await forward(chainId, urls, fresh.map((entry) => entry.call));
        } catch {
          outcomes = fresh.map(() => unavailable);
        }
        fresh.forEach((entry, index) => {
          const outcome = outcomes[index] ?? unavailable;
          if (entry.key) {
            inflight.delete(entry.key);
            const ttl = ttlOf(entry.call);
            if (ttl > 0 && cacheable(entry.call, outcome)) remember(entry.key, outcome, ttl);
          }
          entry.resolve(outcome);
        });
      })();
    }

    const outcomes = await Promise.all(promises);
    const replies = calls.map((call, index) => ({ jsonrpc: "2.0", id: call.id, ...outcomes[index] }));
    const down = outcomes.some((outcome) => "error" in outcome && outcome.error === UNAVAILABLE);
    return { status: down ? 503 : 200, body: batch ? replies : replies[0] };
  }

  return { handle };
}
