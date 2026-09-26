import { maturityOf, owedOn, positionValue, type Facility } from "../state/demo";

export function repaymentProjection(facilities: Facility[], days: number, now = Date.now()) {
  const end = now + days * 86400000;
  const available = facilities.filter((f) => f.stage !== "settled" && f.stage !== "closed").reduce((sum, f) => sum + positionValue(f), 0);
  const scheduled = facilities.filter((f) => (f.stage === "drawn" || f.stage === "funded") && f.supplied > 0 && maturityOf(f) > now && maturityOf(f) <= end).sort((a, b) => maturityOf(a) - maturityOf(b));
  const points = [{ at: now, value: available, principal: 0, returns: 0, label: "Estimated value today" }];
  for (const facility of scheduled) {
    const previous = points[points.length - 1];
    const principal = facility.stage === "funded" ? facility.supplied : facility.drawn;
    const gain = facility.stage === "funded" ? principal * facility.targetReturn / 100 : owedOn(facility) - principal;
    points.push({ at: maturityOf(facility), value: previous.value + gain, principal: previous.principal + principal, returns: previous.returns + gain, label: facility.name });
  }
  points.push({ ...points[points.length - 1], at: end, label: "End of forecast" });
  return points;
}
