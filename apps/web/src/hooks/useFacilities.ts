import { useMemo } from "react";
import type { Address } from "viem";
import { useChainId, useReadContracts } from "wagmi";
import { facilityContract } from "../config/contracts";

const REFETCH_MS = 5_000;

export const FacilityStatus = ["Open", "Late", "Defaulted", "Closed"] as const;
export type FacilityStatusName = (typeof FacilityStatus)[number];

export interface FacilityTerms {
  limit: bigint;
  firstLoss: bigint;
  tenor: bigint;
  grace: bigint;
  financingFeeBps: bigint;
  lateFeePerDayBps: bigint;
  seniorPerJuniorBps: bigint;
  seniorFeeShareBps: bigint;
  capitalCap: bigint;
}

export interface FacilityData {
  address: Address;
  name: string;
  originator: Address;
  terms: FacilityTerms;
  status: number;
  statusName: FacilityStatusName;
  totalCapital: bigint;
  seniorAssets: bigint;
  juniorAssets: bigint;
  firstLossReserve: bigint;
  seniorTotalShares: bigint;
  juniorTotalShares: bigint;
  seniorCapacity: bigint;
  principal: bigint;
  fee: bigint;
  owed: bigint;
  dueAt: bigint;
  lateSince: bigint;
  defaultedAt: bigint;
  defaultReason: string;
  evidenceHash: `0x${string}`;
  lossFirstLoss: bigint;
  lossJunior: bigint;
  lossSenior: bigint;
  liquidity: bigint;
}

const FIELDS_PER_FACILITY = 21;

function buildContracts<C>(address: Address, chainId: C) {
  const c = facilityContract(address);
  return [
    { ...c, chainId, functionName: "name" },
    { ...c, chainId, functionName: "originator" },
    { ...c, chainId, functionName: "terms" },
    { ...c, chainId, functionName: "status" },
    { ...c, chainId, functionName: "totalCapital" },
    { ...c, chainId, functionName: "seniorAssets" },
    { ...c, chainId, functionName: "juniorAssets" },
    { ...c, chainId, functionName: "firstLossReserve" },
    { ...c, chainId, functionName: "seniorTotalShares" },
    { ...c, chainId, functionName: "juniorTotalShares" },
    { ...c, chainId, functionName: "seniorCapacity" },
    { ...c, chainId, functionName: "principal" },
    { ...c, chainId, functionName: "fee" },
    { ...c, chainId, functionName: "owed" },
    { ...c, chainId, functionName: "dueAt" },
    { ...c, chainId, functionName: "lateSince" },
    { ...c, chainId, functionName: "defaultedAt" },
    { ...c, chainId, functionName: "defaultReason" },
    { ...c, chainId, functionName: "evidenceHash" },
    { ...c, chainId, functionName: "losses" },
    { ...c, chainId, functionName: "liquidity" },
  ] as const;
}

function buildFacility(address: Address, slice: readonly { status: string; result?: unknown }[]): FacilityData {
  const [
    nameR,
    originatorR,
    termsR,
    statusR,
    totalCapitalR,
    seniorAssetsR,
    juniorAssetsR,
    firstLossReserveR,
    seniorTotalSharesR,
    juniorTotalSharesR,
    seniorCapacityR,
    principalR,
    feeR,
    owedR,
    dueAtR,
    lateSinceR,
    defaultedAtR,
    defaultReasonR,
    evidenceHashR,
    lossesR,
    liquidityR,
  ] = slice;
  const terms = termsR.result as readonly bigint[];
  const losses = lossesR.result as readonly bigint[];
  const status = Number(statusR.result as number);

  return {
    address,
    name: nameR.result as string,
    originator: originatorR.result as Address,
    terms: {
      limit: terms[0],
      firstLoss: terms[1],
      tenor: terms[2],
      grace: terms[3],
      financingFeeBps: terms[4],
      lateFeePerDayBps: terms[5],
      seniorPerJuniorBps: terms[6],
      seniorFeeShareBps: terms[7],
      capitalCap: terms[8],
    },
    status,
    statusName: FacilityStatus[status],
    totalCapital: totalCapitalR.result as bigint,
    seniorAssets: seniorAssetsR.result as bigint,
    juniorAssets: juniorAssetsR.result as bigint,
    firstLossReserve: firstLossReserveR.result as bigint,
    seniorTotalShares: seniorTotalSharesR.result as bigint,
    juniorTotalShares: juniorTotalSharesR.result as bigint,
    seniorCapacity: seniorCapacityR.result as bigint,
    principal: principalR.result as bigint,
    fee: feeR.result as bigint,
    owed: owedR.result as bigint,
    dueAt: dueAtR.result as bigint,
    lateSince: lateSinceR.result as bigint,
    defaultedAt: defaultedAtR.result as bigint,
    defaultReason: defaultReasonR.result as string,
    evidenceHash: evidenceHashR.result as `0x${string}`,
    lossFirstLoss: losses[0],
    lossJunior: losses[1],
    lossSenior: losses[2],
    liquidity: liquidityR.result as bigint,
  };
}

export function useFacilities(addresses: readonly Address[] | undefined) {
  const chainId = useChainId();
  const list = useMemo(() => addresses ?? [], [addresses]);

  const contracts = useMemo(
    () => list.flatMap((address) => buildContracts(address, chainId)),
    [list, chainId],
  );

  const { data, isLoading, error } = useReadContracts({
    contracts,
    query: { enabled: list.length > 0, refetchInterval: REFETCH_MS },
  });

  const facilities: FacilityData[] = [];
  if (data) {
    list.forEach((address, i) => {
      const slice = data.slice(i * FIELDS_PER_FACILITY, (i + 1) * FIELDS_PER_FACILITY);
      if (slice.length === FIELDS_PER_FACILITY && slice.every((d) => d.status === "success")) {
        facilities.push(buildFacility(address, slice));
      }
    });
  }

  return { facilities, isLoading, error };
}

export function useFacility(address: Address | undefined) {
  const addresses = useMemo(() => (address ? [address] : []), [address]);
  const { facilities, isLoading, error } = useFacilities(addresses);
  return { facility: facilities[0], isLoading, error };
}
