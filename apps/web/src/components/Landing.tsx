import type { Page } from "../App";

const FEATURES = [
  {
    title: "Isolated by construction",
    body: "Every facility is its own vault, with its own tranches and capital. A default in one facility never touches another.",
  },
  {
    title: "First-loss absorbs first",
    body: "The originator stakes first-loss capital before drawing liquidity, and losses hit that stake before any supplied position.",
  },
  {
    title: "Onchain default and recovery",
    body: "Default is declared by a risk agent with the reason recorded onchain, and recoveries flow back to positions in tranche order.",
  },
];

export function Landing({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return <section className="landing-page">
    <div className="landing-card">
      <div className="landing-intro">
        <span className="landing-brand">Anora</span>
        <h1>Credit rails for global trade.</h1>
        <p>
          Anora provides trade-backed yield by routing capital to trade-finance originators through
          programmable credit pools. Every pool is isolated, tranched, and protected by originator
          first-loss capital.
        </p>
        <div className="landing-actions">
          <button className="landing-primary" onClick={() => onNavigate("markets")}>Explore markets</button>
        </div>
      </div>
      <div className="landing-features">
        {FEATURES.map((feature) => <article className="landing-feature" key={feature.title}>
          <h2>{feature.title}</h2>
          <p>{feature.body}</p>
        </article>)}
      </div>
    </div>
  </section>;
}
