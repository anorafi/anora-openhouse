import type { Address } from "viem";
import { AnoraFacilityAbi, AnoraFactoryAbi, TestUSDCAbi } from "../abi";

export function factoryContract(address: Address) {
  return { address, abi: AnoraFactoryAbi } as const;
}

export function facilityContract(address: Address) {
  return { address, abi: AnoraFacilityAbi } as const;
}

export function assetContract(address: Address) {
  return { address, abi: TestUSDCAbi } as const;
}

export const BPS = 10_000n;
export const MAX_UINT256 = 2n ** 256n - 1n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
