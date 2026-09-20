import { useMemo, useState } from "react";

type MarketStatus = "Open" | "Funding" | "Active" | "Paused";
type Market = { name: string; type: string; route: string; company: string; icon: string; status: MarketStatus; targetReturn: string; available: string; duration: string; reserve: string; funded: number };

const markets: Market[] = [
  { name: "Bandung Tea Export 01", type: "Export receivables", route: "Indonesia → Singapore", company: "PT Nusantara Teh Lestari", icon: "◒", status: "Open", targetReturn: "8.5%", available: "$301,040", duration: "90 days", reserve: "22.8%", funded: 68 },
  { name: "Sumatra Coffee Receivables", type: "Export receivables", route: "Indonesia → Japan", company: "PT Sumatra Kopi Global", icon: "◐", status: "Open", targetReturn: "9.2%", available: "$420,000", duration: "120 days", reserve: "18%", funded: 52 },
  { name: "Java Cocoa Purchase Orders", type: "Supply-chain finance", route: "Indonesia → Netherlands", company: "PT Jawa Cokelat Lestari", icon: "◉", status: "Funding", targetReturn: "10.1%", available: "$185,000", duration: "75 days", reserve: "25%", funded: 29 },
  { name: "Vietnam Cashew Export", type: "Export receivables", route: "Vietnam → UAE", company: "Viet Harvest Co., Ltd.", icon: "◔", status: "Active", targetReturn: "8.8%", available: "$0", duration: "90 days", reserve: "20%", funded: 100 },
  { name: "Thailand Rice Shipment", type: "Commodity finance", route: "Thailand → Philippines", company: "Siam Grains Co., Ltd.", icon: "♨", status: "Open", targetReturn: "7.9%", available: "$510,000", duration: "60 days", reserve: "24%", funded: 41 },
  { name: "Indonesia Palm Oil Cargo", type: "Commodity finance", route: "Indonesia → India", company: "PT Sawit Mandiri", icon: "♧", status: "Paused", targetReturn: "11.3%", available: "$0", duration: "45 days", reserve: "30%", funded: 100 },
];

const categories = ["All", "Export receivables", "Supply-chain finance", "Commodity finance"];

export function Markets({ onReview }: { onReview: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");
  const visible = useMemo(() => markets.filter((market) =>
    `${market.name} ${market.company} ${market.route}`.toLowerCase().includes(query.toLowerCase()) &&
    (category === "All" || market.type === category) &&
    (status === "All" || market.status === status)
  ), [category, query, status]);

  return <section className="markets-page">
    <div className="markets-heading">
      <div><h1>Markets</h1><p>Supply capital to isolated trade-finance facilities.</p></div>
      <dl className="market-summary">
        <div><dt>Capital supplied</dt><dd>$6.24M</dd></div><div><dt>Outstanding</dt><dd>$4.18M</dd></div>
        <div><dt>Repaid</dt><dd>$11.7M</dd></div><div><dt>Active facilities</dt><dd>6</dd></div>
      </dl>
    </div>
    <div className="market-filters">
      <label className="market-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search facility, originator, or trade corridor…" /></label>
      <div className="category-tabs" aria-label="Trade type">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <select aria-label="Currency"><option>Currency</option><option>USDC</option></select>
      <select aria-label="Duration"><option>Duration</option><option>Up to 90 days</option><option>90+ days</option></select>
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option>All</option><option>Open</option><option>Funding</option><option>Active</option><option>Paused</option></select>
      <div className="view-toggle" aria-label="View"><button className={view === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setView("grid")}>▦</button><button className={view === "list" ? "active" : ""} aria-label="List view" onClick={() => setView("list")}>☷</button></div>
    </div>
    <div className={`market-cards ${view}`}>{visible.map((market) => <MarketCard key={market.name} market={market} onReview={onReview} />)}</div>
    {visible.length === 0 && <p className="empty-state">No opportunities match these filters.</p>}
    <p className="market-note"><span aria-hidden="true">ⓘ</span> Each market is isolated. Performance and losses do not transfer between facilities.</p>
  </section>;
}

function MarketCard({ market, onReview }: { market: Market; onReview: () => void }) {
  return <article className="market-card">
    <header><div><h2>{market.name}</h2><p>{market.type} <span>•</span> {market.route}</p></div><span className={`market-status ${market.status.toLowerCase()}`}><i />{market.status}</span></header>
    <p className="market-company"><span aria-hidden="true">{market.icon}</span>{market.company}</p>
    <dl className="market-metrics"><div><dt>Target return</dt><dd>{market.targetReturn}</dd></div><div><dt>Available</dt><dd>{market.available}</dd></div><div><dt>Duration</dt><dd>{market.duration}</dd></div><div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div></dl>
    <div className="funding-row"><span>{market.funded}% utilized</span><progress max="100" value={market.funded}>{market.funded}%</progress></div>
    <button className="review-button" onClick={onReview}>View market <span aria-hidden="true">→</span></button>
  </article>;
}
