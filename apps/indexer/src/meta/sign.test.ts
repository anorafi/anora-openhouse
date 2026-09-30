import { describe, expect, test } from "bun:test";
import { signUrl, verifyUrl } from "./sign";

const secret = new Uint8Array(32).fill(7);

describe("signed urls", () => {
  test("accepts a fresh signature", () => {
    const { exp, sig } = signUrl(secret, "download", "doc1", 1000, 60);
    expect(exp).toBe(1060);
    expect(verifyUrl(secret, "download", "doc1", String(exp), sig, 1000)).toBe(true);
  });

  test("rejects an expired signature", () => {
    const { exp, sig } = signUrl(secret, "download", "doc1", 1000, 60);
    expect(verifyUrl(secret, "download", "doc1", String(exp), sig, 1061)).toBe(false);
  });

  test("rejects another document, another purpose, and a moved expiry", () => {
    const { exp, sig } = signUrl(secret, "upload", "doc1", 1000, 60);
    expect(verifyUrl(secret, "upload", "doc2", String(exp), sig, 1000)).toBe(false);
    expect(verifyUrl(secret, "download", "doc1", String(exp), sig, 1000)).toBe(false);
    expect(verifyUrl(secret, "upload", "doc1", String(exp + 100), sig, 1000)).toBe(false);
  });

  test("rejects malformed input without throwing", () => {
    expect(verifyUrl(secret, "upload", "doc1", "x", "zz", 1000)).toBe(false);
    expect(verifyUrl(secret, "upload", "doc1", null, null, 1000)).toBe(false);
  });
});
