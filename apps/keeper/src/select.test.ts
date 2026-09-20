import { describe, expect, test } from "bun:test";
import { facilitiesToMarkLate } from "./select";

const a = "0x0000000000000000000000000000000000000001" as const;
const b = "0x0000000000000000000000000000000000000002" as const;

describe("facilitiesToMarkLate", () => {
  test("picks open facilities with principal past their due date", () => {
    const picked = facilitiesToMarkLate(
      [
        { address: a, status: 0, principal: 10n, dueAt: 100n },
        { address: b, status: 0, principal: 10n, dueAt: 200n },
      ],
      150n,
    );
    expect(picked).toEqual([a]);
  });

  test("skips facilities that are late, defaulted, closed, undrawn, or exactly at due", () => {
    const picked = facilitiesToMarkLate(
      [
        { address: a, status: 1, principal: 10n, dueAt: 100n },
        { address: b, status: 2, principal: 10n, dueAt: 100n },
        { address: a, status: 3, principal: 10n, dueAt: 100n },
        { address: b, status: 0, principal: 0n, dueAt: 100n },
        { address: a, status: 0, principal: 10n, dueAt: 0n },
        { address: b, status: 0, principal: 10n, dueAt: 150n },
      ],
      150n,
    );
    expect(picked).toEqual([]);
  });
});
