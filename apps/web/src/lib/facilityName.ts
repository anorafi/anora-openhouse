export interface Listing {
  name: string;
  company: string;
  route: string;
  type: string;
  icon: string;
}

const SEPARATOR = " | ";

const UNLISTED: Omit<Listing, "name"> = {
  company: "Unlisted originator",
  route: "Route not disclosed",
  type: "Trade finance",
  icon: "◈",
};

const clean = (value: string) => value.replace(/\|/g, " ").replace(/\s+/g, " ").trim();

export function encodeFacilityName(listing: Listing): string {
  return [listing.name, listing.company, listing.route, listing.type, listing.icon].map(clean).join(SEPARATOR);
}

export function decodeFacilityName(onchain: string): Listing {
  const [name, company, route, type, icon] = onchain.split(SEPARATOR);
  if (icon === undefined) return { name: onchain, ...UNLISTED };
  return { name, company, route, type, icon };
}
