import type { Address } from "viem";

export type Page = "markets" | "opportunity" | "portfolio" | "activity" | "originate" | "risk";

export type Route = { page: "opportunity"; facility: Address | null } | { page: Exclude<Page, "opportunity"> };

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const PLAIN_PAGES: Exclude<Page, "opportunity">[] = ["markets", "portfolio", "activity", "originate", "risk"];

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  const [page, param] = clean.split("/");

  if (page === "opportunity") {
    const facility = param && ADDRESS_RE.test(param) ? (param as Address) : null;
    return { page: "opportunity", facility };
  }

  if ((PLAIN_PAGES as string[]).includes(page)) {
    return { page: page as Exclude<Page, "opportunity"> };
  }

  return { page: "markets" };
}

export function routeToHash(route: Route): string {
  if (route.page === "opportunity") {
    return route.facility ? `opportunity/${route.facility}` : "opportunity";
  }
  return route.page;
}
