import { describe, expect, it } from "bun:test";
import { createRpcProxy } from "./rpc";

type Call = { url: string; body: any };

function harness(script: (url: string, body: any, attempt: number) => Response | Promise<Response> | Error, urls = ["https://a.example/rpc", "https://b.example/rpc"]) {
  const calls: Call[] = [];
  const failures: { chainId: number; host: string; reason: string; methods: string[] }[] = [];
  let clock = 1_000_000;
  const proxy = createRpcProxy({
    upstreams: (chainId) => (chainId === 421614 ? urls : undefined),
    now: () => clock,
    onFailure: (info) => failures.push(info),
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      const outcome = await script(url, body, calls.length);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });
  return { proxy, calls, failures, tick: (ms: number) => (clock += ms) };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = (body: any, result: (call: any) => unknown = () => "0x1") => ok(Array.isArray(body) ? body.map((call) => ({ jsonrpc: "2.0", id: call.id, result: result(call) })) : { jsonrpc: "2.0", id: body.id, result: result(body) });
const rpc = (id: number, method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id, method, params });

describe("rpc proxy allowlist", () => {
  it("rejects methods outside the allowlist without calling upstream", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body));
    const out = await proxy.handle(421614, rpc(7, "debug_traceTransaction", ["0x1"]));
    expect(calls).toHaveLength(0);
    expect(out.body).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not allowed." } });
  });

  it("rejects an unknown chain", async () => {
    const { proxy } = harness((_u, body) => answer(body));
    const out = await proxy.handle(1, rpc(1, "eth_chainId"));
    expect(out.status).toBe(404);
  });

  it("rejects malformed payloads", async () => {
    const { proxy } = harness((_u, body) => answer(body));
    expect((await proxy.handle(421614, "nope")).status).toBe(400);
    expect((await proxy.handle(421614, { jsonrpc: "2.0", id: 1 })).status).toBe(400);
    expect((await proxy.handle(421614, [])).status).toBe(400);
  });

  it("rejects batches above the limit", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body));
    const out = await proxy.handle(421614, Array.from({ length: 101 }, (_, i) => rpc(i, "eth_chainId")));
    expect(out.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("rpc proxy forwarding", () => {
  it("returns the upstream result under the caller id", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => "0x12bb2bcb"));
    const out = await proxy.handle(421614, rpc(42, "eth_blockNumber"));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ jsonrpc: "2.0", id: 42, result: "0x12bb2bcb" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://a.example/rpc");
  });

  it("sends a batch as one upstream batch and keeps order and ids", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, (call) => `0x${call.id}`));
    const out = await proxy.handle(421614, [rpc(11, "eth_getBalance", ["0xa", "latest"]), rpc(12, "debug_x"), rpc(13, "eth_call", [{ to: "0xb" }, "latest"])]);
    expect(calls).toHaveLength(1);
    expect(Array.isArray(calls[0].body)).toBe(true);
    expect(calls[0].body).toHaveLength(2);
    const body = out.body as any[];
    expect(body.map((entry) => entry.id)).toEqual([11, 12, 13]);
    expect(body[1].error.code).toBe(-32601);
    expect(body[0].result).toBeDefined();
    expect(body[2].result).toBeDefined();
  });

  it("passes upstream json-rpc errors through without failing over or caching", async () => {
    let count = 0;
    const { proxy, calls } = harness((_u, body) => {
      count++;
      return ok({ jsonrpc: "2.0", id: body[0]?.id ?? body.id, error: { code: 3, message: "execution reverted", data: "0x08c379a0" } });
    });
    const first = await proxy.handle(421614, rpc(1, "eth_call", [{ to: "0xb" }, "latest"]));
    expect((first.body as any).error.code).toBe(3);
    await proxy.handle(421614, rpc(2, "eth_call", [{ to: "0xb" }, "latest"]));
    expect(count).toBe(2);
    expect(calls.every((call) => call.url === "https://a.example/rpc")).toBe(true);
  });
});

describe("rpc proxy cache", () => {
  it("serves identical reads from cache inside the ttl and refreshes after it", async () => {
    const { proxy, calls, tick } = harness((_u, body) => answer(body, () => "0x1"));
    const call = (id: number) => proxy.handle(421614, rpc(id, "eth_call", [{ to: "0xb", data: "0x01" }, "latest"]));
    const a = await call(1);
    tick(2_000);
    const b = await call(2);
    expect(calls).toHaveLength(1);
    expect((a.body as any).id).toBe(1);
    expect((b.body as any).id).toBe(2);
    tick(1_500);
    await call(3);
    expect(calls).toHaveLength(2);
  });

  it("keeps immutable chain facts for much longer", async () => {
    const { proxy, calls, tick } = harness((_u, body) => answer(body, () => "0x66eee"));
    await proxy.handle(421614, rpc(1, "eth_chainId"));
    tick(600_000);
    await proxy.handle(421614, rpc(2, "eth_chainId"));
    expect(calls).toHaveLength(1);
  });

  it("joins identical requests that are already in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { proxy, calls } = harness(async (_u, body) => {
      await gate;
      return answer(body);
    });
    const first = proxy.handle(421614, rpc(1, "eth_blockNumber"));
    const second = proxy.handle(421614, rpc(2, "eth_blockNumber"));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect((a.body as any).id).toBe(1);
    expect((b.body as any).id).toBe(2);
  });

  it("never caches or joins raw transaction submissions", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => "0xhash"));
    await proxy.handle(421614, rpc(1, "eth_sendRawTransaction", ["0xdead"]));
    await proxy.handle(421614, rpc(2, "eth_sendRawTransaction", ["0xdead"]));
    expect(calls).toHaveLength(2);
  });

  it("never caches the nonce", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => "0x5"));
    await proxy.handle(421614, rpc(1, "eth_getTransactionCount", ["0xa", "pending"]));
    await proxy.handle(421614, rpc(2, "eth_getTransactionCount", ["0xa", "pending"]));
    expect(calls).toHaveLength(2);
  });

  it("caches a mined receipt but not a pending one", async () => {
    let mined = false;
    const { proxy, calls } = harness((_u, body) => answer(body, () => (mined ? { status: "0x1" } : null)));
    await proxy.handle(421614, rpc(1, "eth_getTransactionReceipt", ["0xabc"]));
    await proxy.handle(421614, rpc(2, "eth_getTransactionReceipt", ["0xabc"]));
    expect(calls).toHaveLength(2);
    mined = true;
    await proxy.handle(421614, rpc(3, "eth_getTransactionReceipt", ["0xabc"]));
    await proxy.handle(421614, rpc(4, "eth_getTransactionReceipt", ["0xabc"]));
    expect(calls).toHaveLength(3);
  });
});

describe("rpc proxy failover", () => {
  it("falls back to the next upstream on 429", async () => {
    const { proxy, calls } = harness((url, body) => (url.startsWith("https://a.") ? ok({ error: "rate limited" }, 429) : answer(body, () => "0x9")));
    const out = await proxy.handle(421614, rpc(5, "eth_blockNumber"));
    expect((out.body as any).result).toBe("0x9");
    expect(calls.map((call) => call.url)).toEqual(["https://a.example/rpc", "https://b.example/rpc"]);
  });

  it("falls back on 5xx, network errors, and non-array batch answers", async () => {
    for (const first of [() => ok({}, 503), () => new Error("socket closed"), () => ok({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch unsupported" } })]) {
      const { proxy } = harness((url, body) => (url.startsWith("https://a.") ? first() : answer(body, () => "0x9")));
      const out = await proxy.handle(421614, [rpc(1, "eth_blockNumber"), rpc(2, "eth_chainId")]);
      expect((out.body as any[]).map((entry) => entry.result)).toEqual(["0x9", "0x9"]);
    }
  });

  it("answers 503 with a typed error when every upstream fails", async () => {
    const { proxy } = harness(() => ok({}, 500));
    const out = await proxy.handle(421614, [rpc(1, "eth_blockNumber"), rpc(2, "eth_chainId")]);
    expect(out.status).toBe(503);
    const body = out.body as any[];
    expect(body.map((entry) => entry.id)).toEqual([1, 2]);
    expect(body[0].error.message).toContain("RPC_UNAVAILABLE");
  });

  it("does not cache a failed read", async () => {
    let healthy = false;
    const { proxy, calls } = harness((_u, body) => (healthy ? answer(body, () => "0x1") : ok({}, 500)));
    await proxy.handle(421614, rpc(1, "eth_blockNumber"));
    healthy = true;
    const out = await proxy.handle(421614, rpc(2, "eth_blockNumber"));
    expect((out.body as any).result).toBe("0x1");
    expect(calls.length).toBeGreaterThan(2);
  });
});

describe("rpc proxy log ranges", () => {
  const logs = (from: string, to: string) => rpc(1, "eth_getLogs", [{ address: "0xa", fromBlock: from, toBlock: to }]);

  it("allows a bounded numeric range", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => []));
    const out = await proxy.handle(421614, logs("0x100", "0x1100"));
    expect((out.body as any).result).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("rejects a range wider than the limit", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => []));
    const out = await proxy.handle(421614, logs("0x1", "0x5000"));
    expect((out.body as any).error.code).toBe(-32602);
    expect(calls).toHaveLength(0);
  });

  it("rejects earliest and open-ended ranges", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => []));
    expect(((await proxy.handle(421614, logs("earliest", "latest"))).body as any).error.code).toBe(-32602);
    expect(((await proxy.handle(421614, logs("0x1", "latest"))).body as any).error.code).toBe(-32602);
    expect(calls).toHaveLength(0);
  });

  it("allows latest to latest and blockHash queries", async () => {
    const { proxy, calls } = harness((_u, body) => answer(body, () => []));
    await proxy.handle(421614, logs("latest", "latest"));
    await proxy.handle(421614, rpc(2, "eth_getLogs", [{ blockHash: "0xabc" }]));
    expect(calls).toHaveLength(2);
  });
});

describe("rpc proxy failure reports", () => {
  it("reports the host, the reason, and the methods without the url path", async () => {
    const { proxy, failures } = harness((url, body) => (url.startsWith("https://a.") ? ok({ error: "rate limited" }, 429) : answer(body)), ["https://a.example/v2/SECRETKEY", "https://b.example/rpc"]);
    await proxy.handle(421614, [rpc(1, "eth_blockNumber"), rpc(2, "eth_chainId")]);
    expect(failures).toEqual([{ chainId: 421614, host: "a.example", reason: "status 429", methods: ["eth_blockNumber", "eth_chainId"] }]);
    expect(JSON.stringify(failures)).not.toContain("SECRETKEY");
  });

  it("reports network errors, malformed answers, and short batches", async () => {
    const reasons: string[] = [];
    for (const first of [() => new Error("socket closed"), () => ok({ jsonrpc: "2.0", id: null }), () => ok([{ jsonrpc: "2.0", id: 0, result: "0x1" }])]) {
      const { proxy, failures } = harness((url, body) => (url.startsWith("https://a.") ? first() : answer(body)));
      await proxy.handle(421614, [rpc(1, "eth_blockNumber"), rpc(2, "eth_chainId")]);
      reasons.push(failures[0].reason);
    }
    expect(reasons).toEqual(["network: socket closed", "malformed answer", "malformed answer"]);
  });

  it("strips upstream urls from network error text", async () => {
    const { proxy, failures } = harness((url, body) => (url.startsWith("https://a.") ? new Error("fetch failed for https://a.example/v2/SECRETKEY") : answer(body)), ["https://a.example/v2/SECRETKEY", "https://b.example/rpc"]);
    await proxy.handle(421614, rpc(1, "eth_blockNumber"));
    expect(JSON.stringify(failures)).not.toContain("SECRETKEY");
  });
});
