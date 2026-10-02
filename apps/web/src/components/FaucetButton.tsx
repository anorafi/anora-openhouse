import { useBook } from "../state/book";
import { useTx } from "../hooks/useTx";

export function FaucetButton() {
  const { canFaucet, faucet, symbol } = useBook();
  const tx = useTx();
  if (!canFaucet) return null;
  return <div className="faucet-row">
    <button className="network-current" disabled={tx.busy} onClick={() => tx.run(faucet)}>
      {tx.busy ? "Claiming…" : `Claim ${symbol}`}
    </button>
    {tx.error && <p className="facility-warn">{tx.error}</p>}
  </div>;
}
