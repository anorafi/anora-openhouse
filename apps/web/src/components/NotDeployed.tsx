import { useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { robinhood } from "../config/wagmi";

export function NotDeployed() {
  const { switchChain, isPending } = useSwitchChain();

  return (
    <section className="panel">
      <h2>This network is not supported by Anora.</h2>
      <p className="muted">Switch to a supported network to continue.</p>
      <div className="row">
        <button className="btn" disabled={isPending} onClick={() => switchChain({ chainId: arbitrumSepolia.id })}>
          Arbitrum Sepolia
        </button>
        <button className="btn" disabled={isPending} onClick={() => switchChain({ chainId: robinhood.id })}>
          Robinhood Chain
        </button>
      </div>
    </section>
  );
}
