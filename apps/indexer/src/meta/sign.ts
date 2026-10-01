import { createHmac, timingSafeEqual } from "node:crypto";

export type Purpose = "upload" | "download";

const mac = (secret: Uint8Array, purpose: Purpose, id: string, exp: number) => createHmac("sha256", secret).update(`${purpose}|${id}|${exp}`).digest("hex");

export function signUrl(secret: Uint8Array, purpose: Purpose, id: string, now: number, ttl: number) {
  const exp = now + ttl;
  return { exp, sig: mac(secret, purpose, id, exp) };
}

export function verifyUrl(secret: Uint8Array, purpose: Purpose, id: string, exp: string | null, sig: string | null, now: number): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Number(exp) < now) return false;
  const expected = Buffer.from(mac(secret, purpose, id, Number(exp)), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
