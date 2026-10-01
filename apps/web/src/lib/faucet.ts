export const FAUCET_AMOUNT = 1000;

export function faucetVisible({ faucet, writes, connected }: { faucet: boolean | undefined; writes: boolean | undefined; connected: boolean }) {
  return connected && faucet === true && writes === true;
}
