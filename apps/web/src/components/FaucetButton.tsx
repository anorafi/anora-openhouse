import { useBook } from "../state/book";
import { useTx } from "../hooks/useTx";
import { FAUCET_AMOUNT } from "../lib/faucet";

export function FaucetButton() {
  const { canFaucet, faucet, symbol } = useBook();
  const tx = useTx();
  if (!canFaucet) return null;
  return <div className="faucet-row">
    <button className="text-link" disabled={tx.busy} onClick={() => tx.run(faucet)}>
      {tx.busy ? "Confirm in wallet…" : `Get ${FAUCET_AMOUNT.toLocaleString("en-US")} test ${symbol.replace(/^test/i, "")}`}
    </button>
    {tx.error && <p className="facility-warn">{tx.error}</p>}
  </div>;
}
