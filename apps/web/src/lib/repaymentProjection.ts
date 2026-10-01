import type { Facility } from "./book";
import { maturityOf } from "../state/book";

export function repaymentProjection(facilities: Facility[], days: number, now = Date.now()) {
  const end = now + days * 86400000;
  const available = facilities.filter((f) => f.stage !== "settled" && f.stage !== "closed").reduce((sum, f) => sum + f.holding.value, 0);
  const scheduled = facilities.filter((f) => (f.stage === "drawn" || f.stage === "funded") && f.holding.value > 0 && maturityOf(f) > now && maturityOf(f) <= end).sort((a, b) => maturityOf(a) - maturityOf(b));
  const points = [{ at: now, value: available, principal: 0, returns: 0, label: "Estimated value today" }];
  for (const facility of scheduled) {
    const previous = points[points.length - 1];
    const principal = facility.holding.value;
    const gain = principal * facility.targetReturn / 100;
    points.push({ at: maturityOf(facility), value: previous.value + gain, principal: previous.principal + principal, returns: previous.returns + gain, label: facility.name });
  }
  points.push({ ...points[points.length - 1], at: end, label: "End of forecast" });
  return points;
}
