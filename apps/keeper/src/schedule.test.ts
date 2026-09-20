import { describe, expect, test } from "bun:test";
import { delayUntilDue, upsertSchedule } from "./schedule";

const a = "0x0000000000000000000000000000000000000001" as const;

describe("delayUntilDue", () => {
  test("waits until just after the due timestamp", () => {
    expect(delayUntilDue(1000n, 900n)).toBe(102_000);
  });
  test("fires immediately when already past due", () => {
    expect(delayUntilDue(1000n, 1500n)).toBe(0);
  });
});

describe("upsertSchedule", () => {
  test("replaces an existing entry for the same facility", () => {
    const list = upsertSchedule([{ address: a, dueAt: 1n }], { address: a, dueAt: 2n });
    expect(list).toEqual([{ address: a, dueAt: 2n }]);
  });
});
