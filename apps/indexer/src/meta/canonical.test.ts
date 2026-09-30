import { describe, expect, test } from "bun:test";
import { canonicalJson, digestOf } from "./canonical";

describe("canonical json", () => {
  test("sorts keys at every depth and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  test("gives the same digest whatever the key order", () => {
    expect(digestOf({ a: 1, b: { c: 2, d: 3 } })).toBe(digestOf({ b: { d: 3, c: 2 }, a: 1 }));
  });

  test("changes the digest when any value changes", () => {
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
  });

  test("returns a 32-byte hex digest", () => {
    expect(digestOf({ a: 1 })).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("rejects values that json cannot represent stably", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});
