import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { useAllFacilityAddresses } from "../hooks/useFactory";
import { useFacilities } from "../hooks/useFacilities";
import { useActivity, type ActivityRow } from "../hooks/useActivity";
import { explorerTxUrl } from "../lib/explorer";
import { formatUsdc } from "../lib/format";

const CATEGORY_BY_EVENT: Record<string, "Supplies" | "Repayments" | "Updates"> = {
  Deposited: "Supplies",
  Withdrawn: "Supplies",
  Drawn: "Repayments",
  Repaid: "Repayments",
  Recovered: "Repayments",
  MarkedLate: "Updates",
  DefaultDeclared: "Updates",
};

const FILTERS = ["All", "Supplies", "Repayments", "Updates"] as const;

function describeEvent(row: ActivityRow): string {
  const args = row.args;
  switch (row.eventName) {
    case "Deposited":
      return `Deposited ${formatUsdc(args.assets as bigint)} into ${(args.tranche as number) === 0 ? "Senior" : "Junior"}`;
    case "Withdrawn":
      return `Withdrew ${formatUsdc(args.assets as bigint)} from ${(args.tranche as number) === 0 ? "Senior" : "Junior"}`;
    case "Drawn":
      return `Drew down ${formatUsdc(args.amount as bigint)}`;
    case "Repaid":
      return `Repaid ${formatUsdc(args.principal as bigint)} principal + ${formatUsdc(args.fee as bigint)} fee`;
    case "MarkedLate":
      return "Marked late";
    case "DefaultDeclared":
      return `Declared default: ${args.reason as string}`;
    case "Recovered":
      return `Recorded recovery ${formatUsdc(args.amount as bigint)}`;
    default:
      return row.eventName;
  }
}

export function Activity() {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { data: addresses } = useAllFacilityAddresses();
  const { facilities } = useFacilities(addresses);
  const { data: rows, isLoading } = useActivity(facilities, address);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");

  const visible = useMemo(
    () => (rows ?? []).filter((row) => filter === "All" || CATEGORY_BY_EVENT[row.eventName] === filter),
    [rows, filter],
  );

  return (
    <section className="activity-page">
      <div className="page-title">
        <h1>Activity</h1>
        <p>Onchain events for your wallet across every facility, over the last ~50,000 blocks.</p>
      </div>
      {!isConnected || !address ? (
        <p className="muted">Connect a wallet to see your activity.</p>
      ) : (
        <>
          <div className="activity-filters">
            {FILTERS.map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item}
              </button>
            ))}
          </div>
          {isLoading && <p className="muted">Scanning recent blocks...</p>}
          <div className="activity-table">
            <div className="table-head">
              <span>Block</span>
              <span>Event</span>
              <span>Facility</span>
              <span>Detail</span>
              <span />
            </div>
            {visible.map((row) => (
              <div className="table-row activity-row" key={row.key}>
                <span>{row.blockNumber.toString()}</span>
                <strong>{row.eventName}</strong>
                <span>{row.facility.name}</span>
                <span>{describeEvent(row)}</span>
                {deployment ? (
                  <a href={explorerTxUrl(deployment.explorer, row.txHash)} target="_blank" rel="noreferrer">
                    View →
                  </a>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          {!isLoading && visible.length === 0 && (
            <p className="empty-state">
              No matching events in the last ~50,000 blocks. Check a facility's page directly on{" "}
              {deployment && (
                <a href={deployment.explorer} target="_blank" rel="noreferrer">
                  the explorer
                </a>
              )}
              .
            </p>
          )}
        </>
      )}
    </section>
  );
}
