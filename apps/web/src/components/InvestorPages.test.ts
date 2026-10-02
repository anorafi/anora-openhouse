import { expect, it } from "vitest";
import type { Market } from "./Markets";
import { facilityReview } from "./InvestorPages";

it("keeps review data stable per facility and varies it across facilities", () => {
  const market = { name: "Bandung Tea Export 01", route: "Indonesia → Singapore", company: "PT Nusantara Teh Lestari", type: "Export receivables" } as Market;
  expect(facilityReview(market)).toEqual(facilityReview(market));
  expect(facilityReview({ ...market, name: "Sumatra Coffee Receivables 04" })).not.toEqual(facilityReview(market));
});
