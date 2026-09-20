export type Scheduled = { address: `0x${string}`; dueAt: bigint };

export function delayUntilDue(dueAt: bigint, nowSeconds: bigint, marginSeconds = 2n): number {
  const wait = dueAt + marginSeconds - nowSeconds;
  return wait > 0n ? Number(wait) * 1000 : 0;
}

export function upsertSchedule(list: Scheduled[], next: Scheduled): Scheduled[] {
  return [...list.filter((s) => s.address.toLowerCase() !== next.address.toLowerCase()), next];
}
