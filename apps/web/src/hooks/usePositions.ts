import { useMemo } from "react";
import type { Address } from "viem";
import { useChainId, useReadContracts } from "wagmi";
import { facilityContract, ZERO_ADDRESS } from "../config/contracts";

const REFETCH_MS = 5_000;

export interface Position {
  seniorShares: bigint;
  juniorShares: bigint;
}

export function useMyPositions(addresses: readonly Address[] | undefined, owner: Address | undefined) {
  const chainId = useChainId();
  const list = useMemo(() => addresses ?? [], [addresses]);

  const contracts = useMemo(
    () =>
      list.flatMap((address) => {
        const c = facilityContract(address);
        return [
          { ...c, chainId, functionName: "seniorShares", args: [owner ?? ZERO_ADDRESS] },
          { ...c, chainId, functionName: "juniorShares", args: [owner ?? ZERO_ADDRESS] },
        ] as const;
      }),
    [list, chainId, owner],
  );

  const { data, isLoading } = useReadContracts({
    contracts,
    query: { enabled: list.length > 0 && !!owner, refetchInterval: REFETCH_MS },
  });

  const positions = new Map<Address, Position>();
  list.forEach((address, i) => {
    const senior = data?.[i * 2]?.result as bigint | undefined;
    const junior = data?.[i * 2 + 1]?.result as bigint | undefined;
    positions.set(address, { seniorShares: senior ?? 0n, juniorShares: junior ?? 0n });
  });

  return { positions, isLoading };
}

export function useMyPosition(address: Address | undefined, owner: Address | undefined): Position {
  const addresses = useMemo(() => (address ? [address] : []), [address]);
  const { positions } = useMyPositions(addresses, owner);
  return address ? (positions.get(address) ?? { seniorShares: 0n, juniorShares: 0n }) : { seniorShares: 0n, juniorShares: 0n };
}
