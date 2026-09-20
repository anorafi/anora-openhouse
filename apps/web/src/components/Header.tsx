import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { AddressLink } from "./AddressLink";
import { robinhood } from "../config/wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { useIsRiskAgent } from "../hooks/useFactory";
import { shortenAddress } from "../lib/format";
import type { Page } from "../lib/route";

const SELECTABLE_CHAINS = [
  { id: arbitrumSepolia.id, name: "Arbitrum Sepolia" },
  { id: robinhood.id, name: "Robinhood Chain" },
];

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: "markets", label: "Markets" },
  { page: "portfolio", label: "Portfolio" },
  { page: "activity", label: "Activity" },
  { page: "originate", label: "Originate" },
  { page: "risk", label: "Risk" },
];

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
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            className={page === item.page || (item.page === "markets" && page === "opportunity") ? "active" : ""}
            onClick={() => onNavigate(item.page)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <div className="network-select">
          {SELECTABLE_CHAINS.map((chain) => (
            <button
              key={chain.id}
              className={chain.id === chainId ? "network-pill active" : "network-pill"}
              disabled={isSwitching || !isConnected}
              onClick={() => switchChain({ chainId: chain.id })}
            >
              {chain.name}
            </button>
          ))}
        </div>
        {isConnected && !isSupportedChain && <span className="btn-warn">Unsupported network</span>}
        {deployment && (
          <>
            <span className="asset-pill">{deployment.assetSymbol}</span>
            <AddressLink className="factory-link" address={deployment.factory} />
          </>
        )}
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
