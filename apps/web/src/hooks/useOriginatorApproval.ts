import { useEffect, useRef, useState } from "react";
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

  const session = useRef(0);

  useEffect(() => {
    session.current += 1;
    setState("idle");
  }, [address, chainId]);

  const known = approved.isSuccess ? Boolean(approved.data) : undefined;
  const request = shouldRequestApproval({ selfServe, connected: !!address, approved: known, state });

  useEffect(() => {
    if (!request || !address || !deployment?.indexerApi) return;
    const mine = session.current;
    setState("pending");
    void requestApproval(fetch, deployment.indexerApi, chainId, address).then(async (result) => {
      if (session.current !== mine) return;
      if (result.ok) await approved.refetch();
      if (session.current === mine) setState(result.ok ? "done" : "failed");
    });
  }, [request, address, chainId]);

  return { notice: approvalNotice(state), pending: state === "pending" };
}
