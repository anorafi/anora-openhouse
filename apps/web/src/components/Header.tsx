import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { AddressLink } from "./AddressLink";
import { robinhood } from "../config/wagmi";
import { useDeployment } from "../hooks/useDeployment";
import { useIsRiskAgent } from "../hooks/useFactory";
import { shortenAddress } from "../lib/format";

const SELECTABLE_CHAINS = [{ id: robinhood.id, name: "Robinhood Chain" }, { id: arbitrumSepolia.id, name: "Arbitrum Sepolia" }];

/** Close an open popover when the next click lands outside it. */
function useDismiss(open: boolean, setOpen: (open: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, setOpen]);
  return ref;
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Header() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const isRiskAgent = useIsRiskAgent(address);
  const deployment = useDeployment();
  const currentChain = SELECTABLE_CHAINS.find((chain) => chain.id === chainId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismiss(menuOpen, setMenuOpen);

  const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];

  return (
    <header className="header">
      <div className="header-actions">
        <div className="network-select" ref={menuRef}>
          <button type="button" className="network-current" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <span className="network-dot" aria-hidden="true" />
            {currentChain ? currentChain.name : "Unsupported network"}
            <span className="chev"><Chevron /></span>
          </button>
          {menuOpen && (
            <div className="network-menu" role="menu">
              {SELECTABLE_CHAINS.filter((chain) => chain.id !== chainId).map((chain) => (
                <button
                  key={chain.id}
                  role="menuitem"
                  disabled={isSwitching || !isConnected}
                  onClick={() => { switchChain({ chainId: chain.id }); setMenuOpen(false); }}
                >
                  Switch to {chain.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {isConnected && !currentChain && <span className="btn-warn">Unsupported network</span>}
        {deployment && <AddressLink className="pool-link" address={deployment.factory} />}
        {isConnected && address ? (
          <div className="account-pill">
            {isRiskAgent && <span className="badge badge-risk">risk agent</span>}
            <span className="address">{shortenAddress(address)}</span>
            <button className="account-menu" aria-label="Disconnect wallet" onClick={() => disconnect()}><Chevron /></button>
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
