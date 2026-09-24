import { expect, it } from "vitest";
import { fundingState, facilityAsMarket, marketAction, realizedReturn, type Facility, type Stage } from "./demo";

it("routes market actions by funding stage and demo position", () => {
  const facility = { limit: 1000, supplied: 400 } as Facility;
  expect(marketAction({ ...facility, stage: "open" })).toBe("View market");
  expect(marketAction({ ...facility, stage: "funded", supplied: 1000 })).toBe("View position");
  expect(marketAction({ ...facility, stage: "drawn" })).toBe("View position");
  for (const stage of ["repaid", "recovered"] as Stage[]) expect(marketAction({ ...facility, stage })).toBe("Claim funds");
  for (const stage of ["settled", "closed"] as Stage[]) expect(marketAction({ ...facility, stage })).toBe("View history");
  expect(marketAction({ ...facility, stage: "drawn", supplied: 0 })).toBe("Funding closed");
});

it("counts only repaid returns and settled recovery results", () => {
  const facility = { supplied: 240000, drawn: 240000, targetReturn: 7.9, repaid: 258960, firstLoss: 48000, recovered: 0 } as Facility;
  expect(realizedReturn({ ...facility, stage: "drawn" })).toBe(0);
  expect(realizedReturn({ ...facility, stage: "defaulted" })).toBe(0);
  expect(realizedReturn({ ...facility, stage: "repaid" })).toBe(18960);
  expect(realizedReturn({ ...facility, stage: "settled" })).toBe(18960);
  expect(realizedReturn({ ...facility, stage: "recovered", recovered: 100000 })).toBe(-92000);
});

it("keeps capacity and lifecycle labels consistent across role views", () => {
  const facility = { limit: 1000, supplied: 400, reservePct: 20 } as Facility;
  for (const stage of ["open", "funded", "drawn", "repaid", "settled", "defaulted", "recovered", "closed"] as Stage[]) {
    const record = { ...facility, stage };
    const funding = fundingState(record);
    const market = facilityAsMarket(record);
    expect(funding.available).toBe(stage === "open" || stage === "funded" ? 600 : 0);
    expect(market.fundingLabel).toBe(funding.label);
    expect(market.accepting).toBe(funding.accepting);
    if (!funding.accepting) expect(funding.label).not.toContain("% funded");
  }
  expect(fundingState({ ...facility, stage: "open", limit: 0 }).percent).toBe(0);
});
