import { MarketCard, type Market } from "./Markets";
import { facilityAsMarket, useDemo } from "../state/demo";

const FEATURES = [
  {
    title: "Isolated by construction",
    symbol: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    body: "Every facility is its own vault, with its own tranches and capital.\nA default in one facility never touches another.",
  },
  {
    title: "First-loss absorbs first",
    symbol: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z",
    body: "The originator stakes first-loss capital before drawing liquidity, and losses hit that stake before any supplied position.",
  },
  {
    title: "Onchain default and recovery",
    symbol: "M20 7h-8M16 3l4 4-4 4M4 17h8M8 13l-4 4 4 4",
    body: "Default is declared by a risk agent with the reason recorded onchain, and recoveries flow back to positions in tranche order.",
  },
];

const STEPS = [
  ["Choose a facility", "Compare the trade, duration, target return, and protection reserve."],
  ["Supply capital", "Fund the opportunity you choose through its dedicated facility."],
  ["Follow the trade", "Track funding, drawdown, and repayment in your portfolio."],
  ["Claim repayment", "Receive principal and return when repayment becomes available."],
];

export function Landing({ onExplore, onMarket, onOriginator }: { onExplore: () => void; onMarket: (market: Market) => void; onOriginator: () => void }) {
  const { facilities } = useDemo();
  const origins = new Set<string>();
  const featured = facilities.filter((facility) => {
    const origin = facility.route.split("→")[0].trim();
    if (origins.has(origin)) return false;
    origins.add(origin);
    return true;
  }).slice(0, 3).map(facilityAsMarket);
  return <>
    <section className="landing-page">
    <div className="landing-card">
      <div className="landing-intro">
        <span className="landing-brand">Anora</span>
        <h1>Credit rails for global trade.</h1>
        <p>
          Anora provides <strong className="yield-highlight">trade-backed yield</strong> by routing capital to trade-finance originators through
          programmable credit pools.
        </p>
        <div className="landing-actions">
          <button className="landing-primary" onClick={onExplore}>Explore markets</button>
        </div>
      </div>
      <div className="landing-features">
        {FEATURES.map((feature) => <article className="landing-feature" key={feature.title}>
          <h2><svg className="feature-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={feature.symbol} /></svg>{feature.title}</h2>
          <p>{feature.body}</p>
        </article>)}
      </div>
    </div>
  </section>
    <div className="public-home">
    <main>
      <section id="how-it-works" className="home-section"><h2>A clear path for your capital.</h2><div className="home-steps">{STEPS.map(([title, body], index) => <article key={title}><span className="home-step-number">0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
      <section className="home-section"><div className="home-section-heading"><div><h2>Trade globally. Isolated facilities.</h2></div><button className="text-button" onClick={onExplore}>All markets →</button></div><div className="home-featured">{featured.map((market) => <MarketCard key={market.name} market={market} onReview={(selected) => selected.action === "View market" ? onMarket(selected) : onExplore()} />)}</div>{!featured.length && <p>No facilities currently accepting capital. Explore markets to see their progress.</p>}</section>
      <section className="home-protection home-section"><div><h2>A defined order of loss.</h2><p>Anora's contracts separate capital into Senior and Junior tranches, backed by<br />an originator's first-loss reserve. Each facility keeps its own capital and risk.</p><p>Losses move through the layers below. Recoveries restore Senior first, then Junior, then the originator reserve.</p></div><div className="home-loss-order"><div tabIndex={0}><svg className="protection-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /></svg><strong>Originator reserve</strong><p>The first-loss stake absorbs losses before either investor tranche.</p></div><div tabIndex={0}><svg className="protection-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 12 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5" /></svg><strong>Junior tranche</strong><p>Absorbs remaining losses once the originator reserve is exhausted.</p></div><div tabIndex={0}><svg className="protection-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 15 8-8 8 8M4 21h16M12 7V3" /></svg><strong>Senior tranche</strong><p>Absorbs losses only after the reserve and Junior capital are exhausted.</p></div><small>Protection is limited, not a guarantee. Capital can be lost and withdrawals may be delayed.</small></div></section>
      <section className="home-originator">
        <div className="originator-invitation">
          <h2>Bring your next trade<br />to Anora.</h2>
          <p>Anora is designed to work with institutional lending platforms that meet rigorous underwriting, operational, and risk management standards.</p>
          <div className="originator-action">
          <button className="secondary-button originator-apply" aria-describedby="originator-demo-note" onClick={onOriginator}>Apply as an originator <span aria-hidden="true">→</span></button>
          <small id="originator-demo-note">Demo starts after acceptance. This opens an approved originator’s workspace; no application is submitted.</small>
          </div>
        </div>
        <div className="originator-diligence">
          <h3>Before joining Anora</h3>
          <p>Proposed due diligence covers:</p>
          <div className="diligence-items">{[
            ["Historical performance", "Review repayment history, defaults, and recoveries across lending cycles to assess consistency and resilience."],
            ["Credit processes", "Assess underwriting criteria, borrower verification, approval controls, and ongoing risk monitoring."],
            ["Servicing capabilities", "Evaluate payment collection, reporting, arrears management, and recovery procedures."],
            ["Legal structure", "Review the lending entity, contractual rights, enforceability, and applicable compliance requirements."],
            ["Portfolio quality", "Assess borrower concentration, asset quality, and exposure by sector and geography."],
          ].map(([title, description]) => <details key={title}><summary>{title}<span aria-hidden="true">+</span></summary><p>{description}</p></details>)}</div>
        </div>
      </section>
    </main>
    <footer className="home-footer"><strong>Anora</strong><span>Yield backed by real trade</span><small>Demo preview · not an offer of investment</small></footer>
  </div></>;
}
