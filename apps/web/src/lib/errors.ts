import { BaseError, ContractFunctionRevertedError } from "viem";

const REVERT_MESSAGES: Record<string, string> = {
  SeniorCapacityExceeded: "Senior tranche capacity is full; deposit into Junior first or deposit a smaller amount.",
  CapitalCapExceeded: "This deposit would exceed the facility's capital cap.",
  FirstLossTooSmall: "First-loss stake is below the policy minimum for this credit limit.",
  LimitExceeded: "This drawdown would exceed the facility's credit limit.",
  InsufficientLiquidity: "The facility does not have enough free liquidity for this right now.",
  NotOriginator: "Only the facility's originator can do this.",
  FacilityNotOpen: "This facility is not open (it may be late, defaulted, or closed).",
  NotPastDue: "This facility is not past its due date yet.",
  Overpayment: "That amount is more than what is owed on this facility.",
  NotRiskAgent: "Only the risk agent can declare a default.",
  FacilityNotLate: "This facility must be marked late before it can be defaulted.",
  GraceNotElapsed: "The grace period has not elapsed yet.",
  NothingToRecover: "There is no outstanding loss to recover on this facility.",
  InsufficientShares: "You do not have that many shares in this tranche.",
};

export function describeContractError(error: unknown): string {
  if (error instanceof BaseError) {
    const revertError = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      const name = revertError.data?.errorName;
      if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name];
      if (name) return `Reverted: ${name}`;
    }
    return error.shortMessage ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
