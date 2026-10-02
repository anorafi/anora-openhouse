export const FAUCET_AMOUNT = 10_000;

export function faucetVisible({ faucet, writes, connected }: { faucet: boolean | undefined; writes: boolean | undefined; connected: boolean }) {
  return connected && faucet === true && writes === true;
}
