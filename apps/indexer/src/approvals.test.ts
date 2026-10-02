import { beforeEach, describe, expect, test } from "bun:test";
import { createApprovalRoutes, type ApprovalsChain } from "./approvals";

const CHAIN = 421614;
const FACTORY = "0x6D051e17Be86CC7e3f24AbAf1393028c5B800c83";
const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const TX = `0x${"ab".repeat(32)}` as const;

let approved: Set<string>;
let sent: string[];
let failing: boolean;
let time: number;
let routes: ReturnType<typeof createApprovalRoutes>;

const chain: ApprovalsChain = {
  isApproved: async (_chainId, _factory, who) => approved.has(who.toLowerCase()),
  approve: async (_chainId, _factory, who) => {
    if (failing) throw new Error("replacement transaction underpriced");
    sent.push(who.toLowerCase());
    approved.add(who.toLowerCase());
    return TX;
  },
};

const build = (ownerReady = true) =>
  createApprovalRoutes({ chains: [{ chainId: CHAIN, factory: FACTORY }], ownerReady, now: () => time, chain });

const post = async (body: unknown, path = "/v1/originator-approvals", method = "POST") => {
  const url = new URL(`http://127.0.0.1:8105${path}`);
  const response = await routes(new Request(url, { method, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), url);
  return response;
};
const json = async (response: Response | null) => (await response!.json()) as Record<string, any>;

beforeEach(() => {
  approved = new Set();
  sent = [];
  failing = false;
  time = 1_000_000;
  routes = build();
});

describe("originator approvals", () => {
  test("ignores paths and methods that are not the approval route", async () => {
    expect(await post({}, "/v1/health", "POST")).toBeNull();
    expect(await routes(new Request("http://127.0.0.1:8105/v1/originator-approvals"), new URL("http://127.0.0.1:8105/v1/originator-approvals"))).toBeNull();
  });

  test("approves a new wallet and returns the transaction", async () => {
    const response = await post({ chainId: CHAIN, address: WALLET });
    expect(response!.status).toBe(200);
    expect(await json(response)).toEqual({ approved: true, alreadyApproved: false, tx: TX });
    expect(sent).toEqual([WALLET.toLowerCase()]);
  });

  test("answers an approved wallet without sending a transaction", async () => {
    approved.add(WALLET.toLowerCase());
    const response = await post({ chainId: CHAIN, address: WALLET });
    expect(response!.status).toBe(200);
    expect(await json(response)).toEqual({ approved: true, alreadyApproved: true, tx: null });
    expect(sent).toEqual([]);
  });

  test("accepts a lowercase address and rejects a bad checksum", async () => {
    expect((await post({ chainId: CHAIN, address: WALLET.toLowerCase() }))!.status).toBe(200);
    const flip = (value: string) => value.replace(/[a-fA-F]/, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    const response = await post({ chainId: CHAIN, address: flip(OTHER) });
    expect(response!.status).toBe(400);
    expect((await json(response)).error.code).toBe("INVALID_ADDRESS");
  });

  test("rejects malformed addresses and bodies", async () => {
    for (const body of [{ chainId: CHAIN, address: "0x123" }, { chainId: CHAIN }, { chainId: CHAIN, address: 7 }]) {
      const response = await post(body);
      expect(response!.status).toBe(400);
      expect((await json(response)).error.code).toBe("INVALID_ADDRESS");
    }
    const broken = await post("not json");
    expect(broken!.status).toBe(400);
    expect((await json(broken)).error.code).toBe("INVALID_REQUEST");
  });

  test("refuses every chain that is not self serve", async () => {
    for (const chainId of [4663, 1, "421614", undefined]) {
      const response = await post({ chainId, address: WALLET });
      expect(response!.status).toBe(400);
      expect((await json(response)).error.code).toBe("CHAIN_NOT_SUPPORTED");
    }
    expect(sent).toEqual([]);
  });

  test("allows one approval transaction per address per minute", async () => {
    failing = true;
    expect((await post({ chainId: CHAIN, address: WALLET }))!.status).toBe(502);
    failing = false;
    const limited = await post({ chainId: CHAIN, address: WALLET });
    expect(limited!.status).toBe(429);
    expect((await json(limited)).error.code).toBe("RATE_LIMITED");
    expect(limited!.headers.get("retry-after")).toBe("60");
    time += 60_000;
    expect((await post({ chainId: CHAIN, address: WALLET }))!.status).toBe(200);
  });

  test("reports a failed transaction as approval failed", async () => {
    failing = true;
    const response = await post({ chainId: CHAIN, address: WALLET });
    expect(response!.status).toBe(502);
    expect((await json(response)).error.code).toBe("APPROVAL_FAILED");
    expect(sent).toEqual([]);
  });

  test("reports a missing owner key without touching the chain", async () => {
    routes = build(false);
    const response = await post({ chainId: CHAIN, address: WALLET });
    expect(response!.status).toBe(503);
    expect((await json(response)).error.code).toBe("OWNER_UNAVAILABLE");
    expect(sent).toEqual([]);
  });

  test("sends concurrent approvals one at a time", async () => {
    let active = 0;
    let peak = 0;
    const slow: ApprovalsChain = {
      isApproved: async () => false,
      approve: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return TX;
      },
    };
    routes = createApprovalRoutes({ chains: [{ chainId: CHAIN, factory: FACTORY }], ownerReady: true, now: () => time, chain: slow });
    const replies = await Promise.all([WALLET, OTHER, "0x90F79bf6EB2c4f870365E785982E1f101E93b906"].map((address) => post({ chainId: CHAIN, address })));
    expect(replies.map((reply) => reply!.status)).toEqual([200, 200, 200]);
    expect(peak).toBe(1);
  });
});
