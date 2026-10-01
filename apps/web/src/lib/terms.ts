export type TenorUnit = "days" | "minutes";

export interface Terms { unit: TenorUnit; duration: string; grace: string }

export const TENOR_PRESETS: Record<TenorUnit, readonly number[]> = {
  days: [30, 60, 90, 120],
  minutes: [2, 3, 5],
};

export const GRACE_PRESETS: Record<TenorUnit, readonly number[]> = {
  days: [7, 14, 30],
  minutes: [1, 2],
};

export const FACILITY_DEFAULTS = {
  lateFeePerDayBps: 10,
  seniorPerJuniorBps: 22_500,
  seniorFeeShareBps: 6_000,
} as const;

const SECONDS: Record<TenorUnit, number> = { days: 86_400, minutes: 60 };

export function toSeconds(value: number, unit: TenorUnit) {
  return Math.round(value * SECONDS[unit]);
}

export function unitsFor(faucet: boolean | undefined): TenorUnit[] {
  return faucet ? ["days", "minutes"] : ["days"];
}

export function defaultTerms(unit: TenorUnit): Terms {
  return unit === "days" ? { unit, duration: "90", grace: "14" } : { unit, duration: "2", grace: "1" };
}

function plural(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

export function termsLabel({ unit, duration, grace }: Terms) {
  const noun = unit === "days" ? "day" : "minute";
  return `${plural(Number(duration), noun)}, then ${plural(Number(grace), noun)} grace`;
}

export function termsValid({ duration, grace }: Terms) {
  return duration !== "" && grace !== "" && Number(duration) > 0 && Number(grace) >= 0;
}
