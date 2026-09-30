import { beforeEach, describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AuthError, authenticate, buildMessage, createNonce, parseMessage, verifySignin, type AuthConfig } from "./auth";
import { openMetaStore, type MetaStore } from "./store";

let store: MetaStore;
let time: number;
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const cfg = (): AuthConfig => ({ domain: "openhouse.anora.finance", chains: [421614, 4663], now: () => time, nonceTtl: 300, sessionTtl: 3600 });

beforeEach(() => {
  store = openMetaStore(":memory:");
  time = 1_800_000_000;
});

const sign = (signer: typeof account, message: string) => signer.signMessage({ message });
const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return (error as AuthError).code;
  }
  return null;
};

describe("message", () => {
  test("round-trips through build and parse", () => {
    const message = buildMessage({ domain: "openhouse.anora.finance", address: account.address, chainId: 421614, nonce: "abc123", issuedAt: 1_800_000_000, expiresAt: 1_800_000_300 });
    expect(message).toContain("openhouse.anora.finance wants you to sign in with your Ethereum account:");
    expect(parseMessage(message)).toEqual({ domain: "openhouse.anora.finance", address: account.address, chainId: 421614, nonce: "abc123", issuedAt: 1_800_000_000, expiresAt: 1_800_000_300 });
  });

  test("rejects text that is not a sign-in message", () => {
    expect(parseMessage("hello")).toBeNull();
  });
});

describe("sign-in", () => {
  test("verifies a fresh signature and opens a session", async () => {
    const { message } = createNonce(store, cfg(), { address: account.address, chainId: 421614 });
    const session = await verifySignin(store, cfg(), { message, signature: await sign(account, message) });
    expect(session.address).toBe(account.address.toLowerCase());
    expect(authenticate(store, cfg(), `Bearer ${session.token}`)).toBe(account.address.toLowerCase());
  });

  test("rejects a signature from another wallet", async () => {
    const { message } = createNonce(store, cfg(), { address: account.address, chainId: 421614 });
    expect(await codeOf(async () => verifySignin(store, cfg(), { message, signature: await sign(other, message) }))).toBe("INVALID_SIGNATURE");
  });

  test("rejects a replayed message", async () => {
    const { message } = createNonce(store, cfg(), { address: account.address, chainId: 421614 });
    const signature = await sign(account, message);
    await verifySignin(store, cfg(), { message, signature });
    expect(await codeOf(() => verifySignin(store, cfg(), { message, signature }))).toBe("INVALID_NONCE");
  });

  test("rejects an expired nonce", async () => {
    const { message } = createNonce(store, cfg(), { address: account.address, chainId: 421614 });
    const signature = await sign(account, message);
    time += 301;
    expect(await codeOf(() => verifySignin(store, cfg(), { message, signature }))).toBe("INVALID_NONCE");
  });

  test("rejects a message for another domain", async () => {
    const { message } = createNonce(store, { ...cfg(), domain: "evil.example" }, { address: account.address, chainId: 421614 });
    expect(await codeOf(async () => verifySignin(store, cfg(), { message, signature: await sign(account, message) }))).toBe("INVALID_DOMAIN");
  });

  test("rejects an unsupported chain when asking for a nonce", () => {
    expect(() => createNonce(store, cfg(), { address: account.address, chainId: 1 })).toThrow(AuthError);
  });

  test("a session stops working after it expires", async () => {
    const { message } = createNonce(store, cfg(), { address: account.address, chainId: 421614 });
    const session = await verifySignin(store, cfg(), { message, signature: await sign(account, message) });
    time += 3601;
    expect(authenticate(store, cfg(), `Bearer ${session.token}`)).toBeNull();
    expect(authenticate(store, cfg(), null)).toBeNull();
    expect(authenticate(store, cfg(), "Bearer nope")).toBeNull();
  });
});
