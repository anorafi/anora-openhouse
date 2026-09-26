import { repaymentProjection } from "../lib/repaymentProjection";
import { TokenAmount } from "./TokenAmount";
import { useMemo, useState, type CSSProperties } from "react";
import type { Market } from "./Markets";
import { AmountInput } from "./AmountInput";
import { DEFAULT_STAGES, STAGE_LABEL, eventTime, maturityOf, positionValue, realizedReturn, waterfallOf, type DemoEvent, type Facility } from "../state/demo";

const toNumber = (value: string) => Number(value.replace(/[^0-9.-]/g, "")) || 0;
const toAmount = (value: string) => Number(value.replace(/[^0-9-]/g, "")) || 0;
const usdc = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`;
const onDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function PortfolioChart({ series }: { series: ReturnType<typeof repaymentProjection> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const first = series[0], last = series[series.length - 1];
  const at = Math.max(first.at, Math.min(selected ?? first.at, last.at));
  const point = [...series].reverse().find((point) => point.at <= at) ?? first;
  const padding = Math.max((last.value - first.value) * .3, first.value * .005, 1);
  const minimum = Math.max(0, first.value - padding);
  const maximum = last.value + padding;
  const repayments = series.slice(1, -1);
  const x = (date: number) => 72 + (date - first.at) / (last.at - first.at) * 490;
  const middleDate = repayments.length && x(repayments[0].at) > 175 && x(repayments[0].at) < 455 ? repayments[0].at : (first.at + last.at) / 2;
  const y = (value: number) => 175 - (value - minimum) / (maximum - minimum) * 115;
  const path = series.map((point, index) => index ? `H${x(point.at)} V${y(point.value)}` : `M${x(point.at)} ${y(point.value)}`).join(" ");
  const compact = (value: number) => new Intl.NumberFormat("en", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  const inspect = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left - bounds.width * 72 / 610) / (bounds.width * 490 / 610)));
    setSelected(first.at + fraction * (last.at - first.at));
  };
  return <>
    <div className="repayment-current"><strong>{usdc(first.value)}</strong><span>Estimated value today</span></div>
    <svg className="repayment-chart" viewBox="0 0 610 220" tabIndex={0} role="slider"
      aria-label="Portfolio outlook. Use arrow keys to explore dates."
      aria-valuemin={first.at} aria-valuemax={last.at} aria-valuenow={at}
      aria-valuetext={`${onDate(at)}: ${usdc(point.value)}, ${at === first.at ? "estimated today" : "conditional projection"}`}
      onPointerDown={inspect} onPointerMove={inspect}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setSelected(null); }}
      onFocus={() => setSelected(first.at)} onBlur={() => setSelected(null)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        setSelected(event.key === "Home" ? first.at : event.key === "End" ? last.at : Math.max(first.at, Math.min(last.at, at + (event.key === "ArrowRight" ? 1 : -1) * 86400000)));
      }}>
      {[minimum, (minimum + maximum) / 2, maximum].map((value) => <g key={value}><line x1="72" x2="562" y1={y(value)} y2={y(value)} stroke="#e4e2dc" /><text x="62" y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>)}
      <path d={path} fill="none" stroke="#91a600" strokeWidth="2" strokeDasharray="5 5" />
      {repayments.map((repayment, index) => <g key={index}>
        <line x1={x(repayment.at)} x2={x(repayment.at)} y1="60" y2="175" stroke="#d7d9cf" strokeDasharray="3 4" />
        <line x1={x(repayment.at)} x2={x(repayment.at)} y1={y(series[index].value)} y2={y(repayment.value)} stroke="#687b00" strokeWidth="3" />
        <circle cx={x(repayment.at)} cy={y(series[index].value)} r="4" fill="white" stroke="#687b00" strokeWidth="2" />
        <circle cx={x(repayment.at)} cy={y(repayment.value)} r="5" fill="#dff23c" stroke="#687b00" strokeWidth="2" />
      </g>)}
      {selected === null && repayments.length > 0 && <text x="562" y="35" textAnchor="end" style={{ fill: "#121720", fontWeight: 700 }}>Scheduled return +{usdc(last.value - first.value)}</text>}
      <circle cx="72" cy={y(first.value)} r="4" fill="#121720" />
      <text x="72" y="201" textAnchor="middle">{onDate(first.at)}</text>
      <text x={x(middleDate)} y="201" textAnchor="middle">{onDate(middleDate)}</text>
      <text x="562" y="201" textAnchor="middle">{onDate(last.at)}</text>
      {selected !== null && <g pointerEvents="none">
        <line x1={x(at)} x2={x(at)} y1="58" y2="175" stroke="#687182" strokeDasharray="3 4" />
        <circle cx={x(at)} cy={y(point.value)} r="5" fill="#dff23c" stroke="#121720" strokeWidth="2" />
        <g transform={`translate(${Math.max(72, Math.min(402, x(at) - 80))}, 3)`}>
          <rect width="160" height="48" rx="8" fill="#15181c" />
          <text x="12" y="18" style={{ fill: "#fff" }}>{onDate(at)}{at === first.at ? " · Today" : " · Projected"}</text>
          <text x="12" y="36" style={{ fill: "#dff23c", fontWeight: 700, fontSize: 14 }}>{usdc(point.value)}</text>
        </g>
      </g>}
    </svg>
    <div className="portfolio-chart-key"><span><i />Conditional projection</span></div>
  </>;
}
const SUPPLY_STEPS = ["Approve asset", "Supply capital", "Position created"];

/** Dots on a track: filled behind you, ringed where you are, hollow ahead. */
function StepRail({ step, complete = false }: { step: number; complete?: boolean }) {
  return <ol className="step-rail" style={{ "--progress": step / (SUPPLY_STEPS.length - 1) } as CSSProperties}>
    {SUPPLY_STEPS.map((label, index) => <li
      key={label}
      className={complete || index < step ? "done" : index === step ? "current" : ""}
      aria-current={!complete && index === step ? "step" : undefined}
    ><i aria-hidden="true" /><span>{label}</span></li>)}
  </ol>;
}

/** Form, then approve, then supply, then the position exists. */
type Phase = "form" | "approve" | "supply" | "done";

export function Opportunity({ market, onBack, onSupply, onDone }: { market: Market; onBack: () => void; onSupply: (amount: number) => boolean; onDone: () => void }) {
  const [amount, setAmount] = useState("120000");
  const [phase, setPhase] = useState<Phase>("form");
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [acceptedLiquidity, setAcceptedLiquidity] = useState(false);
  const [supplyError, setSupplyError] = useState("");
  const value = Number(amount || 0);
  const targetReturnPct = toNumber(market.targetReturn);
  const repayment = Math.round(value * (1 + targetReturnPct / 100));
  const availableValue = toAmount(market.available);
  const validAmount = Number.isFinite(value) && value > 0 && value <= Math.min(250000, availableValue) && market.accepting;
  const reservePct = toNumber(market.reserve);

  return <section className="opportunity-page">
    <button className="back-link" onClick={onBack}><span aria-hidden="true">←</span> Back to Markets</button>
    <header className="opportunity-heading"><div><div className="title-with-status"><h1>{market.name}</h1><span className={`market-status ${market.status.toLowerCase()}`}><i />{market.status}</span></div><p>{market.type} · {market.route}</p><span>{market.company}</span></div></header>
    <div className="opportunity-layout">
      <aside className="supply-panel">
        {phase === "form" && <>
          <h2>Supply</h2>
          <p className="panel-copy">Provide capital to earn a {market.targetReturn} target return.</p>
          <label>Asset<select><option>{market.asset}</option></select></label>
          <p className="balance-row"><span>Wallet balance</span><strong><TokenAmount value={250000} asset={market.asset} /></strong></p>
          <label>Amount<AmountInput value={amount} onChange={setAmount} suffix={market.asset} action={<button onClick={() => setAmount(String(Math.min(250000, availableValue)))}>Max</button>} /></label>
          <dl className="supply-totals"><div><dt>Estimated repayment</dt><dd><TokenAmount value={repayment} asset={market.asset} /></dd></div><div><dt>Estimated return</dt><dd><TokenAmount value={Math.max(0, repayment - value)} asset={market.asset} /></dd></div></dl>
          <button className="accent-button wide" disabled={!validAmount} onClick={() => setPhase("approve")}>Review supply</button>
          <div className="eligibility"><strong>Available to your account</strong><span>Fits your institutional mandate.</span></div>
          <small>Returns depend on repayment. Withdrawals may not be immediately available.</small>
        </>}

        {(phase === "approve" || phase === "supply") && <>
          <h2>Review supply</h2>
          <p className="panel-copy">Confirm the details below before supplying capital.</p>
          <dl className="review-list">
            <div><dt>Supply</dt><dd><TokenAmount value={value} asset={market.asset} /></dd></div>
            <div><dt>Market</dt><dd>{market.name}</dd></div>
            <div><dt>Target return</dt><dd>{market.targetReturn}</dd></div>
            <div><dt>Duration</dt><dd>{market.duration}</dd></div>
            <div><dt>Estimated repayment</dt><dd><TokenAmount value={repayment} asset={market.asset} /></dd></div>
            <div><dt>Estimated return</dt><dd className="positive"><TokenAmount value={Math.max(0, repayment - value)} asset={market.asset} /></dd></div>
            <div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div>
            <div><dt>Available afterward</dt><dd><TokenAmount value={Math.max(0, availableValue - value)} asset={market.asset} /></dd></div>
          </dl>
          <StepRail step={phase === "approve" ? 0 : 1} />
          <label className="review-check"><input type="checkbox" checked={acceptedRisk} onChange={(event) => setAcceptedRisk(event.target.checked)} />Returns depend on buyer repayment.</label>
          <label className="review-check"><input type="checkbox" checked={acceptedLiquidity} onChange={(event) => setAcceptedLiquidity(event.target.checked)} />Withdrawals may be delayed until repayment.</label>
          <div className="review-actions">
            <button className="secondary-button" onClick={() => setPhase("form")}>Back</button>
            <button
              className="primary-button"
              disabled={!acceptedRisk || !acceptedLiquidity || !validAmount}
              onClick={() => { if (phase === "approve") return setPhase("supply"); if (onSupply(value)) setPhase("done"); else setSupplyError("Supply was not completed. Check the available capacity and try again."); }}
            >{phase === "approve" ? `Approve ${market.asset}` : "Supply capital"}</button>
          </div>
          <small>You will confirm each transaction in your wallet. Anora never takes custody of your wallet.</small>
          {supplyError && <p role="alert">{supplyError}</p>}
        </>}

        {phase === "done" && <div className="flow-done" role="status">
          <span className="flow-done-mark" aria-hidden="true">✓</span>
          <h2>Position created</h2>
          <p className="panel-copy"><TokenAmount value={value} asset={market.asset} /> supplied to {market.name}.</p>
          <StepRail step={2} complete />
          <dl className="review-list">
            <div><dt>Supplied</dt><dd><TokenAmount value={value} asset={market.asset} /></dd></div>
            <div><dt>Target return</dt><dd>{market.targetReturn}</dd></div>
            <div><dt>Estimated repayment</dt><dd><TokenAmount value={repayment} asset={market.asset} /></dd></div>
            <div><dt>Duration</dt><dd>{market.duration}</dd></div>
          </dl>
          <button className="accent-button wide" onClick={onDone}>View portfolio</button>
          <small>Your position now tracks this facility until the originator repays.</small>
        </div>}
      </aside>
      <section className="market-detail-panel"><dl className="opportunity-metrics"><div><dt>Target return</dt><dd>{market.targetReturn}</dd></div><div><dt>Available to invest</dt><dd><TokenAmount value={availableValue} asset={market.asset} /></dd></div><div><dt>Duration</dt><dd>{market.duration}</dd></div><div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div></dl><div className="detail-section"><header><strong>Funding</strong><span>{market.fundingLabel}</span></header>{market.accepting && <progress className="accent-progress" max="100" value={market.funded}>{market.funded}%</progress>}</div><div className="detail-section"><header><strong>Protection before your position</strong><span>{market.reserve} absorbs losses before your capital.</span></header><div className="protection-bar" style={{ gridTemplateColumns: `${reservePct}fr ${Math.max(0, 100 - reservePct)}fr` }}><span>{market.reserve}</span><span>{Math.max(0, 100 - reservePct)}%</span></div><div className="detail-section-footer"><p>The reserve absorbs losses before your position.</p><button className="text-link">View risk and underwriting</button></div></div><div className="detail-section"><h2>Market overview</h2><dl className="detail-list"><div><dt>Financing type</dt><dd>{market.type}</dd></div><div><dt>Settlement asset</dt><dd>{market.asset}</dd></div><div><dt>Repayment</dt><dd>At maturity</dd></div><div><dt>Current state</dt><dd>{market.status}</dd></div><div><dt>Evidence status</dt><dd>Verified 2 hours ago</dd></div></dl></div><div className="inline-links"><button>Facility documents</button><button>Transaction history</button></div></section>
    </div>
  </section>;
}

export function Portfolio({ notice, latestSupplyId, onView, onActivity, live, onClaim }: { notice: string | null; latestSupplyId: string | null; onView: (id: string) => void; onActivity: () => void; live: Facility[]; onClaim: (id: string) => void }) {
  const [claiming, setClaiming] = useState(false);
  const [range, setRange] = useState("90D");

  // Every figure on this page is a view of the same facility records, so the
  // summary, chart, table, and insights cannot drift apart.
  const positions = useMemo(
    () => live.filter((facility) => facility.stage !== "settled" && facility.stage !== "closed")
      .map((facility) => ({ facility, value: positionValue(facility) }))
      .sort((a, b) => b.value - a.value),
    [live],
  );
  const supplied = positions.reduce((sum, position) => sum + position.facility.supplied, 0);
  const value = positions.reduce((sum, position) => sum + position.value, 0);
  const claimable = positions.filter((position) => position.facility.stage === "repaid" || position.facility.stage === "recovered");
  const claimTotal = claimable.reduce((sum, position) => sum + position.value, 0);
  const claimPrincipal = claimable.reduce((sum, position) => sum + position.facility.supplied, 0);
  const earned = live.reduce((sum, facility) => sum + realizedReturn(facility), 0);
  const series = useMemo(() => repaymentProjection(live, range === "1Y" ? 365 : parseInt(range)), [live, range]);

  const share = (amount: number) => (value > 0 ? (amount / value) * 100 : 0);
  const defaults = live.filter((facility) => facility.stage === "recovered" || facility.stage === "closed");
  const due = positions
    .filter((position) => position.facility.stage === "funded" || position.facility.stage === "drawn")
    .sort((a, b) => maturityOf(a.facility) - maturityOf(b.facility));
  const exposure = [...positions.reduce((map, position) => {
    const origin = position.facility.route.split("\u2192")[0].trim();
    return map.set(origin, (map.get(origin) ?? 0) + position.value);
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const weightedReserve = value > 0
    ? positions.reduce((sum, position) => sum + position.facility.reservePct * position.value, 0) / value
    : 0;

  return <section className="portfolio-page">
    <div className="page-title"><h1>Portfolio</h1><p>Track your capital, returns, and upcoming repayments.</p></div>
    {notice && <p className="success-banner">✓ {notice}</p>}
    <dl className="portfolio-summary">
      <div><dt>Total supplied</dt><dd>{usdc(supplied)}</dd></div>
      <div><dt>Estimated value</dt><dd>{usdc(value)}</dd></div>
      <div><dt>Realized return</dt><dd>{usdc(earned)}</dd></div>
      <div><dt>Available to claim</dt><dd>{usdc(claimTotal)}</dd><small>Principal + net return</small></div>
      <button className="primary-button" disabled={claimable.length === 0} onClick={() => setClaiming(true)}>Claim</button>
    </dl>
    <div className="analytics-grid">
      <section className="chart-panel">
        <header className="panel-heading"><div><h2>Portfolio Outlook</h2></div><div className="range-toggle">{["30D","90D","1Y"].map((item) => <button aria-pressed={range === item} className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item}</button>)}</div></header>
        <PortfolioChart key={range} series={series} />
        <p className="panel-footnote">Assumes supplied funds are drawn and repaid at the target return on the facility’s due date, no new deposits or claims, and 1 token = $1. Excludes future returns on overdue loans and future default recoveries. Returns are not guaranteed.</p>
      </section>
      <section className="allocation-panel">
        <header className="panel-heading"><div><h2>Allocation</h2><p>Share of your current portfolio value.</p></div></header>
        {positions.map(({ facility, value: amount }) => <div className={`allocation-row${facility.id === latestSupplyId ? " latest-supply" : ""}`} key={facility.id}>
          <span>{facility.name}</span><progress max="100" value={share(amount)} /><strong>{share(amount).toFixed(1)}%</strong>
        </div>)}
        {positions.length > 0 && <p className="panel-footnote">Largest position: <strong>{share(positions[0].value).toFixed(1)}%</strong></p>}
      </section>
    </div>
    <section className="positions-panel">
      <header className="panel-heading"><div><h2>Your positions</h2><p>All of your investments in one place.</p></div><button className="text-button" onClick={onActivity}>View activity</button></header>
      <div className="positions-table">
        <div className="table-head"><span>Opportunity</span><span>Supplied</span><span>Current value</span><span>Target return</span><span>Repayment</span><span>Status</span><span>Action</span></div>
        {positions.length === 0
          ? <p className="empty-state">No open positions yet. Supply capital from Markets to start one.</p>
          : positions.map(({ facility, value: amount }) => <div className="table-row" key={facility.id}>
            <span>{facility.id === latestSupplyId && <i className="recent-supply-dot" role="img" aria-label="Most recently supplied" title="Most recently supplied" />}{facility.name}</span>
            <span><TokenAmount value={facility.supplied} asset={facility.asset} /></span>
            <span className={amount < facility.supplied ? "negative" : ""}><TokenAmount value={amount} asset={facility.asset} /></span>
            <span>{facility.targetReturn}%</span>
            <span>{DEFAULT_STAGES.includes(facility.stage) ? "In default" : onDate(maturityOf(facility))}</span>
            <span className={`market-status ${facility.stage}`}>{STAGE_LABEL[facility.stage]}</span>
            {facility.stage === "repaid" || facility.stage === "recovered"
              ? <button onClick={() => onClaim(facility.id)}>Claim</button>
              : <button onClick={() => onView(facility.id)}>View</button>}
          </div>)}
      </div>
    </section>
    <div className="portfolio-insights">
      <section>
        <header className="panel-heading"><div><h2>Upcoming repayments</h2><p>Next repayments across your portfolio.</p></div></header>
        {due.length === 0
          ? <p className="panel-footnote">Nothing outstanding.</p>
          : due.map(({ facility, value: amount }) => <div className="insight-row" key={facility.id}><strong>{usdc(amount)}</strong><span>{onDate(maturityOf(facility))}</span></div>)}
      </section>
      <section>
        <header className="panel-heading"><div><h2>Exposure</h2><p>Your portfolio by originator market.</p></div></header>
        {exposure.map(([origin, amount]) => <div className="exposure-row" key={origin}>
          <span>{origin}</span><progress max="100" value={share(amount)} /><strong>{share(amount).toFixed(1)}%</strong>
        </div>)}
      </section>
      <section>
        <header className="panel-heading"><div><h2>Protection coverage</h2><p>Portfolio-level reserve coverage.</p></div></header>
        <div className="insight-row"><span>Weighted reserve</span><strong>{weightedReserve.toFixed(1)}%</strong></div>
        {defaults.map((facility) => <div className="insight-row" key={facility.id}>
          <span>Absorbed on {facility.name.replace(/ \d+$/, "")}</span><strong>{usdc(waterfallOf(facility).reserveApplied)}</strong>
        </div>)}
        <p className="panel-footnote">{defaults.length > 0
          ? `Reserve took the first loss. ${usdc(defaults.reduce((sum, facility) => sum + waterfallOf(facility).supplierLoss, 0))} reached your positions.`
          : "Capital set aside before your positions absorb losses."}</p>
      </section>
    </div>
    <p className="portfolio-disclaimer">Portfolio values are estimates. Returns depend on repayment and available liquidity.</p>
    {claiming && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="claim-title">
      <button className="modal-close" onClick={() => setClaiming(false)}>×</button>
      <h2 id="claim-title">Claim available funds</h2>
      <p>Move repayments and recovery distributions to your connected wallet.</p>
      <strong className="claim-amount">{usdc(claimTotal)}</strong>
      <dl className="detail-list">
        <div><dt>Original principal</dt><dd>{usdc(claimPrincipal)}</dd></div>
        <div><dt>Net return</dt><dd className={claimTotal >= claimPrincipal ? "positive" : "negative"}>{usdc(claimTotal - claimPrincipal)}</dd></div>
      </dl>
      <button className="primary-button wide" onClick={() => { claimable.forEach((position) => onClaim(position.facility.id)); setClaiming(false); }}>Confirm claim</button>
      <button className="secondary-button wide" onClick={() => setClaiming(false)}>Cancel</button>
    </div></div>}
  </section>;
}

const INVESTOR_FILTERS = ["All", "Supplies", "Repayments", "Credit"];

/** Which filter tab an entry belongs to. */
function bucketFor(event: DemoEvent) {
  if (event.actor === "Keeper") return "Credit";
  return event.event.startsWith("Capital supplied") ? "Supplies" : "Repayments";
}

export function Activity({ events = [] }: { events?: DemoEvent[] }) {
  const [filter, setFilter] = useState("All");
  const visible = events.filter((event) => filter === "All" || bucketFor(event) === filter);

  return <section className="activity-page">
    <div className="page-title"><h1>Activity</h1><p>Supplies, repayments, and claims.</p></div>
    <div className="activity-filters">
      {INVESTOR_FILTERS.map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}</button>)}
    </div>
    <div className="activity-table">
      <div className="table-head"><span>Time</span><span>Event</span><span>Opportunity</span><span>Amount</span><span>Type</span><span /></div>
      {visible.length === 0
        ? <p className="empty-state">Nothing here yet. Supply capital from Markets to start your history.</p>
        : visible.map((event) => <div className="table-row activity-row" key={event.id}>
          <span>{eventTime(event.at)}</span>
          <strong>{event.event}</strong>
          <span>{event.facility}</span>
          <span>{event.amount}</span>
          <span className={`market-status ${event.actor === "Keeper" ? "defaulted" : "drawn"}`}>{bucketFor(event)}</span>
          <span />
        </div>)}
    </div>
  </section>;
}
