import type { FacilityStatusName } from "../hooks/useFacilities";

const STATUS_CLASS: Record<FacilityStatusName, string> = {
  Open: "open",
  Late: "late",
  Defaulted: "defaulted",
  Closed: "closed",
};

export function StatusBadge({ status }: { status: FacilityStatusName }) {
  return (
    <span className={`market-status ${STATUS_CLASS[status]}`}>
      <i />
      {status}
    </span>
  );
}
