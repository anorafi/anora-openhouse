import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { AddressLink } from "./AddressLink";
import { robinhood } from "../config/wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { useIsRiskAgent } from "../hooks/usePool";
import { shortenAddress } from "../lib/format";
import type { Page } from "../App";

const SELECTABLE_CHAINS = [{ id: arbitrumSepolia.id, name: "Arbitrum Sepolia" }, { id: robinhood.id, name: "Robinhood Chain" }];

export function Header({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const isRiskAgent = useIsRiskAgent(address);
  const deployment = useDeployment();
  const isSupportedChain = SELECTABLE_CHAINS.some((chain) => chain.id === chainId);

  const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];

  return (
    <header className="header">
      <span className="brand-name">Anora</span>
      <nav className="primary-nav" aria-label="Primary navigation">
        <button className={page === "markets" || page === "opportunity" ? "active" : ""} onClick={() => onNavigate("markets")}>Markets</button>
        <button className={page === "portfolio" ? "active" : ""} onClick={() => onNavigate("portfolio")}>Portfolio</button>
        <button className={page === "activity" ? "active" : ""} onClick={() => onNavigate("activity")}>Activity</button>
      </nav>
      <div className="header-actions">
        <div className="network-select">{SELECTABLE_CHAINS.map((chain) => <button key={chain.id} className={chain.id === chainId ? "network-pill active" : "network-pill"} disabled={isSwitching || !isConnected} onClick={() => switchChain({ chainId: chain.id })}>{chain.name}</button>)}</div>
        {isConnected && !isSupportedChain && <span className="btn-warn">Unsupported network</span>}
        {deployment && <><span className="asset-pill">{deployment.assetSymbol}</span>{deployment.pool && <AddressLink className="pool-link" address={deployment.pool} />}</>}
        {isConnected && address ? (
          <div className="account-pill">
            {isRiskAgent && <span className="badge badge-risk">risk agent</span>}
            <span className="address">{shortenAddress(address)}</span>
            <button className="account-menu" aria-label="Disconnect wallet" onClick={() => disconnect()}>⌄</button>
          </div>
        ) : (
          <button
            className="connect-button"
            disabled={isConnecting || !injectedConnector}
            onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          >
            {isConnecting ? "Connecting..." : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
