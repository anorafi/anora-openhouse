import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Markets } from "./components/Markets";
import { Opportunity } from "./components/Opportunity";
import { Portfolio } from "./components/Portfolio";
import { Activity } from "./components/Activity";
import { Originate } from "./components/Originate";
import { Risk } from "./components/Risk";
import { NotDeployed } from "./components/NotDeployed";
import { useDeployment } from "./hooks/useDeployment";
import { parseHash, routeToHash, type Route } from "./lib/route";

export function App() {
  const deployment = useDeployment();
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: Route) => {
    setNotice(null);
    window.location.hash = routeToHash(next);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app">
      <Header page={route.page} onNavigate={(page) => navigate({ page } as Route)} />
      <main className="main">
        {!deployment ? (
          <NotDeployed />
        ) : (
          <>
            {route.page === "markets" && <Markets onReview={(facility) => navigate({ page: "opportunity", facility })} />}
            {route.page === "opportunity" && (
              <Opportunity
                facility={route.facility}
                onBack={() => navigate({ page: "markets" })}
                onComplete={() => {
                  navigate({ page: "portfolio" });
                  setNotice("Capital supplied successfully.");
                }}
              />
            )}
            {route.page === "portfolio" && (
              <Portfolio
                notice={notice}
                onView={(facility) => navigate({ page: "opportunity", facility })}
                onActivity={() => navigate({ page: "activity" })}
              />
            )}
            {route.page === "activity" && <Activity />}
            {route.page === "originate" && <Originate onView={(facility) => navigate({ page: "opportunity", facility })} />}
            {route.page === "risk" && <Risk />}
          </>
        )}
      </main>
    </div>
  );
}
