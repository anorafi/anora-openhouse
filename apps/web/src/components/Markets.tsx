import { useMemo, useState } from "react";
import type { Address } from "viem";
import { AddressLink } from "./AddressLink";
import { StatusBadge } from "./StatusBadge";
import { useDeployment } from "../hooks/useDeployment";
import { useAllFacilityAddresses } from "../hooks/useFactory";
import { useFacilities, type FacilityData, type FacilityStatusName } from "../hooks/useFacilities";
import { bpsToPct, toPct } from "../lib/facility";
import { formatDuration, formatUsdc } from "../lib/format";

const STATUS_FILTERS: ("All" | FacilityStatusName)[] = ["All", "Open", "Late", "Defaulted", "Closed"];

export function Markets({ onReview }: { onReview: (facility: Address) => void }) {
  const deployment = useDeployment();
  const { data: addresses, isLoading: isLoadingAddresses, error } = useAllFacilityAddresses();
  const { facilities } = useFacilities(addresses);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | FacilityStatusName>("All");
  const [view, setView] = useState<"grid" | "list">("grid");

  const visible = useMemo(
    () =>
      facilities.filter(
        (f) =>
          `${f.name} ${f.originator}`.toLowerCase().includes(query.toLowerCase()) &&
          (status === "All" || f.statusName === status),
      ),
    [facilities, query, status],
  );

  const totalCapital = facilities.reduce((sum, f) => sum + f.totalCapital, 0n);
  const activeCount = facilities.filter((f) => f.statusName === "Open" || f.statusName === "Late").length;
  const defaultedCount = facilities.filter((f) => f.statusName === "Defaulted").length;

  return (
    <section className="markets-page">
      <div className="markets-heading">
        <div>
          <h1>Markets</h1>
          <p>Supply capital to isolated trade-finance facilities.</p>
        </div>
        <dl className="market-summary">
          <div>
            <dt>Capital supplied</dt>
            <dd>
              {formatUsdc(totalCapital)} {deployment?.assetSymbol}
            </dd>
          </div>
          <div>
            <dt>Active facilities</dt>
            <dd>{activeCount}</dd>
          </div>
          <div>
            <dt>Defaulted</dt>
            <dd>{defaultedCount}</dd>
          </div>
          <div>
            <dt>Total facilities</dt>
            <dd>{facilities.length}</dd>
          </div>
        </dl>
      </div>
      <div className="market-filters">
        <label className="market-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search facility or originator address…" />
        </label>
        <span className="asset-pill">{deployment?.assetSymbol}</span>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as "All" | FacilityStatusName)}>
          {STATUS_FILTERS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <div className="view-toggle" aria-label="View">
          <button className={view === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setView("grid")}>▦</button>
          <button className={view === "list" ? "active" : ""} aria-label="List view" onClick={() => setView("list")}>☷</button>
        </div>
      </div>
      {error && <p className="error">Could not load facilities: {error.message}</p>}
      {isLoadingAddresses && <p className="muted">Loading facilities...</p>}
      <div className={`market-cards ${view}`}>
        {visible.map((facility) => (
          <MarketCard key={facility.address} facility={facility} onReview={onReview} />
        ))}
      </div>
      {!isLoadingAddresses && visible.length === 0 && <p className="empty-state">No facilities match these filters.</p>}
      <p className="market-note">
        <span aria-hidden="true">ⓘ</span> Each facility is isolated. Performance and losses do not transfer between facilities.
      </p>
    </section>
  );
}

function MarketCard({ facility, onReview }: { facility: FacilityData; onReview: (facility: Address) => void }) {
  const utilization = facility.terms.capitalCap === 0n ? 0 : toPct(facility.totalCapital, facility.terms.capitalCap);

  return (
    <article className="market-card">
      <header>
        <div>
          <h2>{facility.name}</h2>
          <p>
            Originator <AddressLink address={facility.originator} /> <span>•</span> tenor{" "}
            {formatDuration(Number(facility.terms.tenor))}
          </p>
        </div>
        <StatusBadge status={facility.statusName} />
      </header>
      <dl className="market-metrics">
        <div>
          <dt>Limit</dt>
          <dd>{formatUsdc(facility.terms.limit)}</dd>
        </div>
        <div>
          <dt>First-loss</dt>
          <dd>{toPct(facility.terms.firstLoss, facility.terms.limit)}%</dd>
        </div>
        <div>
          <dt>Financing fee</dt>
          <dd>{bpsToPct(facility.terms.financingFeeBps)}%</dd>
        </div>
        <div>
          <dt>Senior left</dt>
          <dd>{formatUsdc(facility.seniorCapacity)}</dd>
        </div>
      </dl>
      <div className="funding-row">
        <span>
          {formatUsdc(facility.totalCapital)} / {formatUsdc(facility.terms.capitalCap)} capital
        </span>
        <progress max="100" value={utilization}>{utilization}%</progress>
      </div>
      <dl className="detail-list">
        <div>
          <dt>Grace</dt>
          <dd>{formatDuration(Number(facility.terms.grace))}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{/^0x0+$/.test(facility.evidenceHash) ? "not attached" : `${facility.evidenceHash.slice(0, 10)}…`}</dd>
        </div>
      </dl>
      <button className="review-button" onClick={() => onReview(facility.address)}>
        View market <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}
