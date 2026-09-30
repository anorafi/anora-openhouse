import { describe, expect, it, vi } from "vitest";
import { guardedWrite } from "./guardedWrite";

describe("guardedWrite", () => {
  it("does not write when the simulation rejects", async () => {
    const failure = new Error("reverted");
    const simulate = vi.fn().mockRejectedValue(failure);
    const write = vi.fn().mockResolvedValue("0xhash");
    await expect(guardedWrite(simulate, write, { functionName: "createFacility" })).rejects.toBe(failure);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes and returns the hash when the simulation passes", async () => {
    const request = { functionName: "deposit" };
    const simulate = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue("0xhash");
    await expect(guardedWrite(simulate, write, request)).resolves.toBe("0xhash");
    expect(simulate).toHaveBeenCalledWith(request);
    expect(write).toHaveBeenCalledWith(request);
  });
});
