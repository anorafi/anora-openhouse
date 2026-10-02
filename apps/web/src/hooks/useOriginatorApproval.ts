import { useEffect, useState } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { factoryContract, ZERO_ADDRESS } from "../config/contracts";
import { approvalNotice, requestApproval, shouldRequestApproval, type ApprovalState } from "../lib/selfServe";
import { useDeployment } from "./useDeployment";

export function useOriginatorApproval() {
  const chainId = useChainId();
  const deployment = useDeployment();
  const { address } = useAccount();
  const selfServe = Boolean(deployment?.selfServeOriginator && deployment.indexerApi);
  const [state, setState] = useState<ApprovalState>("idle");
  const approved = useReadContract({
    ...factoryContract(deployment?.factory ?? ZERO_ADDRESS),
    functionName: "approvedOriginators",
    args: [address ?? ZERO_ADDRESS],
    chainId,
    query: { enabled: selfServe && !!address && !!deployment?.factory },
  });

  useEffect(() => setState("idle"), [address, chainId]);

  const known = approved.isSuccess ? Boolean(approved.data) : undefined;
  const request = shouldRequestApproval({ selfServe, connected: !!address, approved: known, state });

  useEffect(() => {
    if (!request || !address || !deployment?.indexerApi) return;
    let live = true;
    setState("pending");
    void requestApproval(fetch, deployment.indexerApi, chainId, address).then(async (result) => {
      if (!live) return;
      if (result.ok) await approved.refetch();
      if (live) setState(result.ok ? "done" : "failed");
    });
    return () => {
      live = false;
    };
  }, [request, address, chainId]);

  return { notice: approvalNotice(state), pending: state === "pending" };
}
