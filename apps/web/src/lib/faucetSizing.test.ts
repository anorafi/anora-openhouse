import { describe, expect, test } from "vitest";
import { FAUCET_AMOUNT } from "./faucet";
import { draftSizeFor } from "./book";
import { randomDraft } from "../state/book";

const FLOOR_BPS = 1_000;

describe("faucet sizing", () => {
  test("one claim covers the largest first-loss a default draft can ask for", () => {
    const size = draftSizeFor(true);
    for (let round = 0; round < 400; round += 1) {
      const draft = randomDraft([], size);
      expect(Number(draft.firstLoss)).toBeLessThanOrEqual(FAUCET_AMOUNT);
    }
  });

  test("the default first-loss always meets the protocol floor", () => {
    const size = draftSizeFor(true);
    for (let round = 0; round < 400; round += 1) {
      const draft = randomDraft([], size);
      expect(Number(draft.firstLoss)).toBeGreaterThanOrEqual((Number(draft.limit) * FLOOR_BPS) / 10_000);
    }
  });

  test("a claim leaves room to supply after the largest default first-loss", () => {
    const size = draftSizeFor(true);
    const largest = Math.ceil((size.max * 0.35) / size.step) * size.step;
    expect(FAUCET_AMOUNT - largest).toBeGreaterThanOrEqual(1_000);
  });
});
