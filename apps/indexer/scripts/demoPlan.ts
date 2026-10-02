export type Kind = "open" | "active" | "late" | "recovered" | "repaid";
export type MetadataMode = "anchored" | "pending" | null;
export type DemoChain = "robinhood" | "sepolia";

export interface FacilitySpec {
  kind: Kind;
  name: string;
  company: string;
  route: string;
  type: string;
  icon: string;
  limit: number;
  firstLoss: number;
  feePct: number;
  tenorSeconds: number;
  graceSeconds: number;
  junior: number;
  senior: number;
  draw: number;
  metadata: MetadataMode;
}

export const usdc = (value: number) => Math.round(value * 1_000_000);

const DAY = 86_400;
const SENIOR_PER_JUNIOR_BPS = 22_500;
const BPS = 10_000;
const MIN_FIRST_LOSS_BPS = 1_000;

export function seniorCapacity(firstLoss: number, junior: number) {
  return Math.floor(((firstLoss + junior) * SENIOR_PER_JUNIOR_BPS) / BPS);
}

const open = (name: string, company: string, route: string, type: string, icon: string, days: number, metadata: MetadataMode): FacilitySpec => ({
  kind: "open", name, company, route, type, icon,
  limit: usdc(3), firstLoss: usdc(0.3), feePct: 6, tenorSeconds: days * DAY, graceSeconds: 14 * DAY,
  junior: 0, senior: 0, draw: 0, metadata,
});

const funded = (kind: Kind, name: string, company: string, route: string, type: string, icon: string, tenorSeconds: number, graceSeconds: number): FacilitySpec => ({
  kind, name, company, route, type, icon,
  limit: usdc(2), firstLoss: usdc(0.2), feePct: 5, tenorSeconds, graceSeconds,
  junior: usdc(0.4), senior: usdc(0.6), draw: usdc(1), metadata: null,
});

export function demoPlan(chain: DemoChain): FacilitySpec[] {
  const n = chain === "robinhood" ? [31, 52, 61, 44, 47, 55, 38] : [71, 72, 73, 74, 75, 76, 77];
  return [
    open(`Sumatra Coffee Receivables ${n[0]}`, "PT Sumatra Kopi Global", "Indonesia → Japan", "Export receivables", "☕", 60, "anchored"),
    open(`Java Cocoa Purchase Orders ${n[1]}`, "PT Jawa Cokelat Lestari", "Indonesia → Netherlands", "Supply-chain finance", "◉", 90, chain === "robinhood" ? "anchored" : "pending"),
    open(`Thailand Rice Shipment ${n[2]}`, "Siam Grains Co., Ltd.", "Thailand → Philippines", "Commodity finance", "♨", 120, null),
    funded("active", `Vietnam Cashew Export ${n[3]}`, "Viet Harvest Co., Ltd.", "Vietnam → UAE", "Export receivables", "◐", 90 * DAY, 14 * DAY),
    funded("late", `Penang Electronics Order ${n[4]}`, "Penang Components Sdn Bhd", "Malaysia → Germany", "Supply-chain finance", "▣", 120, 14 * DAY),
    funded("recovered", `Chattogram Garment Order ${n[5]}`, "Padma Apparels Ltd", "Bangladesh → Netherlands", "Supply-chain finance", "▤", 120, 60),
    funded("repaid", `Kochi Spice Receivables ${n[6]}`, "Kochi Spice Exports Pvt", "India → UAE", "Export receivables", "◒", 90 * DAY, 14 * DAY),
  ];
}

const sizedOpen = (name: string, company: string, route: string, type: string, icon: string, days: number, metadata: MetadataMode): FacilitySpec => ({
  kind: "open", name, company, route, type, icon,
  limit: usdc(20_000), firstLoss: usdc(4_000), feePct: 6, tenorSeconds: days * DAY, graceSeconds: 14 * DAY,
  junior: 0, senior: 0, draw: 0, metadata,
});

const sizedFunded = (kind: Kind, name: string, company: string, route: string, type: string, icon: string, tenorSeconds: number, graceSeconds: number): FacilitySpec => ({
  kind, name, company, route, type, icon,
  limit: usdc(10_000), firstLoss: usdc(2_000), feePct: 5, tenorSeconds, graceSeconds,
  junior: usdc(2_000), senior: usdc(4_000), draw: usdc(6_000), metadata: null,
});

export function sizedPlan(chain: DemoChain): FacilitySpec[] {
  if (chain !== "sepolia") throw new Error("the sized plan is for the testnet only");
  return [
    sizedOpen("Mekong Rubber Consignment 81", "Mekong Rubber JSC", "Vietnam → South Korea", "Commodity finance", "◍", 60, "anchored"),
    sizedOpen("Sihanoukville Rice Cargo 82", "Angkor Grain Co., Ltd.", "Cambodia → China", "Commodity finance", "♨", 90, "pending"),
    sizedOpen("Surabaya Coffee Forward 83", "PT Kopi Timur Nusantara", "Indonesia → South Korea", "Export receivables", "☕", 120, null),
    sizedFunded("late", "Cebu Shrimp Export 84", "Cebu Marine Foods Corporation", "Philippines → Japan", "Export receivables", "◐", 120, 90),
    sizedFunded("late", "Colombo Tea Auction 85", "Ceylon Highlands (Pvt) Ltd", "Sri Lanka → United Kingdom", "Export receivables", "◒", 120, 90),
    sizedFunded("active", "Karachi Textile Shipment 86", "Indus Textile Industries (Pvt) Ltd", "Pakistan → Turkey", "Commodity finance", "▤", 90 * DAY, 14 * DAY),
  ];
}

export function lockedInOpen(plan: FacilitySpec[]) {
  return plan.filter((spec) => spec.kind === "open").reduce((sum, spec) => sum + spec.firstLoss, 0);
}

export function validatePlan(plan: FacilitySpec[]) {
  for (const spec of plan) {
    if (spec.firstLoss * BPS < spec.limit * MIN_FIRST_LOSS_BPS) throw new Error(`${spec.name}: first loss under the protocol floor`);
    if (spec.senior > seniorCapacity(spec.firstLoss, spec.junior)) throw new Error(`${spec.name}: senior above capacity`);
    if (spec.junior + spec.senior + spec.firstLoss > spec.limit) throw new Error(`${spec.name}: capital above the limit`);
    if (spec.draw > spec.junior + spec.senior) throw new Error(`${spec.name}: draw above supplied capital`);
  }
}
