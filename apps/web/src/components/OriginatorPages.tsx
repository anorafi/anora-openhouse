import { TokenAmount } from "./TokenAmount";
import { useMemo, useState, type CSSProperties } from "react";
import { AmountInput } from "./AmountInput";
import { FilterBar, presentOptions } from "./FilterBar";
import { fundingState, DEFAULT_STAGES, ORIGINATOR_ACTION, STAGE_LABEL, eventTime, owedOn, suggestedRecovery, waterfallOf, randomDraft, useDemo, type DemoEvent, type Facility, type Stage } from "../state/demo";

/** Protocol-level floor, mirroring minFirstLossBps on the factory. */
const MIN_FIRST_LOSS_BPS = 1_000;

const usd = (value: number) => `${Math.round(value).toLocaleString()} USD`;
const toNumber = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;

const LIFECYCLE: Array<{ stage: Stage; label: string; by: string }> = [
  { stage: "open", label: "Opened and staked", by: "Originator" },
  { stage: "funded", label: "Capital supplied", by: "Capital provider" },
  { stage: "drawn", label: "Liquidity drawn", by: "Originator" },
  { stage: "repaid", label: "Principal and fees repaid", by: "Originator" },
];

const ORDER: Stage[] = ["open", "funded", "drawn", "repaid"];

/** The exceptional path. No role acts it out; the protocol records it. */
const DEFAULT_LIFECYCLE: Array<{ label: string; by: string }> = [
  { label: "Opened and staked", by: "Originator" },
  { label: "Capital supplied", by: "Capital provider" },
  { label: "Liquidity drawn", by: "Originator" },
  { label: "Marked late, drawdowns stopped", by: "Keeper, permissionless" },
  { label: "Default declared after grace", by: "Risk agent" },
  { label: "Recoveries remitted in full", by: "Originator" },
];
/** How far along the default path each stage sits. */
const DEFAULT_INDEX: Record<string, number> = { defaulted: 5, recovered: 6, closed: 6 };

function hintFor(stage: Stage) {
  switch (stage) {
    case "open": return "Listed in Markets. Waiting on capital providers to supply.";
    case "funded": return "Capital is in. Draw liquidity against the facility.";
    case "drawn": return "Repay principal plus the financing fee to close the facility.";
    case "repaid": return "Repayment complete. This facility is finished on your side.";
    case "settled": return "Complete. Thanks for using Anora.";
    case "defaulted": return "Default declared. Remit recoveries as they come in until the balance is cleared.";
    case "recovered": return "Balance cleared. The capital provider can now claim.";
    case "closed": return "Closed. Principal and return have been claimed.";
  }
}

/* ---- My facilities ------------------------------------------------------ */

const TYPE_ORDER = ["Export receivables", "Supply-chain finance", "Commodity finance"];
/** Stage order, so the Status list reads down the lifecycle. */
const STAGE_ORDER: Stage[] = ["open", "funded", "drawn", "repaid", "settled", "defaulted", "recovered", "closed"];
const DURATIONS: Array<{ label: string; holds: (facility: Facility) => boolean }> = [
  { label: "All", holds: () => true },
  { label: "Up to 60 days", holds: (facility) => facility.durationDays <= 60 },
  { label: "61 to 90 days", holds: (facility) => facility.durationDays > 60 && facility.durationDays <= 90 },
  { label: "Over 90 days", holds: (facility) => facility.durationDays > 90 },
];

export function OriginatorFacilities({ onManage, onOpen }: { onManage: (id: string) => void; onOpen: () => void }) {
  const { facilities } = useDemo();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [duration, setDuration] = useState("All");
  const [status, setStatus] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");

  // Options come from the book itself, so a filter can never offer a value
  // that matches nothing.
  const types = useMemo(() => presentOptions(facilities, TYPE_ORDER, (facility) => facility.type), [facilities]);
  const statuses = useMemo(
    () => presentOptions(facilities, STAGE_ORDER.map((stage) => STAGE_LABEL[stage]), (facility) => STAGE_LABEL[facility.stage]),
    [facilities],
  );
  const held = DURATIONS.find((item) => item.label === duration) ?? DURATIONS[0];
  const visible = useMemo(() => facilities.filter((facility) =>
    `${facility.name} ${facility.company} ${facility.route}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (type === "All" || facility.type === type) &&
    (status === "All" || STAGE_LABEL[facility.stage] === status) &&
    held.holds(facility)
  ), [facilities, held, query, status, type]);
  const committed = facilities.reduce((sum, f) => sum + f.limit, 0);
  const staked = facilities.reduce((sum, f) => sum + f.firstLoss, 0);
  const outstanding = facilities.filter((f) => f.stage === "drawn").reduce((sum, f) => sum + owedOn(f), 0);

  return <section className="originator-page">
    <div className="page-title"><h1>My facilities</h1><p>Every facility is isolated. Nothing here transfers between them.</p></div>

    <dl className="market-summary">
      <div><dt>Facilities</dt><dd>{facilities.length}</dd></div>
      <div><dt>Credit committed</dt><dd>{usd(committed)}</dd></div>
      <div><dt>First-loss staked</dt><dd>{usd(staked)}</dd></div>
      <div><dt>Outstanding</dt><dd>{usd(outstanding)}</dd></div>
    </dl>

    <div className="markets-heading">
      <div><h2>Facilities</h2><p>Open, draw, and repay from here.</p></div>
      <div className="originator-heading-actions">
        <div className="view-toggle" aria-label="View"><button className={view === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setView("grid")}>▦</button><button className={view === "list" ? "active" : ""} aria-label="List view" onClick={() => setView("list")}>☷</button></div>
        <button className="accent-button" onClick={onOpen}>Open a facility</button>
      </div>
    </div>

    <FilterBar
      query={query}
      onQuery={setQuery}
      placeholder="Search facility, buyer, or route…"
      filters={[
        { label: "Type", value: type, options: types, onChange: setType },
        { label: "Duration", value: duration, options: DURATIONS.map((item) => item.label), onChange: setDuration },
        { label: "Status", value: status, options: statuses, onChange: setStatus },
      ]}
    />

    {facilities.length === 0
      ? <p className="empty-state">No facilities yet. Open one to list it for capital providers.</p>
      : visible.length === 0
        ? <p className="empty-state">No facilities match these filters.</p>
        : view === "grid"
          ? <div className="facility-grid">{visible.map((facility) => <FacilityCard key={facility.id} facility={facility} onManage={() => onManage(facility.id)} />)}</div>
          : <div className="market-list facility-list">
              <div className="facility-list-head" aria-hidden="true"><span>Facility</span><span>Type</span><span>Route</span><span>Company</span><span>Credit limit</span><span>Supplied</span><span>Drawn / owed</span><span>Reserve</span><span /></div>
              {visible.map((facility) => <FacilityListRow key={facility.id} facility={facility} onManage={() => onManage(facility.id)} />)}
            </div>}
  </section>;
}

function FacilityListRow({ facility, onManage }: { facility: Facility; onManage: () => void }) {
  const usd = (value: number) => `${Math.round(value).toLocaleString()} ${facility.asset}`;
  const action = ORIGINATOR_ACTION[facility.stage];
  const ratio = (value: number) => facility.limit > 0 ? Math.round((value / facility.limit) * 100) : 0;
  const RatioCell = ({ value, kind }: { value: number; kind: "supplied" | "owed" | "reserve" }) => {
    const percentage = ratio(value);
    if (kind === "owed") return <div className={`list-ratio list-ratio-owed ${percentage > 100 ? "over" : ""}`} title={usd(value)} aria-label={`${usd(value)}, ${percentage}% of credit limit`}><strong><TokenAmount value={value} asset={facility.asset} /></strong><progress max="100" value={Math.min(100, Math.max(0, percentage))}>{percentage}%</progress></div>;
    if (kind === "reserve") return <div className="list-ratio list-ratio-reserve" title={usd(value)} aria-label={`${percentage}% reserve, ${usd(value)}`}><strong>{percentage}%</strong><span className="reserve-mark" style={{ "--reserve": `${Math.min(100, Math.max(0, percentage))}%` } as CSSProperties} /></div>;
    return <div className="list-ratio list-ratio-supplied" title={usd(value)} aria-label={`${percentage}% supplied, ${usd(value)}`}><strong>{percentage}%</strong><progress max="100" value={Math.min(100, Math.max(0, percentage))}>{percentage}%</progress></div>;
  };
  return <article className={`facility-list-row status-${facility.stage}`}>
    <div className="list-name"><strong>{facility.name}</strong><span className={`market-status ${facility.stage}`}><i />{STAGE_LABEL[facility.stage]}</span></div>
    <span>{facility.type} · {facility.asset}</span><span>{facility.route}</span><span>{facility.company}</span><strong><TokenAmount value={facility.limit} asset={facility.asset} /></strong><RatioCell value={facility.supplied} kind="supplied" /><RatioCell value={lastValue(facility)} kind="owed" /><RatioCell value={facility.firstLoss} kind="reserve" />
    <button className={action ? "list-action primary" : "list-action"} onClick={onManage}>{action ?? "Manage"}</button>
  </article>;
}

/** The fourth figure tracks whatever matters most at this stage. */
function lastLabel(facility: Facility) {
  if (facility.stage === "repaid" || facility.stage === "settled") return "Repaid";
  if (facility.recovered > 0) return "Recovered";
  return facility.stage === "drawn" || facility.stage === "defaulted" ? "Owed" : "Drawn";
}
function lastValue(facility: Facility) {
  if (facility.stage === "repaid" || facility.stage === "settled") return facility.repaid;
  if (facility.recovered > 0) return facility.recovered;
  return facility.stage === "drawn" || facility.stage === "defaulted" ? owedOn(facility) : facility.drawn;
}

function FacilityCard({ facility, onManage }: { facility: Facility; onManage: () => void }) {
  const action = ORIGINATOR_ACTION[facility.stage];
  return <article
    className={`facility-row status-${facility.stage}`}
    role="button"
    tabIndex={0}
    onClick={onManage}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onManage(); } }}
  >
    <div className="card-intro">
      <header>
        <div><h3>{facility.name}</h3><p><span>{facility.type}</span><span>{facility.route}</span></p></div>
        <span className={`market-status ${facility.stage}`}><i />{STAGE_LABEL[facility.stage]}</span>
      </header>
      <p className="market-company"><span aria-hidden="true">{facility.icon}</span>{facility.company}</p>
    </div>
    <dl className="facility-figures">
      <div><dt>Credit limit</dt><dd><TokenAmount value={facility.limit} asset={facility.asset} /></dd></div>
      <div><dt>First-loss</dt><dd><TokenAmount value={facility.firstLoss} asset={facility.asset} /></dd></div>
      <div><dt>Total supplied</dt><dd><TokenAmount value={facility.supplied} asset={facility.asset} /></dd></div>
      <div><dt>{lastLabel(facility)}</dt><dd><TokenAmount value={lastValue(facility)} asset={facility.asset} /></dd></div>
    </dl>
    <footer>
      <button className={action ? "accent-button" : "secondary-button"} onClick={(event) => { event.stopPropagation(); onManage(); }}>{action ?? "Manage"}</button>
    </footer>
  </article>;
}

/* ---- Facility detail ---------------------------------------------------- */

export function FacilityDetail({ facility, onBack }: { facility: Facility; onBack: () => void }) {
  const usd = (value: number) => `${Math.round(value).toLocaleString()} ${facility.asset}`;
  const { draw, repay, recover } = useDemo();
  const [reviewing, setReviewing] = useState(false);
  const [recovery, setRecovery] = useState(() => String(suggestedRecovery(facility)));
  const outstanding = Math.max(0, owedOn(facility) - facility.recovered);
  const payment = Math.min(toNumber(recovery), outstanding);
  const clearsBalance = payment >= outstanding - 0.5 && outstanding > 0;
  const action = ORIGINATOR_ACTION[facility.stage];
  const onDefaultPath = DEFAULT_STAGES.includes(facility.stage);
  // Preview the waterfall against the amount being remitted, not the stored one.
  // Preview against the payment being made, not the amount already banked.
  const flow = waterfallOf(facility.stage === "defaulted" ? { ...facility, recovered: facility.recovered + payment } : facility);
  const drawable = Math.min(facility.supplied, facility.limit);
  const owed = owedOn(facility);
  const currentIndex = facility.stage === "settled" ? ORDER.length : ORDER.indexOf(facility.stage);

  return <section className="opportunity-page">
    <button className="back-link" onClick={onBack}><span aria-hidden="true">←</span> Back to My facilities</button>
    <header className="opportunity-heading"><div>
      <div className="title-with-status"><h1>{facility.name}</h1><span className={`market-status ${facility.stage}`}><i />{STAGE_LABEL[facility.stage]}</span></div>
      <p>{facility.type} · {facility.route}</p><span>{facility.company}</span>
    </div></header>

    <div className="opportunity-layout">
      <aside className="supply-panel">
        {!action && !onDefaultPath && (facility.stage === "repaid" || facility.stage === "settled"
          ? <div className="flow-done" role="status">
            <span className="flow-done-mark" aria-hidden="true">✓</span>
            <h2>Facility complete</h2>
            <p className="panel-copy">Principal and fees were repaid successfully.</p>
            <p className="completion-thanks">Thanks for financing trade with Anora.</p>
          </div>
          : <>
            <h2>Waiting on capital</h2>
            <p className="panel-copy">{hintFor(facility.stage)}</p>
          </>)}

        {facility.stage === "defaulted" && !reviewing && <>
          <h2>Remit recoveries</h2>
          <p className="panel-copy">Pay in what you have collected. Remit again as more comes in, until the balance is cleared.</p>
          <div className="detail-section">
            <header><strong>Collected</strong><span><TokenAmount value={facility.recovered} asset={facility.asset} /> of <TokenAmount value={flow.owed} asset={facility.asset} /></span></header>
            <progress className="accent-progress" max={Math.round(flow.owed)} value={Math.round(facility.recovered)} />
          </div>
          <label>This payment<AmountInput value={recovery} onChange={setRecovery} suffix={facility.asset} action={<button onClick={() => setRecovery(String(Math.round(outstanding)))}>Rest</button>} /></label>
          <dl className="supply-totals">
            <div><dt>Still outstanding</dt><dd><TokenAmount value={outstanding} asset={facility.asset} /></dd></div>
            <div><dt>After this payment</dt><dd className={flow.shortfall > 0 ? "negative" : "positive"}><TokenAmount value={flow.shortfall} asset={facility.asset} /></dd></div>
          </dl>
          <button className="accent-button wide" disabled={payment <= 0} onClick={() => setReviewing(true)}>Review</button>
          <small>{clearsBalance
            ? "This clears the balance in full and the capital provider can claim."
            : "Part payments are recorded against the facility. Remit again until the balance is cleared."}</small>
        </>}

        {facility.stage === "defaulted" && reviewing && <>
          <h2>Review</h2>
          <p className="panel-copy">{clearsBalance
            ? "This covers the balance in full, so the capital provider can claim principal and return."
            : "This payment is recorded against the facility. Remit again as more is collected."}</p>
          <dl className="review-list">
            <div><dt>Owed at maturity</dt><dd><TokenAmount value={flow.owed} asset={facility.asset} /></dd></div>
            <div><dt>Already collected</dt><dd><TokenAmount value={facility.recovered} asset={facility.asset} /></dd></div>
            <div><dt>This payment</dt><dd><TokenAmount value={payment} asset={facility.asset} /></dd></div>
            <div><dt>Collected after this</dt><dd><TokenAmount value={flow.recovered} asset={facility.asset} /></dd></div>
            <div><dt>Still outstanding</dt><dd className={flow.shortfall > 0 ? "negative" : "positive"}><TokenAmount value={flow.shortfall} asset={facility.asset} /></dd></div>
            <div><dt>First-loss cover</dt><dd><TokenAmount value={facility.firstLoss} asset={facility.asset} /></dd></div>
          </dl>
          <div className="review-actions">
            <button className="secondary-button" onClick={() => setReviewing(false)}>Back</button>
            <button className="primary-button" onClick={() => { recover(facility.id, payment); setReviewing(false); setRecovery(String(Math.round(outstanding - payment))); }}>Remit</button>
          </div>
          <small>Your first-loss stake stands behind the balance until it is cleared.</small>
        </>}

        {(facility.stage === "recovered" || facility.stage === "closed") && <>
          <h2>Balance cleared</h2>
          <p className="panel-copy">{hintFor(facility.stage)}</p>
          <dl className="review-list">
            <div><dt>Owed at maturity</dt><dd><TokenAmount value={flow.owed} asset={facility.asset} /></dd></div>
            <div><dt>Recovered</dt><dd><TokenAmount value={flow.recovered} asset={facility.asset} /></dd></div>
            <div><dt>Still outstanding</dt><dd className={flow.shortfall > 0 ? "negative" : "positive"}><TokenAmount value={flow.shortfall} asset={facility.asset} /></dd></div>
            <div><dt>Available to the capital provider</dt><dd><TokenAmount value={flow.supplierProceeds} asset={facility.asset} /></dd></div>
            <div><dt>First-loss drawn</dt><dd>{Math.round(flow.reserveApplied).toLocaleString()} / {usd(facility.firstLoss)}</dd></div>
          </dl>
          <small>You cleared the balance, so your first-loss stake was never drawn.</small>
        </>}

        {action && !onDefaultPath && !reviewing && <>
          <h2>{facility.stage === "funded" ? "Draw liquidity" : "Repay facility"}</h2>
          <p className="panel-copy">{facility.stage === "funded"
            ? "Draw against the capital supplied to this facility."
            : `Repay principal plus the ${facility.targetReturn}% financing fee.`}</p>
          <dl className="supply-totals">
            {facility.stage === "funded"
              ? <><div><dt>Available to draw</dt><dd><TokenAmount value={drawable} asset={facility.asset} /></dd></div><div><dt>Credit limit</dt><dd><TokenAmount value={facility.limit} asset={facility.asset} /></dd></div></>
              : <><div><dt>Principal drawn</dt><dd><TokenAmount value={facility.drawn} asset={facility.asset} /></dd></div><div><dt>Financing fee</dt><dd><TokenAmount value={owed - facility.drawn} asset={facility.asset} /></dd></div></>}
          </dl>
          <button className="accent-button wide" onClick={() => setReviewing(true)}>Review {facility.stage === "funded" ? "drawdown" : "repayment"}</button>
          <small>You will confirm each transaction in your wallet.</small>
        </>}

        {action && !onDefaultPath && reviewing && <>
          <h2>Review {facility.stage === "funded" ? "drawdown" : "repayment"}</h2>
          <p className="panel-copy">Confirm the details before signing.</p>
          <dl className="review-list">
            <div><dt>Facility</dt><dd>{facility.name}</dd></div>
            {facility.stage === "funded"
              ? <><div><dt>Draw</dt><dd><TokenAmount value={drawable} asset={facility.asset} /></dd></div><div><dt>Duration</dt><dd>{facility.durationDays} days</dd></div><div><dt>Due at maturity</dt><dd><TokenAmount value={drawable * (1 + facility.targetReturn / 100)} asset={facility.asset} /></dd></div></>
              : <><div><dt>Principal</dt><dd><TokenAmount value={facility.drawn} asset={facility.asset} /></dd></div><div><dt>Financing fee</dt><dd className="positive"><TokenAmount value={owed - facility.drawn} asset={facility.asset} /></dd></div><div><dt>Total repayment</dt><dd><TokenAmount value={owed} asset={facility.asset} /></dd></div></>}
            <div><dt>First-loss at risk</dt><dd><TokenAmount value={facility.firstLoss} asset={facility.asset} /></dd></div>
          </dl>
          <div className="review-actions">
            <button className="secondary-button" onClick={() => setReviewing(false)}>Back</button>
            <button className="primary-button" onClick={() => { facility.stage === "funded" ? draw(facility.id) : repay(facility.id); setReviewing(false); }}>
              {facility.stage === "funded" ? "Draw liquidity" : "Repay now"}
            </button>
          </div>
        </>}
      </aside>

      <section className="market-detail-panel">
        <dl className="opportunity-metrics">
          <div><dt>Credit limit</dt><dd><TokenAmount value={facility.limit} asset={facility.asset} /></dd></div>
          <div><dt>Capital supplied</dt><dd><TokenAmount value={facility.supplied} asset={facility.asset} /></dd></div>
          <div><dt>Target return</dt><dd>{facility.targetReturn}%</dd></div>
          <div><dt>Protection reserve</dt><dd>{facility.reservePct.toFixed(1)}%</dd></div>
        </dl>

        <div className="detail-section">
          <header><strong>Funding</strong><span>{fundingState(facility).label}</span></header>
          {fundingState(facility).accepting && <progress className="accent-progress" max={facility.limit} value={facility.supplied} />}
        </div>

        <div className="detail-section">
          <h2>Lifecycle</h2>
          <ol className="lifecycle">
            {DEFAULT_STAGES.includes(facility.stage)
              ? DEFAULT_LIFECYCLE.map((step, index) => <li key={step.label} className={index < DEFAULT_INDEX[facility.stage] ? "complete" : index === DEFAULT_INDEX[facility.stage] ? "active" : ""}>
                <span className="lifecycle-dot" aria-hidden="true" />
                <div><strong>{step.label}</strong><small>{step.by}</small></div>
              </li>)
              : LIFECYCLE.map((step, index) => <li key={step.stage} className={index < currentIndex ? "complete" : index === currentIndex ? "active" : ""}>
                <span className="lifecycle-dot" aria-hidden="true" />
                <div><strong>{step.label}</strong><small>{step.by}</small></div>
              </li>)}
          </ol>
        </div>
      </section>
    </div>
  </section>;
}

/* ---- Originator activity ------------------------------------------------ */

const ORIGINATOR_FILTERS = ["All", "Facilities", "Drawdowns", "Repayments", "Credit"] as const;

function bucketFor(event: DemoEvent) {
  if (event.actor === "Keeper") return "Credit";
  if (event.event.includes("drawn")) return "Drawdowns";
  if (event.event.includes("repaid")) return "Repayments";
  return "Facilities";
}

export function OriginatorActivity({ events }: { events: DemoEvent[] }) {
  const [filter, setFilter] = useState<string>("All");
  // Only this originator's own ledger entries, not the capital provider's.
  // Keeper entries are protocol-level but land on this originator's facilities.
  const mine = events.filter((event) => event.actor === "Originator" || event.actor === "Keeper");
  const visible = mine.filter((event) => filter === "All" || bucketFor(event) === filter);

  return <section className="activity-page">
    <div className="page-title"><h1>Facility ledger</h1><p>Openings, drawdowns, and repayments across your facilities.</p></div>
    <div className="activity-filters">
      {ORIGINATOR_FILTERS.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
    </div>
    <div className="activity-table">
      <div className="table-head"><span>Time</span><span>Event</span><span>Facility</span><span>Amount</span><span>Type</span><span /></div>
      {visible.length === 0
        ? <p className="empty-state">Nothing recorded yet. Open a facility to start the ledger.</p>
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

/* ---- Open a facility ---------------------------------------------------- */

/** Each step is a distinct act, named by the one still pending. */
type OpenPhase = "clone" | "lock" | "list" | "done";
const OPEN_ORDER: OpenPhase[] = ["clone", "lock", "list"];
const OPEN_CTA: Record<OpenPhase, string> = {
  clone: "Clone isolated facility",
  lock: "Lock first-loss stake",
  list: "List in Markets",
  done: "",
};

function LockIcon() {
  return <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="2.7" y="6.3" width="8.6" height="6" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4.9 6.3V4.7a2.1 2.1 0 0 1 4.2 0v1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>;
}

export function OpenFacility({ onOpened }: { onOpened: () => void }) {
  const { createFacility, facilities } = useDemo();
  // Fresh terms each time the page opens, drawn from Asian trade corridors and
  // skipping corridors already on the book.
  const [form, setForm] = useState(() => randomDraft(facilities.map((facility) => facility.name)));
  const usd = (value: number) => `${Math.round(value).toLocaleString()} ${form.asset}`;
  const [phase, setPhase] = useState<OpenPhase>("clone");
  // Terms are fixed once the first step runs, so the steps below describe the
  // facility that is actually being created.
  const started = phase !== "clone";
  const stepIndex = phase === "done" ? OPEN_ORDER.length : OPEN_ORDER.indexOf(phase);
  const stepClass = (index: number) => (index < stepIndex ? "complete" : index === stepIndex ? "active" : "");

  const set = (key: keyof typeof form) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const limitValue = toNumber(form.limit);
  const firstLossValue = toNumber(form.firstLoss);
  const minFirstLoss = (limitValue * MIN_FIRST_LOSS_BPS) / 10_000;
  const meetsFloor = firstLossValue >= minFirstLoss && firstLossValue > 0;
  const canOpen = form.name.trim() !== "" && form.company.trim() !== "" && limitValue > 0 && meetsFloor;

  return <section className="originator-page">
    <div className="page-title"><h1>Open a facility</h1><p>Stake first-loss capital up front. It absorbs losses before any supplied position.</p></div>

    <div className="open-layout">
      <aside className="supply-panel">
        {phase === "done" ? <div className="flow-done" role="status">
          <span className="flow-done-mark" aria-hidden="true">✓</span>
          <h2>Listed in Markets</h2>
          <p className="panel-copy">{form.name} is live with {usd(firstLossValue)} of first-loss staked.</p>
          <dl className="review-list">
            <div><dt>Credit limit</dt><dd><TokenAmount value={limitValue} asset={form.asset} /></dd></div>
            <div><dt>First-loss stake</dt><dd><TokenAmount value={firstLossValue} asset={form.asset} /></dd></div>
            <div><dt>Target return</dt><dd>{form.targetReturn}%</dd></div>
            <div><dt>Duration</dt><dd>{form.duration} days</dd></div>
          </dl>
          <button className="accent-button wide" onClick={onOpened}>View my facilities</button>
          <small>Switch to the capital provider workspace to supply against it.</small>
        </div> : <>
        <div className="panel-heading">
          <div><h2>Facility terms</h2></div>
          {!started && <button className="text-link" onClick={() => setForm(randomDraft(facilities.map((facility) => facility.name)))}>Regenerate</button>}
        </div>
        <p className="panel-copy">{started ? "Terms are locked while the facility is created." : "Generated terms for a live trade corridor. Adjust anything, or open as-is."}</p>

        <fieldset className="open-fields" disabled={started}>
        <label>Facility name<input value={form.name} onChange={(e) => set("name")(e.target.value)} /></label>
        <label>Originator<input value={form.company} onChange={(e) => set("company")(e.target.value)} /></label>
        <label>Trade route<input value={form.route} onChange={(e) => set("route")(e.target.value)} /></label>
        <label>Financing type
          <select value={form.type} onChange={(e) => set("type")(e.target.value)}>
            <option>Export receivables</option><option>Supply-chain finance</option><option>Commodity finance</option>
          </select>
        </label>
        <label>Asset<select value={form.asset} onChange={(event) => set("asset")(event.target.value)}><option>USDG</option><option>USDC</option></select></label>
        <label>Credit limit<AmountInput value={form.limit} onChange={set("limit")} suffix={form.asset} /></label>
        <label>First-loss stake<AmountInput value={form.firstLoss} onChange={set("firstLoss")} suffix="USDC" action={<button onClick={() => set("firstLoss")(String(Math.ceil(minFirstLoss)))}>Min</button>} /></label>
        <p className="balance-row"><span>Protocol floor ({MIN_FIRST_LOSS_BPS / 100}%)</span><strong><TokenAmount value={minFirstLoss} asset={form.asset} /></strong></p>
        <div className="field-pair">
          <label>Target return<div className="amount-input"><input inputMode="decimal" value={form.targetReturn} onChange={(e) => set("targetReturn")(e.target.value)} /><span>%</span></div></label>
          <label>Duration<div className="amount-input"><input inputMode="numeric" value={form.duration} onChange={(e) => set("duration")(e.target.value.replace(/\D/g, ""))} /><span>days</span></div></label>
        </div>

        </fieldset>

        {!meetsFloor && limitValue > 0 && <p className="facility-warn">First-loss stake is below the {MIN_FIRST_LOSS_BPS / 100}% floor.</p>}

        <button
          className="accent-button wide"
          disabled={!canOpen}
          onClick={() => {
            if (phase === "clone") return setPhase("lock");
            if (phase === "lock") return setPhase("list");
            createFacility({
              icon: form.icon, asset: form.asset as Facility["asset"],
              name: form.name.trim(), company: form.company.trim(), route: form.route.trim(), type: form.type,
              limit: limitValue, firstLoss: firstLossValue,
              targetReturn: toNumber(form.targetReturn), durationDays: toNumber(form.duration) || 90,
            });
            setPhase("done");
          }}
        >{phase === "lock" && <LockIcon />}{OPEN_CTA[phase]}</button>
        <small>{phase === "clone"
          ? "Each step runs on its own. Nothing is listed until the last one."
          : phase === "lock"
            ? `${usd(firstLossValue)} is locked before any capital provider can supply.`
            : "Listing makes the terms visible to capital providers."}</small>
        </>}
      </aside>

      <section className="market-detail-panel">
        <div className="detail-section">
          <h2>{phase === "done" ? "Facility opened" : "Opening this facility"}</h2>
          <ol className="lifecycle">
            <li className={stepClass(0)}><span className="lifecycle-dot" aria-hidden="true" /><div><strong>Clones an isolated facility</strong><small>Its own capital and tranches. Nothing transfers between facilities.</small></div></li>
            <li className={stepClass(1)}><span className="lifecycle-dot" aria-hidden="true" /><div><strong>Locks your first-loss stake</strong><small>{usd(firstLossValue)} absorbs losses before any supplied position.</small></div></li>
            <li className={stepClass(2)}><span className="lifecycle-dot" aria-hidden="true" /><div><strong>Lists it in Markets</strong><small>Capital providers can review terms and supply.</small></div></li>
          </ol>
        </div>
        <div className="detail-section">
          <h2>Terms summary</h2>
          <dl className="detail-list">
            <div><dt>Credit limit</dt><dd><TokenAmount value={limitValue} asset={form.asset} /></dd></div>
            <div><dt>First-loss stake</dt><dd><TokenAmount value={firstLossValue} asset={form.asset} /></dd></div>
            <div><dt>Protection reserve</dt><dd>{limitValue > 0 ? ((firstLossValue / limitValue) * 100).toFixed(1) : "0.0"}%</dd></div>
            <div><dt>Target return</dt><dd>{form.targetReturn}%</dd></div>
            <div><dt>Duration</dt><dd>{form.duration} days</dd></div>
            <div><dt>Owed at maturity</dt><dd><TokenAmount value={limitValue * (1 + toNumber(form.targetReturn) / 100)} asset={form.asset} /></dd></div>
          </dl>
        </div>
      </section>
    </div>
  </section>;
}
