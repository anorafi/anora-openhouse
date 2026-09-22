import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Market } from "./Markets";
import { AmountInput } from "./AmountInput";
import { DEFAULT_STAGES, STAGE_LABEL, eventTime, maturityOf, positionValue, waterfallOf, type DemoEvent, type Facility } from "../state/demo";

const toNumber = (value: string) => Number(value.replace(/[^0-9.-]/g, "")) || 0;
const toAmount = (value: string) => Number(value.replace(/[^0-9-]/g, "")) || 0;
const usdc = (value: number) => `${Math.round(value).toLocaleString()} USDC`;
const onDate = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

interface Series { labels: string[]; values: number[]; actualThrough: number }

const RANGE_LABELS: Record<string, string[]> = {
  "30D": ["-30d", "-15d", "Today", "+30d"],
  "90D": ["-90d", "-45d", "Today", "+90d"],
  "1Y": ["-1y", "-6m", "Today", "+1y"],
};
/** How much of the current earned return the projection extends by. */
const RANGE_AHEAD: Record<string, number> = { "30D": 0.35, "90D": 1, "1Y": 2.6 };

/** Supplied to current value is actual; beyond today is projected. */
function buildSeries(supplied: number, value: number, range: string): Series {
  const gain = value - supplied;
  return {
    labels: RANGE_LABELS[range],
    values: [supplied, supplied + gain * 0.45, value, value + gain * RANGE_AHEAD[range]],
    actualThrough: 2,
  };
}

function PortfolioChart({ series }: { series: Series }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height);
      const { labels, values, actualThrough } = series;
      const pad = { top: 18, right: 18, bottom: 28, left: 54 };
      const chartWidth = width - pad.left - pad.right;
      const chartHeight = height - pad.top - pad.bottom;
      const min = Math.floor(Math.min(...values) / 10000) * 10000 - 10000;
      const max = Math.ceil(Math.max(...values) / 10000) * 10000 + 10000;
      const x = (index: number) => pad.left + chartWidth * index / (values.length - 1);
      const y = (value: number) => pad.top + chartHeight * (max - value) / (max - min);

      context.font = '11px Inter, "Segoe UI", sans-serif';
      context.fillStyle = "#687182";
      context.strokeStyle = "#e4e2dc";
      context.lineWidth = 1;
      for (let index = 0; index < 3; index++) {
        const value = min + (max - min) * index / 2;
        const lineY = y(value);
        context.beginPath(); context.moveTo(pad.left, lineY); context.lineTo(width - pad.right, lineY); context.stroke();
        context.fillText(Math.round(value).toLocaleString(), 0, lineY + 4);
      }
      labels.forEach((label, index) => context.fillText(label, x(index) - context.measureText(label).width / 2, height - 5));

      const plot = (start: number, end: number, dashed: boolean) => {
        context.beginPath();
        context.setLineDash(dashed ? [5, 5] : []);
        context.strokeStyle = "#b7cf00";
        context.lineWidth = 2;
        for (let index = start; index <= end; index++) index === start ? context.moveTo(x(index), y(values[index])) : context.lineTo(x(index), y(values[index]));
        context.stroke();
      };
      plot(0, actualThrough, false);
      plot(actualThrough, values.length - 1, true);
      context.setLineDash([]);
      values.forEach((value, index) => {
        context.beginPath(); context.arc(x(index), y(value), 4, 0, Math.PI * 2); context.fillStyle = "#cbdd2a"; context.fill();
      });
      context.fillStyle = "#121720";
      context.font = '700 12px Inter, "Segoe UI", sans-serif';
      context.fillText(values[values.length - 1].toLocaleString(), x(values.length - 1) - 48, y(values[values.length - 1]) - 10);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series]);

  const latest = series.values[series.values.length - 1];
  return <canvas ref={canvasRef} className="portfolio-chart" role="img" aria-label={`Portfolio value, projected to ${Math.round(latest).toLocaleString()} USDC`} />;
}

const SUPPLY_STEPS = ["Approve USDC", "Supply capital", "Position created"];

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

export function Opportunity({ market, onBack, onSupply, onDone }: { market: Market; onBack: () => void; onSupply: (amount: number) => void; onDone: () => void }) {
  const [amount, setAmount] = useState("120000");
  const [phase, setPhase] = useState<Phase>("form");
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [acceptedLiquidity, setAcceptedLiquidity] = useState(false);
  const value = Number(amount || 0);
  const targetReturnPct = toNumber(market.targetReturn);
  const repayment = Math.round(value * (1 + targetReturnPct / 100));
  const availableValue = toAmount(market.available);
  const reservePct = toNumber(market.reserve);

  return <section className="opportunity-page">
    <button className="back-link" onClick={onBack}><span aria-hidden="true">←</span> Back to Markets</button>
    <header className="opportunity-heading"><div><div className="title-with-status"><h1>{market.name}</h1><span className={`market-status ${market.status.toLowerCase()}`}><i />{market.status}</span></div><p>{market.type} · {market.route}</p><span>{market.company}</span></div></header>
    <div className="opportunity-layout">
      <aside className="supply-panel">
        {phase === "form" && <>
          <h2>Supply</h2>
          <p className="panel-copy">Provide capital to earn a {market.targetReturn} target return.</p>
          <label>Asset<select><option>USDC</option></select></label>
          <p className="balance-row"><span>Wallet balance</span><strong>250,000 USDC</strong></p>
          <label>Amount<AmountInput value={amount} onChange={setAmount} suffix="USDC" action={<button onClick={() => setAmount("250000")}>Max</button>} /></label>
          <dl className="supply-totals"><div><dt>Estimated repayment</dt><dd>{repayment.toLocaleString()} USDC</dd></div><div><dt>Estimated return</dt><dd>{Math.max(0, repayment - value).toLocaleString()} USDC</dd></div></dl>
          <button className="accent-button wide" disabled={!value} onClick={() => setPhase("approve")}>Review supply</button>
          <div className="eligibility"><strong>Available to your account</strong><span>Fits your institutional mandate.</span></div>
          <small>Returns depend on repayment. Withdrawals may not be immediately available.</small>
        </>}

        {(phase === "approve" || phase === "supply") && <>
          <h2>Review supply</h2>
          <p className="panel-copy">Confirm the details below before supplying capital.</p>
          <dl className="review-list">
            <div><dt>Supply</dt><dd>{value.toLocaleString()} USDC</dd></div>
            <div><dt>Market</dt><dd>{market.name}</dd></div>
            <div><dt>Target return</dt><dd>{market.targetReturn}</dd></div>
            <div><dt>Duration</dt><dd>{market.duration}</dd></div>
            <div><dt>Estimated repayment</dt><dd>{repayment.toLocaleString()} USDC</dd></div>
            <div><dt>Estimated return</dt><dd className="positive">{Math.max(0, repayment - value).toLocaleString()} USDC</dd></div>
            <div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div>
            <div><dt>Available afterward</dt><dd>{Math.max(0, availableValue - value).toLocaleString()} USDC</dd></div>
          </dl>
          <StepRail step={phase === "approve" ? 0 : 1} />
          <label className="review-check"><input type="checkbox" checked={acceptedRisk} onChange={(event) => setAcceptedRisk(event.target.checked)} />Returns depend on buyer repayment.</label>
          <label className="review-check"><input type="checkbox" checked={acceptedLiquidity} onChange={(event) => setAcceptedLiquidity(event.target.checked)} />Withdrawals may be delayed until repayment.</label>
          <div className="review-actions">
            <button className="secondary-button" onClick={() => setPhase("form")}>Back</button>
            <button
              className="primary-button"
              disabled={!acceptedRisk || !acceptedLiquidity}
              onClick={() => { if (phase === "approve") return setPhase("supply"); onSupply(value); setPhase("done"); }}
            >{phase === "approve" ? "Approve USDC" : "Supply capital"}</button>
          </div>
          <small>You will confirm each transaction in your wallet. Anora never takes custody of your wallet.</small>
        </>}

        {phase === "done" && <div className="flow-done" role="status">
          <span className="flow-done-mark" aria-hidden="true">✓</span>
          <h2>Position created</h2>
          <p className="panel-copy">{value.toLocaleString()} USDC supplied to {market.name}.</p>
          <StepRail step={2} complete />
          <dl className="review-list">
            <div><dt>Supplied</dt><dd>{value.toLocaleString()} USDC</dd></div>
            <div><dt>Target return</dt><dd>{market.targetReturn}</dd></div>
            <div><dt>Estimated repayment</dt><dd>{repayment.toLocaleString()} USDC</dd></div>
            <div><dt>Duration</dt><dd>{market.duration}</dd></div>
          </dl>
          <button className="accent-button wide" onClick={onDone}>View portfolio</button>
          <small>Your position now tracks this facility until the originator repays.</small>
        </div>}
      </aside>
      <section className="market-detail-panel"><dl className="opportunity-metrics"><div><dt>Target return</dt><dd>{market.targetReturn}</dd></div><div><dt>Available to invest</dt><dd>{availableValue.toLocaleString("id-ID")} USDC</dd></div><div><dt>Duration</dt><dd>{market.duration}</dd></div><div><dt>Protection reserve</dt><dd>{market.reserve}</dd></div></dl><div className="detail-section"><header><strong>Utilization</strong><span>{market.funded}% utilized</span></header><progress className="accent-progress" max="100" value={market.funded}>{market.funded}%</progress></div><div className="detail-section"><header><strong>Protection before your position</strong><span>{market.reserve} absorbs losses before your capital.</span></header><div className="protection-bar" style={{ gridTemplateColumns: `${reservePct}fr ${Math.max(0, 100 - reservePct)}fr` }}><span>{market.reserve}</span><span>{Math.max(0, 100 - reservePct)}%</span></div><div className="detail-section-footer"><p>The reserve absorbs losses before your position.</p><button className="text-link">View risk and underwriting</button></div></div><div className="detail-section"><h2>Market overview</h2><dl className="detail-list"><div><dt>Financing type</dt><dd>{market.type}</dd></div><div><dt>Settlement asset</dt><dd>USDC</dd></div><div><dt>Repayment</dt><dd>At maturity</dd></div><div><dt>Current state</dt><dd>{market.status}</dd></div><div><dt>Evidence status</dt><dd>Verified 2 hours ago</dd></div></dl></div><div className="inline-links"><button>Facility documents</button><button>Transaction history</button></div></section>
    </div>
  </section>;
}

export function Portfolio({ notice, onView, onActivity, live, onClaim }: { notice: string | null; onView: (id: string) => void; onActivity: () => void; live: Facility[]; onClaim: (id: string) => void }) {
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
  const series = useMemo(() => buildSeries(supplied, value, range), [supplied, value, range]);

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
      <div><dt>Current value</dt><dd>{usdc(value)}</dd></div>
      <div><dt>Earned return</dt><dd>{usdc(value - supplied)}</dd></div>
      <div><dt>Available to claim</dt><dd>{usdc(claimTotal)}</dd></div>
      <button className="primary-button" disabled={claimable.length === 0} onClick={() => setClaiming(true)}>Claim</button>
    </dl>
    <div className="analytics-grid">
      <section className="chart-panel">
        <header className="panel-heading"><div><h2>Portfolio value</h2><p>Your account value over time.</p></div><div className="range-toggle">{["30D","90D","1Y"].map((item) => <button className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item}</button>)}</div></header>
        <PortfolioChart series={series} />
        <div className="chart-legend"><span>Actual</span><span className="projected">Projected</span></div>
      </section>
      <section className="allocation-panel">
        <header className="panel-heading"><div><h2>Allocation</h2><p>Share of your current portfolio value.</p></div></header>
        {positions.map(({ facility, value: amount }) => <div className="allocation-row" key={facility.id}>
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
            <span>{facility.name}</span>
            <span>{usdc(facility.supplied)}</span>
            <span className={amount < facility.supplied ? "negative" : ""}>{usdc(amount)}</span>
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
        <div><dt>Capital supplied</dt><dd>{usdc(claimPrincipal)}</dd></div>
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
