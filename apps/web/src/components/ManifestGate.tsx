import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { ManifestContext } from "../config/ManifestContext";
import { loadManifest, type Manifest } from "../config/manifest";
import { createWagmiConfig } from "../config/wagmi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; manifest: Manifest };

function Ready({ manifest, children }: { manifest: Manifest; children: ReactNode }) {
  const config = useMemo(() => createWagmiConfig(manifest, import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined), [manifest]);
  return (
    <ManifestContext.Provider value={manifest}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProvider>
    </ManifestContext.Provider>
  );
}

export function ManifestGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    loadManifest(fetch, `${import.meta.env.BASE_URL}manifest.json`).then(
      (manifest) => setState({ status: "ready", manifest }),
      (error: unknown) => setState({ status: "error", message: error instanceof Error ? error.message : "The network manifest could not be loaded." }),
    );
  }, []);

  useEffect(load, [load]);

  if (state.status === "ready") return <Ready manifest={state.manifest}>{children}</Ready>;

  return (
    <main className="main">
      <section className="panel">
        <h2>{state.status === "loading" ? "Loading network configuration…" : "Anora could not load its network configuration."}</h2>
        {state.status === "error" && (
          <>
            <p className="muted">{state.message}</p>
            <div className="row">
              <button className="btn" onClick={load}>Try again</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
