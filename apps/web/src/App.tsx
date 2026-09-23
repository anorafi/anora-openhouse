import { useMemo, useState } from "react";
import type { Address } from "viem";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Markets, type Market } from "./components/Markets";
import { Landing } from "./components/Landing";
import { Activity, Opportunity, Portfolio } from "./components/InvestorPages";
import { FacilityDetail, OpenFacility, OriginatorActivity, OriginatorFacilities } from "./components/OriginatorPages";
import { NotDeployed } from "./components/NotDeployed";
import { Risk } from "./components/Risk";
import { useDeployment } from "./hooks/useDeployment";
import { BookProvider, facilityAsMarket, isMine, useBook } from "./state/book";

export type Role = "investor" | "originator";
export type Page =
  | "home" | "markets" | "opportunity" | "portfolio" | "activity"
  | "facilities" | "open-facility" | "facility" | "ops";

const PAGES: Page[] = ["home", "markets", "opportunity", "portfolio", "activity", "facilities", "open-facility", "facility", "ops"];

/** Where each role lands when the switcher flips. */
const ROLE_HOME: Record<Role, Page> = { investor: "markets", originator: "facilities" };

export function App() {
  return <BookProvider><Shell /></BookProvider>;
}

function Shell() {
  const deployment = useDeployment();
  const { facilities, events, symbol, me, approve, supply, claim } = useBook();
  const initialPage = window.location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(PAGES.includes(initialPage) ? initialPage : "home");
  const [role, setRole] = useState<Role>("investor");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<Address | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const selected = facilities.find((facility) => facility.id === selectedId);
  const managed = facilities.find((facility) => facility.id === manageId);

  const mine = useMemo(() => new Set(facilities.filter((facility) => isMine(facility, me)).map((facility) => facility.id)), [facilities, me]);
  const held = useMemo(() => new Set(events.filter((event) => !!me && event.provider?.toLowerCase() === me.toLowerCase()).map((event) => event.facilityId)), [events, me]);
  const investorEvents = events.filter((event) =>
    (!!me && event.provider?.toLowerCase() === me.toLowerCase()) ||
    (held.has(event.facilityId) && (event.actor === "Keeper" || event.event === "Principal and fees repaid" || event.event === "Payment remitted")));
  const originatorEvents = events.filter((event) => mine.has(event.facilityId) && event.actor !== "Investor");

  const navigate = (next: Page) => {
    setPage(next);
    window.location.hash = next;
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const switchRole = (next: Role) => {
    setRole(next);
    navigate(ROLE_HOME[next]);
  };

  const review = (market: Market) => {
    setSelectedId(market.id);
    navigate("opportunity");
  };

  if (page === "home") return <div className="app"><Landing onNavigate={navigate} /></div>;

  return (
    <div className="app shell">
      <Sidebar role={role} page={page} onRole={switchRole} onNavigate={navigate} onHome={() => navigate("home")} />
      <div className="shell-main">
        <Header />
        <main className="main">
          {!deployment ? <NotDeployed /> : <>
            {page === "markets" && <Markets onReview={review} />}
            {page === "opportunity" && (selected
              ? <Opportunity
                key={selected.id}
                market={facilityAsMarket(selected, symbol)}
                onBack={() => navigate("markets")}
                onApprove={(amount) => approve(selected.id, amount)}
                onSupply={(amount) => supply(selected.id, amount)}
                onDone={() => { navigate("portfolio"); setNotice("Capital supplied successfully."); }}
              />
              : <p className="empty-state">Choose a facility from Markets.</p>)}
            {page === "portfolio" && <Portfolio
              notice={notice}
              live={facilities.filter((facility) => facility.holding.value > 0)}
              onClaim={async (id) => { await claim(id); setNotice("Principal and return claimed."); }}
              onView={(id) => { const facility = facilities.find((item) => item.id === id); if (facility) review(facilityAsMarket(facility, symbol)); }}
              onActivity={() => navigate("activity")}
            />}
            {page === "facilities" && <OriginatorFacilities
              onOpen={() => navigate("open-facility")}
              onManage={(id) => { setManageId(id); navigate("facility"); }}
            />}
            {page === "open-facility" && <OpenFacility onOpened={() => navigate("facilities")} />}
            {page === "facility" && (managed
              ? <FacilityDetail key={managed.id} facility={managed} onBack={() => navigate("facilities")} />
              : <p className="empty-state">That facility is no longer available.</p>)}
            {page === "activity" && (role === "originator"
              ? <OriginatorActivity events={originatorEvents} />
              : <Activity events={investorEvents} />)}
            {page === "ops" && <Risk />}
          </>}
        </main>
      </div>
    </div>
  );
}
