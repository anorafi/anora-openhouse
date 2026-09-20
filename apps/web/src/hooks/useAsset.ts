import type { Address } from "viem";
import { useChainId, useReadContract } from "wagmi";
import { assetContract, ZERO_ADDRESS } from "../config/contracts";
import { useAssetAddress } from "./useDeployment";

const REFETCH_MS = 5_000;

export function useAssetBalance(owner: Address | undefined) {
  const chainId = useChainId();
  const assetAddress = useAssetAddress();
  const asset = assetContract(assetAddress ?? ZERO_ADDRESS);

  return useReadContract({
    ...asset,
    functionName: "balanceOf",
    args: [owner ?? ZERO_ADDRESS],
    chainId,
    query: { enabled: !!assetAddress && !!owner, refetchInterval: REFETCH_MS },
  });
}

export function useAssetAllowance(owner: Address | undefined, spender: Address | undefined) {
  const chainId = useChainId();
  const assetAddress = useAssetAddress();
  const asset = assetContract(assetAddress ?? ZERO_ADDRESS);

  return useReadContract({
    ...asset,
    functionName: "allowance",
    args: [owner ?? ZERO_ADDRESS, spender ?? ZERO_ADDRESS],
    chainId,
    query: { enabled: !!assetAddress && !!owner && !!spender, refetchInterval: REFETCH_MS },
  });
}
