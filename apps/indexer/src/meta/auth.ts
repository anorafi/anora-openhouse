import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import type { MetaStore } from "./store";

export interface AuthConfig {
  domain: string;
  chains: number[];
  now: () => number;
  nonceTtl: number;
  sessionTtl: number;
}

export class AuthError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "UNSUPPORTED_CHAIN" | "INVALID_NONCE" | "INVALID_DOMAIN" | "INVALID_SIGNATURE" | "UNAUTHENTICATED",
    message: string,
  ) {
    super(message);
  }
}

export interface SigninFields {
  domain: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export function buildMessage(fields: SigninFields): string {
  return [
    `${fields.domain} wants you to sign in with your Ethereum account:`,
    fields.address,
    "",
    "Sign in to Anora to manage facility metadata and documents.",
    "",
    `URI: https://${fields.domain}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${iso(fields.issuedAt)}`,
    `Expiration Time: ${iso(fields.expiresAt)}`,
  ].join("\n");
}

export function parseMessage(text: string): SigninFields | null {
  const match = text.match(
    /^([^\s]+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\n[^\n]*\n\nURI: [^\n]+\nVersion: 1\nChain ID: (\d+)\nNonce: ([A-Za-z0-9]+)\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/,
  );
  if (!match) return null;
  const issuedAt = Date.parse(match[5]) / 1000;
  const expiresAt = Date.parse(match[6]) / 1000;
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt)) return null;
  return { domain: match[1], address: match[2], chainId: Number(match[3]), nonce: match[4], issuedAt, expiresAt };
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createNonce(store: MetaStore, cfg: AuthConfig, request: { address: string; chainId: number }) {
  if (!isAddress(request.address)) throw new AuthError("INVALID_REQUEST", "Address must be a 20-byte hex string.");
  if (!cfg.chains.includes(request.chainId)) throw new AuthError("UNSUPPORTED_CHAIN", `Chain ${request.chainId} is not supported.`);
  const issuedAt = cfg.now();
  const expiresAt = issuedAt + cfg.nonceTtl;
  const nonce = randomBytes(12).toString("hex");
  const address = getAddress(request.address);
  store.putNonce({ nonce, address: address.toLowerCase(), chainId: request.chainId, expiresAt });
  return { nonce, expiresAt, message: buildMessage({ domain: cfg.domain, address, chainId: request.chainId, nonce, issuedAt, expiresAt }) };
}

export async function verifySignin(store: MetaStore, cfg: AuthConfig, request: { message: string; signature: string }) {
  const fields = parseMessage(request.message);
  if (!fields) throw new AuthError("INVALID_REQUEST", "The message is not a sign-in message.");
  if (fields.domain !== cfg.domain) throw new AuthError("INVALID_DOMAIN", "The message was issued for another domain.");
  const issued = store.takeNonce(fields.nonce, cfg.now());
  if (!issued || issued.address !== fields.address.toLowerCase() || issued.chainId !== fields.chainId) throw new AuthError("INVALID_NONCE", "The nonce is unknown, used, or expired.");
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: request.message, signature: request.signature as Hex });
  } catch {
    throw new AuthError("INVALID_SIGNATURE", "The signature could not be read.");
  }
  if (recovered.toLowerCase() !== fields.address.toLowerCase()) throw new AuthError("INVALID_SIGNATURE", "The signature does not match the address.");
  const token = randomBytes(32).toString("hex");
  const expiresAt = cfg.now() + cfg.sessionTtl;
  const address = fields.address.toLowerCase();
  store.putSession({ tokenHash: hashToken(token), address, expiresAt });
  return { token, address, expiresAt };
}

export function authenticate(store: MetaStore, cfg: AuthConfig, header: string | null): string | null {
  const match = header?.match(/^Bearer ([0-9a-f]{64})$/);
  if (!match) return null;
  return store.session(hashToken(match[1]), cfg.now());
}
