import { describe, expect, it } from "vitest";
import { ContractFunctionExecutionError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { AnoraFacilityAbi, AnoraFactoryAbi } from "../abi";
import { describeContractError } from "./errors";

function revert(abi: typeof AnoraFactoryAbi | typeof AnoraFacilityAbi, errorName: string, functionName: string) {
  const data = encodeErrorResult({ abi, errorName } as never);
  const cause = new ContractFunctionRevertedError({ abi, data, functionName } as never);
  return new ContractFunctionExecutionError(cause, { abi, functionName, args: [] } as never);
}

describe("describeContractError", () => {
  it("explains an originator that is not approved", () => {
    const message = describeContractError(revert(AnoraFactoryAbi, "OriginatorNotApproved", "createFacility"));
    expect(message).toMatch(/approved/i);
  });

  it("explains invalid facility terms", () => {
    const message = describeContractError(revert(AnoraFactoryAbi, "InvalidTerms", "createFacility"));
    expect(message).toMatch(/terms/i);
  });

  it("explains a drawdown after the due date", () => {
    const message = describeContractError(revert(AnoraFacilityAbi, "PastDue", "drawdown"));
    expect(message).toMatch(/due date/i);
  });

  it("explains a Junior withdrawal that would leave Senior without its protection", () => {
    const message = describeContractError(revert(AnoraFacilityAbi, "JuniorProtectionBreached", "withdraw"));
    expect(message).toMatch(/senior/i);
    expect(message).toMatch(/protection/i);
  });
});
