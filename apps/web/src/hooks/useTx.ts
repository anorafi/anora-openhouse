import { useCallback, useState } from "react";
import { describeContractError } from "../lib/errors";

export function useTx() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(describeContractError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run };
}
