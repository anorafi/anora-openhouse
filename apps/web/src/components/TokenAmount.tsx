import { tokenIconFor } from "../lib/tokenIcon";

function TokenMark({ asset }: { asset: string }) {
  const icon = tokenIconFor(asset);
  if (icon === "usdc") return <span className="usdc-icon"><img src="/usdc-mark.png" alt="USDC" /></span>;
  if (icon === "usdg") return <img src="/usdg-mark.svg" alt="USDG" width="15" height="15" />;
  return null;
}

export function TokenAmount({ value, asset }: { value: number | string; asset: string }) {
  return <span className="token-amount"><TokenMark asset={asset} />{typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}</span>;
}
