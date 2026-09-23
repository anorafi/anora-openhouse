import { describe, expect, it } from "vitest";
import { decodeFacilityName, encodeFacilityName } from "./facilityName";

const listing = {
  name: "Bandung Tea Export 01",
  company: "PT Nusantara Teh Lestari",
  route: "Indonesia → Singapore",
  type: "Export receivables",
  icon: "◒",
};

describe("encodeFacilityName", () => {
  it("round-trips every listing field through the onchain name", () => {
    expect(decodeFacilityName(encodeFacilityName(listing))).toEqual(listing);
  });

  it("strips the separator from user input so fields cannot shift", () => {
    const encoded = encodeFacilityName({ ...listing, company: "Teh | Lestari" });
    expect(decodeFacilityName(encoded).company).toBe("Teh Lestari");
    expect(decodeFacilityName(encoded).route).toBe(listing.route);
  });
});

describe("decodeFacilityName", () => {
  it("reads a plain name from facilities opened before listings existed", () => {
    expect(decodeFacilityName("Smoke facility 7")).toEqual({
      name: "Smoke facility 7",
      company: "Unlisted originator",
      route: "Route not disclosed",
      type: "Trade finance",
      icon: "◈",
    });
  });
});
