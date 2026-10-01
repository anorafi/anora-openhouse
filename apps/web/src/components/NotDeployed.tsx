import { useSwitchChain } from "wagmi";
import { orderedNetworks } from "../config/chains";
import { useManifest } from "../config/ManifestContext";

export function NotDeployed() {
  const manifest = useManifest();
  const { switchChain, isPending } = useSwitchChain();

  return (
    <section className="panel">
      <h2>This network is not supported by Anora.</h2>
      <p className="muted">Switch to a supported network to continue.</p>
      <div className="row">
        {orderedNetworks(manifest).map((network) => (
          <button key={network.chainId} className="btn" disabled={isPending} onClick={() => switchChain({ chainId: network.chainId })}>
            {network.name}
          </button>
        ))}
      </div>
    </section>
  );
}
