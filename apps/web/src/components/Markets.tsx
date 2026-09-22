import { useMemo, useState } from "react";
import { FilterBar, presentOptions } from "./FilterBar";
import { facilityAsMarket, owedOn, useDemo, type Facility } from "../state/demo";

export type MarketStatus = "Open" | "Funding" | "Active" | "Paused" | "Repaid" | "Settled" | "Defaulted" | "Recovered" | "Closed";
export type Market = { name: string; type: string; route: string; company: string; icon: string; asset: string; status: MarketStatus; targetReturn: string; available: string; duration: string; reserve: string; funded: number };

const categories = ["All", "Export receivables", "Supply-chain finance", "Commodity finance"];
type TabVariant = "all" | "export" | "supply" | "commodity";
const categoryIcon: Record<string, TabVariant> = { "All": "all", "Export receivables": "export", "Supply-chain finance": "supply", "Commodity finance": "commodity" };

function TabIcon({ variant }: { variant: TabVariant }) {
  switch (variant) {
    case "all":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <circle cx="2.5" cy="2.5" r="1.6" /><circle cx="9.5" cy="2.5" r="1.6" />
          <circle cx="2.5" cy="9.5" r="1.6" /><circle cx="9.5" cy="9.5" r="1.6" />
        </svg>
      );
    case "export":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 9L9 3M9 3H4.5M9 3V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "supply":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="4" cy="6" r="2.7" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="8" cy="6" r="2.7" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "commodity":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="9" height="7" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.5 5.5H10.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
  }
}

function MarketsBackdrop() {
  return (
    <svg className="markets-bg" aria-hidden="true" viewBox="0 0 1200 640" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="mktBlobAccent" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#dff23c" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#dff23c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mktBlobWhite" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="mkt-blob mkt-blob-a" cx="220" cy="140" r="280" fill="url(#mktBlobAccent)" />
      <circle className="mkt-blob mkt-blob-b" cx="960" cy="90" r="320" fill="url(#mktBlobWhite)" />
      <circle className="mkt-blob mkt-blob-c" cx="640" cy="460" r="260" fill="url(#mktBlobAccent)" />
    </svg>
  );
}

const STATUS_ORDER = ["Open", "Funding", "Active", "Paused", "Repaid", "Settled", "Defaulted", "Recovered", "Closed"];

/** Duration buckets, tested against the facility's real term. */
const DURATIONS: Array<{ label: string; holds: (facility: Facility) => boolean }> = [
  { label: "All", holds: () => true },
  { label: "Up to 60 days", holds: (facility) => facility.durationDays <= 60 },
  { label: "61 to 90 days", holds: (facility) => facility.durationDays > 60 && facility.durationDays <= 90 },
  { label: "Over 90 days", holds: (facility) => facility.durationDays > 90 },
];

const usdM = (value: number) => `$${(value / 1_000_000).toFixed(2)}M`;

export function Markets({ onReview }: { onReview: (market: Market) => void }) {
  const { facilities } = useDemo();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [asset, setAsset] = useState("All");
  const [duration, setDuration] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");
  // Every market is one of the originator's facilities, so the list and the
  // summary are both derived rather than restated.
  // Each row keeps its facility so filters test real numbers, not label text.
  const rows = useMemo(() => facilities.map((facility) => ({ facility, market: facilityAsMarket(facility) })), [facilities]);
  const summary = useMemo(() => ({
    supplied: facilities.reduce((sum, f) => sum + f.supplied, 0),
    outstanding: facilities.filter((f) => f.stage === "drawn").reduce((sum, f) => sum + owedOn(f), 0),
    repaid: facilities.reduce((sum, f) => sum + f.repaid, 0),
    active: facilities.filter((f) => f.stage !== "settled" && f.stage !== "closed").length,
  }), [facilities]);
  const statuses = useMemo(() => presentOptions(rows, STATUS_ORDER, (row) => row.market.status), [rows]);
  const assets = useMemo(() => presentOptions(rows, [...new Set(rows.map((row) => row.market.asset))], (row) => row.market.asset), [rows]);
  const held = DURATIONS.find((item) => item.label === duration) ?? DURATIONS[0];
  const visible = useMemo(() => rows.filter(({ facility, market }) =>
    `${market.name} ${market.company} ${market.route}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (category === "All" || market.type === category) &&
    (status === "All" || market.status === status) &&
    (asset === "All" || market.asset === asset) &&
    held.holds(facility)
  ), [asset, category, held, query, rows, status]);

  return <section className="markets-page">
    <MarketsBackdrop />
    <dl className="market-summary">
      <div><dt>Capital supplied</dt><dd>{usdM(summary.supplied)}</dd></div><div><dt>Outstanding</dt><dd>{usdM(summary.outstanding)}</dd></div>
      <div><dt>Repaid</dt><dd>{usdM(summary.repaid)}</dd></div><div><dt>Active facilities</dt><dd>{summary.active}</dd></div>
    </dl>
    <div className="markets-heading">
      <div><h1>Markets</h1><p>Supply capital to isolated trade-finance facilities.</p></div>
      <div className="heading-filters">
        <div className="category-tabs" aria-label="Trade type">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}><TabIcon variant={categoryIcon[item]} />{item}</button>)}</div>
        <div className="view-toggle" aria-label="View"><button className={view === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setView("grid")}>▦</button><button className={view === "list" ? "active" : ""} aria-label="List view" onClick={() => setView("list")}>☷</button></div>
      </div>
    </div>
    <FilterBar
      query={query}
      onQuery={setQuery}
      placeholder="Search facility or originator…"
      filters={[
        { label: "Currency", value: asset, options: assets, onChange: setAsset },
        { label: "Duration", value: duration, options: DURATIONS.map((item) => item.label), onChange: setDuration },
        { label: "Status", value: status, options: statuses, onChange: setStatus },
      ]}
    />
    <div className={`market-cards ${view}`}>{visible.map(({ market }) => <MarketCard key={market.name} market={market} onReview={onReview} />)}</div>
    {visible.length === 0 && <p className="empty-state">No opportunities match these filters.</p>}
    <p className="market-note"><span aria-hidden="true">ⓘ</span> Each market is isolated. Performance and losses do not transfer between facilities.</p>
  </section>;
}

function MarketCard({ market, onReview }: { market: Market; onReview: (market: Market) => void }) {
  return <article
    className="market-card"
    role="button"
    tabIndex={0}
    onClick={() => onReview(market)}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onReview(market); } }}
  >
    <div className="card-intro">
      <header><div><h2>{market.name}</h2><p><span>{market.type}</span><span>{market.route}</span></p></div><span className={`market-status ${market.status.toLowerCase()}`}><i />{market.status}</span></header>
      <p className="market-company"><span aria-hidden="true">{market.icon}</span>{market.company}</p>
    </div>
    <dl className="market-metrics"><div><dt>Target return</dt><dd>{market.targetReturn}</dd></div><div><dt>Available</dt><dd>{market.available}</dd></div><div><dt>Duration</dt><dd>{market.duration}</dd></div><div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div></dl>
    <div className="funding-row"><span>{market.funded}% utilized</span><progress max="100" value={market.funded}>{market.funded}%</progress></div>
    <button className="review-button" onClick={(e) => { e.stopPropagation(); onReview(market); }}>View market <span aria-hidden="true">→</span></button>
  </article>;
}
