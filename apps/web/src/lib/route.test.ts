import { describe, expect, it } from "vitest";
import { parseHash, routeToHash } from "./route";

const ADDRESS = "0xabababababababababababababababababababab";

describe("parseHash", () => {
  it("defaults to markets for an empty hash", () => {
    expect(parseHash("")).toEqual({ page: "markets" });
    expect(parseHash("#")).toEqual({ page: "markets" });
  });

  it("parses plain pages", () => {
    expect(parseHash("#portfolio")).toEqual({ page: "portfolio" });
    expect(parseHash("#activity")).toEqual({ page: "activity" });
    expect(parseHash("#originate")).toEqual({ page: "originate" });
    expect(parseHash("#risk")).toEqual({ page: "risk" });
  });

  it("parses an opportunity route with a valid facility address", () => {
    expect(parseHash(`#opportunity/${ADDRESS}`)).toEqual({ page: "opportunity", facility: ADDRESS });
  });

  it("parses an opportunity route without an address as a null facility", () => {
    expect(parseHash("#opportunity")).toEqual({ page: "opportunity", facility: null });
  });

  it("treats a malformed address as a null facility", () => {
    expect(parseHash("#opportunity/not-an-address")).toEqual({ page: "opportunity", facility: null });
  });

  it("falls back to markets for an unknown page", () => {
    expect(parseHash("#nonsense")).toEqual({ page: "markets" });
  });
});

describe("routeToHash", () => {
  it("round-trips plain pages", () => {
    expect(routeToHash({ page: "risk" })).toBe("risk");
  });

  it("round-trips an opportunity route with a facility", () => {
    expect(routeToHash({ page: "opportunity", facility: ADDRESS })).toBe(`opportunity/${ADDRESS}`);
  });

  it("renders an opportunity route without a facility as just the page", () => {
    expect(routeToHash({ page: "opportunity", facility: null })).toBe("opportunity");
  });
});
