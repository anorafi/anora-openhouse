import { keccak256, stringToBytes, type Hex } from "viem";

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Numbers must be finite.");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, normalize(item)]));
  }
  throw new Error(`Unsupported value of type ${typeof value}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function digestOf(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(value)));
}
