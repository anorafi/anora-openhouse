import { expect, it } from "vitest";
import type { Market } from "./Markets";
import { facilityReview, trancheAvailable } from "./InvestorPages";

it("keeps review data stable per facility and varies it across facilities", () => {
  const market = { name: "Bandung Tea Export 01", route: "Indonesia → Singapore", company: "PT Nusantara Teh Lestari", type: "Export receivables" } as Market;
  expect(facilityReview(market)).toEqual(facilityReview(market));
  expect(facilityReview({ ...market, name: "Sumatra Coffee Receivables 04" })).not.toEqual(facilityReview(market));
});

it("keeps the other tranche available when the selected tranche is full", () => {
  const market = { seniorAvailable: 0, juniorAvailable: 1_000 } as Market;
  expect(trancheAvailable(market, "senior")).toBe(0);
  expect(trancheAvailable(market, "junior")).toBe(1_000);
});
