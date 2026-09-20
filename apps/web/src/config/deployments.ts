import type { Address } from "viem";
import rawDeployments from "../../../../contracts/deployments.json";

export interface Deployment {
  chainId: number;
  factory: Address;
  asset: Address;
  assetSymbol: string;
  faucet: boolean;
  explorer: string;
}

interface RawDeployment {
  chainId: number;
  asset: string;
  assetSymbol: string;
  faucet: boolean;
  AnoraFactory: string;
  explorer: string;
}

const deploymentsByChainId: Record<number, Deployment> = Object.fromEntries(
  Object.values(rawDeployments as Record<string, RawDeployment>).map((entry) => [
    entry.chainId,
    {
      chainId: entry.chainId,
      factory: entry.AnoraFactory as Address,
      asset: entry.asset as Address,
      assetSymbol: entry.assetSymbol,
      faucet: entry.faucet,
      explorer: entry.explorer,
    },
  ]),
);

export function deploymentFor(chainId: number): Deployment | undefined {
  return deploymentsByChainId[chainId];
}

export function supportedChainIds(): number[] {
  return Object.keys(deploymentsByChainId).map(Number);
}
