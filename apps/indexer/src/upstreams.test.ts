import { describe, expect, it } from "bun:test";
import { upstreamsFor } from "./upstreams";

const network = (overrides: Record<string, unknown> = {}) => ({
  chainId: 421614,
  rpcUrl: "https://anora-api.dimsky.xyz/rpc/421614",
  publicRpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  alchemyHost: "arb-sepolia",
  ...overrides,
});

describe("upstreamsFor", () => {
  it("puts the keyed provider first and the public node second", () => {
    expect(upstreamsFor(network(), "KEY")).toEqual(["https://arb-sepolia.g.alchemy.com/v2/KEY", "https://sepolia-rollup.arbitrum.io/rpc"]);
  });

  it("uses only the public node without a key", () => {
    expect(upstreamsFor(network(), undefined)).toEqual(["https://sepolia-rollup.arbitrum.io/rpc"]);
    expect(upstreamsFor(network(), "")).toEqual(["https://sepolia-rollup.arbitrum.io/rpc"]);
  });

  it("uses only the public node when the network has no provider host", () => {
    expect(upstreamsFor(network({ alchemyHost: undefined }), "KEY")).toEqual(["https://sepolia-rollup.arbitrum.io/rpc"]);
  });

  it("falls back to the manifest rpc url when there is no public url", () => {
    expect(upstreamsFor(network({ publicRpcUrl: undefined, rpcUrl: "https://rpc.example" }), undefined)).toEqual(["https://rpc.example"]);
  });

  it("never returns the proxy address as its own upstream", () => {
    const self = "https://anora-api.dimsky.xyz/rpc/421614";
    expect(upstreamsFor(network({ publicRpcUrl: undefined, rpcUrl: self }), undefined)).toEqual([]);
  });
});
