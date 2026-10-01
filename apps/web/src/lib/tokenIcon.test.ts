import { describe, expect, test } from "vitest";
import { tokenIconFor } from "./tokenIcon";

describe("tokenIconFor", () => {
  test("uses the USDC mark for USDC and its test token", () => {
    expect(tokenIconFor("USDC")).toBe("usdc");
    expect(tokenIconFor("TestUSDC")).toBe("usdc");
    expect(tokenIconFor("testusdc")).toBe("usdc");
  });

  test("uses the USDG mark only for USDG", () => {
    expect(tokenIconFor("USDG")).toBe("usdg");
  });

  test("shows no mark for an unknown asset instead of guessing", () => {
    expect(tokenIconFor("DAI")).toBeNull();
    expect(tokenIconFor("")).toBeNull();
  });
});
