export interface UpstreamNetwork {
  chainId: number;
  rpcUrl: string;
  publicRpcUrl?: string;
  alchemyHost?: string;
}

export function upstreamsFor(network: UpstreamNetwork, providerKey: string | undefined): string[] {
  const urls: string[] = [];
  if (providerKey && network.alchemyHost) urls.push(`https://${network.alchemyHost}.g.alchemy.com/v2/${providerKey}`);
  const fallback = network.publicRpcUrl ?? network.rpcUrl;
  if (!new URL(fallback).pathname.startsWith("/rpc/") || network.publicRpcUrl) urls.push(fallback);
  return urls;
}
