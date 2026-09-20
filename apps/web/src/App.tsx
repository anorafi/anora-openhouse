import { useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Markets, type Market } from "./components/Markets";
import { Landing } from "./components/Landing";
import { Activity, Opportunity, Portfolio } from "./components/InvestorPages";
import { FacilityDetail, OpenFacility, OriginatorActivity, OriginatorFacilities } from "./components/OriginatorPages";
import { NotDeployed } from "./components/NotDeployed";
import { useDeployment } from "./hooks/useDeployment";
import { DemoProvider, facilityAsMarket, useDemo } from "./state/demo";

export type Role = "investor" | "originator";
export type Page =
  | "home" | "markets" | "opportunity" | "portfolio" | "activity"
  | "facilities" | "open-facility" | "facility";

const PAGES: Page[] = ["home", "markets", "opportunity", "portfolio", "activity", "facilities", "open-facility", "facility"];

/** Where each role lands when the switcher flips. */
const ROLE_HOME: Record<Role, Page> = { investor: "markets", originator: "facilities" };

export function App() {
  return <DemoProvider><Shell /></DemoProvider>;
}

function Shell() {
  const deployment = useDeployment();
  const { facilities, events, supply, claim, reset } = useDemo();
  const initialPage = window.location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(PAGES.includes(initialPage) ? initialPage : "home");
  const [role, setRole] = useState<Role>("investor");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market>(() => facilityAsMarket(facilities[0]));
  // Set when the reviewed market is a live facility, so supplying writes back
  // to the same record the originator is acting on.
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null);
  // The facility the originator is managing, independent of the one the
  // capital provider is reviewing.
  const [manageId, setManageId] = useState<string | null>(null);
  const managed = facilities.find((facility) => facility.id === manageId);

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

  // Data and view both go back to first-visit state, so nothing is left
  // pointing at a record that no longer exists.
  const resetDemo = () => {
    const fresh = reset();
    setSelectedMarket(facilityAsMarket(fresh[0]));
    setSelectedFacilityId(null);
    setManageId(null);
    setRole("investor");
    navigate(ROLE_HOME.investor);
  };

  const review = (market: Market) => {
    setSelectedMarket(market);
    setSelectedFacilityId(facilities.find((facility) => facility.name === market.name)?.id ?? null);
    navigate("opportunity");
  };

  if (page === "home") return <div className="app"><Landing onNavigate={navigate} /></div>;

  return (
    <div className="app shell">
      <Sidebar role={role} page={page} onRole={switchRole} onNavigate={navigate} onHome={() => navigate("home")} />
      <div className="shell-main">
        <Header onReset={resetDemo} />
        <main className="main">
          {!deployment ? <NotDeployed /> : <>
            {page === "markets" && <Markets onReview={review} />}
            {page === "opportunity" && <Opportunity
              market={selectedMarket}
              onBack={() => navigate("markets")}
              onSupply={(amount) => { if (selectedFacilityId) supply(selectedFacilityId, amount); }}
              onDone={() => { navigate("portfolio"); setNotice("Capital supplied successfully."); }}
            />}
            {page === "portfolio" && <Portfolio
              notice={notice}
              live={facilities.filter((facility) => facility.supplied > 0)}
              onClaim={(id) => { claim(id); setNotice("Principal and return claimed."); }}
              onView={(id) => { const facility = facilities.find((item) => item.id === id); if (facility) review(facilityAsMarket(facility)); }}
              onActivity={() => navigate("activity")}
            />}
            {page === "facilities" && <OriginatorFacilities
              onOpen={() => navigate("open-facility")}
              onManage={(id) => { setManageId(id); navigate("facility"); }}
            />}
            {page === "open-facility" && <OpenFacility onOpened={() => navigate("facilities")} />}
            {page === "facility" && (managed
              ? <FacilityDetail facility={managed} onBack={() => navigate("facilities")} />
              : <p className="empty-state">That facility is no longer available.</p>)}
            {page === "activity" && (role === "originator"
              ? <OriginatorActivity events={events} />
              : <Activity events={events.filter((event) => event.actor !== "Originator" || event.event === "Principal and fees repaid")} />)}
          </>}
        </main>
      </div>
    </div>
  );
}
