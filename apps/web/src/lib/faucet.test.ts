import { describe, expect, test } from "vitest";
import { FAUCET_AMOUNT, faucetVisible } from "./faucet";

describe("faucet", () => {
  test("hands out one fixed amount per click", () => {
    expect(FAUCET_AMOUNT).toBe(10_000);
  });

  test("shows only for a connected wallet on a network whose asset has a faucet and allows writes", () => {
    expect(faucetVisible({ faucet: true, writes: true, connected: true })).toBe(true);
    expect(faucetVisible({ faucet: false, writes: true, connected: true })).toBe(false);
    expect(faucetVisible({ faucet: true, writes: false, connected: true })).toBe(false);
    expect(faucetVisible({ faucet: true, writes: true, connected: false })).toBe(false);
  });

  test("does not show without a deployment", () => {
    expect(faucetVisible({ faucet: undefined, writes: undefined, connected: true })).toBe(false);
  });
});
