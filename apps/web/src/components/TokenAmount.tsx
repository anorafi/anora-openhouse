export function TokenAmount({ value, asset }: { value: number | string; asset: string }) {
  return <span className="token-amount">{asset === "USDC" ? <span className="usdc-icon"><img src="/usdc-mark.png" alt="USDC" /></span> : <img src="/usdg-mark.svg" alt="USDG" width="15" height="15" />}{typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}</span>;
}
