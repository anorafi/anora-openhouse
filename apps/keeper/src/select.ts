export type FacilitySnapshot = {
  address: `0x${string}`;
  status: number;
  principal: bigint;
  dueAt: bigint;
};

export const STATUS_OPEN = 0;

export function facilitiesToMarkLate(facilities: FacilitySnapshot[], now: bigint): `0x${string}`[] {
  return facilities
    .filter((f) => f.status === STATUS_OPEN && f.principal > 0n && f.dueAt !== 0n && now > f.dueAt)
    .map((f) => f.address);
}
