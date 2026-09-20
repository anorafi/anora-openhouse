import { useState } from "react";
import { Header } from "./components/Header";
import { Markets } from "./components/Markets";
import { Activity, Opportunity, Portfolio } from "./components/InvestorPages";
import { NotDeployed } from "./components/NotDeployed";
import { useDeployment } from "./hooks/useDeployment";

export type Page = "markets" | "opportunity" | "portfolio" | "activity";

export function App() {
  const deployment = useDeployment();
  const initialPage = window.location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(["markets", "opportunity", "portfolio", "activity"].includes(initialPage) ? initialPage : "markets");
  const [notice, setNotice] = useState<string | null>(null);

  const navigate = (next: Page) => {
    setPage(next);
    window.location.hash = next;
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app">
      <Header page={page} onNavigate={navigate} />
      <main className="main">
        {!deployment?.pool ? <NotDeployed /> : <>
          {page === "markets" && <Markets onReview={() => navigate("opportunity")} />}
          {page === "opportunity" && <Opportunity onBack={() => navigate("markets")} onComplete={() => { navigate("portfolio"); setNotice("Capital supplied successfully."); }} />}
          {page === "portfolio" && <Portfolio notice={notice} onView={() => navigate("opportunity")} onActivity={() => navigate("activity")} />}
          {page === "activity" && <Activity />}
        </>}
      </main>
    </div>
  );
}
