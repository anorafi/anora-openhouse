import { useSwitchChain } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { robinhood } from "../config/wagmi";
import { useDeployment } from "../hooks/useDeployment";

export function NotDeployed() {
  const deployment = useDeployment();
  const { switchChain, isPending } = useSwitchChain();

  const message = deployment
    ? "Anora is not deployed on this network yet."
    : "This network is not supported by Anora.";

  return (
    <section className="panel">
      <h2>{message}</h2>
      <p className="muted">Switch to a supported network to continue.</p>
      <div className="row">
        <button className="btn" disabled={isPending} onClick={() => switchChain({ chainId: robinhood.id })}>
          Robinhood Chain
        </button>
        <button className="btn" disabled={isPending} onClick={() => switchChain({ chainId: arbitrumSepolia.id })}>
          Arbitrum Sepolia
        </button>
      </div>
    </section>
  );
}
