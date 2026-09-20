import { useEffect, useRef, useState } from "react";

const portfolioSeries: Record<string, { labels: string[]; values: number[]; actualThrough: number }> = {
  "30D": { labels: ["Today", "10d", "20d", "30d"], values: [300000, 303180, 306420, 309740], actualThrough: 2 },
  "90D": { labels: ["Today", "30d", "60d", "90d"], values: [300000, 309200, 317100, 323840], actualThrough: 2 },
  "1Y": { labels: ["Today", "4m", "8m", "1y"], values: [300000, 317600, 334200, 348920], actualThrough: 2 },
};

function PortfolioChart({ range }: { range: string }) {
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
      const { labels, values, actualThrough } = portfolioSeries[range];
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
  }, [range]);

  return <canvas ref={canvasRef} className="portfolio-chart" role="img" aria-label={`Portfolio value over ${range}: ${portfolioSeries[range].values[portfolioSeries[range].values.length - 1].toLocaleString()} USDC`} />;
}

export function Opportunity({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const [amount, setAmount] = useState("120000");
  const [reviewing, setReviewing] = useState(false);
  const [approved, setApproved] = useState(false);
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [acceptedLiquidity, setAcceptedLiquidity] = useState(false);
  const value = Number(amount || 0);
  const repayment = Math.round(value * 1.021);

  return <section className="opportunity-page">
    <button className="text-button" onClick={onBack}>Markets / <strong>Bandung Tea Export 01</strong></button>
    <header className="opportunity-heading"><div><div className="title-with-status"><h1>Bandung Tea Export 01</h1><span className="market-status open"><i />Open</span></div><p>Verified Indonesian tea export receivables · Indonesia → Singapore</p><span>PT Nusantara Teh Lestari</span></div></header>
    <div className="opportunity-layout">
      <aside className="supply-panel">{reviewing ? <><h2>Review supply</h2><p className="panel-copy">Confirm the details below before supplying capital.</p><dl className="review-list"><div><dt>Supply</dt><dd>{value.toLocaleString()} USDC</dd></div><div><dt>Market</dt><dd>Bandung Tea Export 01</dd></div><div><dt>Target return</dt><dd>8.5%</dd></div><div><dt>Duration</dt><dd>90 days</dd></div><div><dt>Estimated repayment</dt><dd>{repayment.toLocaleString()} USDC</dd></div><div><dt>Estimated return</dt><dd className="positive">{Math.max(0, repayment - value).toLocaleString()} USDC</dd></div><div><dt>Protection reserve</dt><dd>22.8%</dd></div><div><dt>Available afterward</dt><dd>{Math.max(0, 301040 - value).toLocaleString()} USDC</dd></div></dl><div className="supply-steps"><span className={approved ? "complete" : "active"}>1<small>Approve USDC</small></span><span className={approved ? "active" : ""}>2<small>Supply capital</small></span><span>3<small>Position created</small></span></div><label className="review-check"><input type="checkbox" checked={acceptedRisk} onChange={(event) => setAcceptedRisk(event.target.checked)} />Returns depend on buyer repayment.</label><label className="review-check"><input type="checkbox" checked={acceptedLiquidity} onChange={(event) => setAcceptedLiquidity(event.target.checked)} />Withdrawals may be delayed until repayment.</label><div className="review-actions"><button className="secondary-button" onClick={() => { setReviewing(false); setApproved(false); }}>Back</button><button className="primary-button" disabled={!acceptedRisk || !acceptedLiquidity} onClick={() => approved ? onComplete() : setApproved(true)}>{approved ? "Supply capital" : "Approve USDC"}</button></div><small>You will confirm each transaction in your wallet. Anora never takes custody of your wallet.</small></> : <><h2>Supply</h2><p className="panel-copy">Provide capital to earn an 8.5% target return.</p><label>Asset<select><option>USDC</option></select></label><p className="balance-row"><span>Wallet balance</span><strong>250,000 USDC</strong></p><label>Amount<div className="amount-input"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /><span>USDC</span><button onClick={() => setAmount("250000")}>Max</button></div></label><dl className="supply-totals"><div><dt>Estimated repayment</dt><dd>{repayment.toLocaleString()} USDC</dd></div><div><dt>Estimated return</dt><dd>{Math.max(0, repayment - value).toLocaleString()} USDC</dd></div></dl><button className="accent-button wide" disabled={!value} onClick={() => setReviewing(true)}>Review supply →</button><div className="eligibility"><strong>Available to your account</strong><span>Fits your institutional mandate.</span></div><small>Returns depend on repayment. Withdrawals may not be immediately available.</small></>}</aside>
      <section className="market-detail-panel"><dl className="opportunity-metrics"><div><dt>Target return</dt><dd>8.5%</dd></div><div><dt>Available to invest</dt><dd>301,040 USDC</dd></div><div><dt>Duration</dt><dd>90 days</dd></div><div><dt>Protection reserve</dt><dd>22.8%</dd></div></dl><div className="detail-section"><header><strong>Utilization</strong><span>68% utilized</span></header><progress className="accent-progress" max="100" value="68">68%</progress></div><div className="detail-section"><header><strong>Protection before your position</strong><span>22.8% absorbs losses before your capital.</span></header><div className="protection-bar"><span>22.8%</span><span>77.2%</span></div><p>The reserve absorbs losses before your position.</p><button className="text-link">View risk and underwriting →</button></div><div className="detail-section"><h2>Market overview</h2><dl className="detail-list"><div><dt>Financing type</dt><dd>Export receivables</dd></div><div><dt>Settlement asset</dt><dd>USDC</dd></div><div><dt>Repayment</dt><dd>At maturity</dd></div><div><dt>Current state</dt><dd>Funding</dd></div><div><dt>Evidence status</dt><dd>Verified 2 hours ago</dd></div></dl></div><div className="market-lifecycle"><strong>Market lifecycle</strong><ol><li className="complete">Verified</li><li className="active">Funding</li><li>Active</li><li>Repaid</li></ol></div><div className="inline-links"><button>View facility documents →</button><button>View transactions →</button></div></section>
    </div>
  </section>;
}

export function Portfolio({ notice, onView, onActivity }: { notice: string | null; onView: () => void; onActivity: () => void }) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [range, setRange] = useState("90D");
  return <section className="portfolio-page">
    <div className="page-title"><h1>Portfolio</h1><p>Track your capital, returns, and upcoming repayments.</p></div>
    {notice && <p className="success-banner">✓ {notice}</p>}
    <dl className="portfolio-summary"><div><dt>Total supplied</dt><dd>320,000 USDC</dd></div><div><dt>Current value</dt><dd>323,840 USDC</dd></div><div><dt>Earned return</dt><dd>3,840 USDC</dd></div><div><dt>Available to claim</dt><dd>{claimed ? "0 USDC" : "18,500 USDC"}</dd></div><button className="primary-button" disabled={claimed} onClick={() => setClaiming(true)}>{claimed ? "Claimed" : "Claim"}</button></dl>
    <div className="analytics-grid"><section className="chart-panel"><header className="panel-heading"><div><h2>Portfolio value</h2><p>Your account value over time.</p></div><div className="range-toggle">{["30D","90D","1Y"].map((item) => <button className={range === item ? "active" : ""} onClick={() => setRange(item)} key={item}>{item}</button>)}</div></header><PortfolioChart range={range} /><div className="chart-legend"><span>Actual</span><span className="projected">Projected</span></div></section><section className="allocation-panel"><header className="panel-heading"><div><h2>Allocation</h2><p>Share of your current portfolio value.</p></div></header>{[["Bandung Tea Export 01",37.1],["Sumatra Coffee Receivables",34.4],["Thailand Rice Shipment",28.5]].map(([label, pct]) => <div className="allocation-row" key={String(label)}><span>{label}</span><progress max="100" value={Number(pct)} /><strong>{pct}%</strong></div>)}<p className="panel-footnote">Largest position: <strong>37.1%</strong></p></section></div>
    <section className="positions-panel"><header className="panel-heading"><div><h2>Your positions</h2><p>All of your investments in one place.</p></div><button className="text-button" onClick={onActivity}>View activity →</button></header><div className="positions-table"><div className="table-head"><span>Opportunity</span><span>Supplied</span><span>Current value</span><span>Target return</span><span>Repayment</span><span>Status</span><span>Action</span></div>{[["Bandung Tea Export 01","120,000","120,000","8.5%","17 Dec 2026","Funding"],["Sumatra Coffee Receivables","110,000","112,420","9.2%","04 Jan 2027","Active"],["Thailand Rice Shipment","90,000","91,420","7.9%","22 Nov 2026","Active"]].map((row) => <div className="table-row" key={row[0]}>{row.slice(0,6).map((cell, index) => <span key={cell} className={index === 5 ? `market-status ${cell.toLowerCase()}` : ""}>{cell}{index > 0 && index < 3 ? " USDC" : ""}</span>)}<button onClick={onView}>View →</button></div>)}</div></section>
    <div className="portfolio-insights"><section><header className="panel-heading"><div><h2>Upcoming repayments</h2><p>Next repayments across your portfolio.</p></div></header><div className="insight-row"><strong>18,500 USDC</strong><span>22 Nov 2026</span></div><div className="insight-row"><strong>122,520 USDC</strong><span>17 Dec 2026</span></div></section><section><header className="panel-heading"><div><h2>Exposure</h2><p>Your portfolio by originator market.</p></div></header><div className="exposure-row"><span>Indonesia</span><progress max="100" value="71.5" /><strong>71.5%</strong></div><div className="exposure-row"><span>Thailand</span><progress max="100" value="28.5" /><strong>28.5%</strong></div></section><section><header className="panel-heading"><div><h2>Protection coverage</h2><p>Portfolio-level reserve coverage.</p></div></header><div className="insight-row"><span>Weighted reserve</span><strong>21.4%</strong></div><p className="panel-footnote">Capital set aside before your positions absorb losses.</p></section></div>
    <p className="portfolio-disclaimer">Portfolio values are estimates. Returns depend on repayment and available liquidity.</p>
    {claiming && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="claim-title"><button className="modal-close" onClick={() => setClaiming(false)}>×</button><h2 id="claim-title">Claim repayment</h2><p>Move available repayments to your connected wallet.</p><strong className="claim-amount">18,500 USDC</strong><dl className="detail-list"><div><dt>Repaid capital</dt><dd>17,960 USDC</dd></div><div><dt>Earned return</dt><dd>540 USDC</dd></div></dl><button className="primary-button wide" onClick={() => { setClaimed(true); setClaiming(false); }}>Confirm claim</button><button className="secondary-button wide" onClick={() => setClaiming(false)}>Cancel</button></div></div>}
  </section>;
}

export function Activity() {
  const [filter, setFilter] = useState("All");
  const rows = [{ time: "10:24", event: "Supply confirmed", market: "Bandung Tea Export 01", amount: "120,000 USDC", status: "Confirmed", type: "Supplies" },{ time: "10:23", event: "USDC approval", market: "Arbitrum Sepolia", amount: "—", status: "Confirmed", type: "Supplies" },{ time: "18 Sep", event: "Opportunity verified", market: "Bandung Tea Export 01", amount: "—", status: "Recorded", type: "Updates" }];
  return <section className="activity-page"><div className="page-title"><h1>Activity</h1><p>Supplies, repayments, and claims.</p></div><div className="activity-filters">{["All","Supplies","Repayments","Updates"].map((item) => <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><div className="activity-table"><div className="table-head"><span>Time</span><span>Event</span><span>Opportunity / network</span><span>Amount</span><span>Status</span><span /></div>{rows.filter((row) => filter === "All" || row.type === filter).map((row) => <div className="table-row activity-row" key={`${row.time}-${row.event}`}><span>{row.time}</span><strong>{row.event}</strong><span>{row.market}</span><span>{row.amount}</span><span className="market-status active">{row.status}</span><button>View →</button></div>)}</div></section>;
}
