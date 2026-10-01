export type TokenIcon = "usdc" | "usdg";

export function tokenIconFor(asset: string): TokenIcon | null {
  const symbol = asset.trim().toUpperCase();
  if (symbol === "USDC" || symbol === "TESTUSDC") return "usdc";
  if (symbol === "USDG") return "usdg";
  return null;
}
