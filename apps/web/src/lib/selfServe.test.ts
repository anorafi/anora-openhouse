import { describe, expect, it } from "vitest";
import { approvalNotice, requestApproval, shouldRequestApproval } from "./selfServe";

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const base = { selfServe: true, connected: true, approved: false as boolean | undefined, state: "idle" as const };

describe("shouldRequestApproval", () => {
  it("asks once for a connected wallet that is not approved on a self-serve network", () => {
    expect(shouldRequestApproval(base)).toBe(true);
  });

  it("never asks on a network without self-serve approval", () => {
    expect(shouldRequestApproval({ ...base, selfServe: false })).toBe(false);
  });

  it("does not ask without a wallet or before the approval state is known", () => {
    expect(shouldRequestApproval({ ...base, connected: false })).toBe(false);
    expect(shouldRequestApproval({ ...base, approved: undefined })).toBe(false);
  });

  it("does not ask for a wallet that is already approved", () => {
    expect(shouldRequestApproval({ ...base, approved: true })).toBe(false);
  });

  it("does not ask again while a request is running or after it finished or failed", () => {
    for (const state of ["pending", "done", "failed"] as const) expect(shouldRequestApproval({ ...base, state })).toBe(false);
  });
});

describe("approvalNotice", () => {
  it("shows a line only while the approval is running", () => {
    expect(approvalNotice("pending")).toBe("Approving this wallet as a demo originator…");
    for (const state of ["idle", "done", "failed"] as const) expect(approvalNotice(state)).toBeNull();
  });
});

describe("requestApproval", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  it("posts the chain and wallet to the approvals route", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ approved: true, alreadyApproved: false, tx: "0xab" }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await requestApproval(fetchImpl, "https://api.example/", 421614, WALLET);
    expect(result).toEqual({ ok: true });
    expect(seen?.url).toBe("https://api.example/v1/originator-approvals");
    expect(seen?.init?.method).toBe("POST");
    expect(JSON.parse(String(seen?.init?.body))).toEqual({ chainId: 421614, address: WALLET });
  });

  it("treats an already approved wallet as success", async () => {
    expect(await requestApproval(reply(200, { approved: true, alreadyApproved: true, tx: null }), "https://api.example", 421614, WALLET)).toEqual({ ok: true });
  });

  it("returns the error code of a refusal", async () => {
    expect(await requestApproval(reply(429, { error: { code: "RATE_LIMITED", message: "Too many requests." } }), "https://api.example", 421614, WALLET)).toEqual({ ok: false, code: "RATE_LIMITED" });
  });

  it("returns a network error code when the request cannot be made", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await requestApproval(down, "https://api.example", 421614, WALLET)).toEqual({ ok: false, code: "NETWORK_ERROR" });
  });
});
