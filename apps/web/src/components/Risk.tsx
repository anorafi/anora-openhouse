import { useState } from "react";
import { useAccount } from "wagmi";
import { StatusBadge } from "./StatusBadge";
import { TxLink } from "./TxLink";
import { AddressLink } from "./AddressLink";
import { assetContract, facilityContract, MAX_UINT256 } from "../config/contracts";
import { useDeployment } from "../hooks/useDeployment";
import { useAssetAllowance } from "../hooks/useAsset";
import { useContractAction } from "../hooks/useContractAction";
import { useAllFacilityAddresses, useIsRiskAgent } from "../hooks/useFactory";
import { useFacilities, type FacilityData } from "../hooks/useFacilities";
import { useNow } from "../hooks/useNow";
import { describeContractError } from "../lib/errors";
import { secondsUntil } from "../lib/facility";
import { formatDuration, formatUsdc, parseUsdc } from "../lib/format";

export function Risk() {
  const { data: addresses } = useAllFacilityAddresses();
  const { facilities, isLoading, error } = useFacilities(addresses);
  const { address } = useAccount();
  const isRiskAgent = useIsRiskAgent(address);

  return (
    <section className="risk-page">
      <div className="page-title">
        <h1>Risk</h1>
        <p>{isRiskAgent ? "You are the risk agent for this network." : "Read-only unless your wallet is the risk agent."}</p>
      </div>
      {error && <p className="error">Could not load facilities: {error.message}</p>}
      {isLoading && <p className="muted">Loading facilities...</p>}
      {!isLoading && facilities.length === 0 && <p className="muted">No facilities on this network yet.</p>}
      <div className="card-list">
        {facilities.map((facility) => (
          <RiskCard key={facility.address} facility={facility} isRiskAgent={isRiskAgent} />
        ))}
      </div>
    </section>
  );
}

function RiskCard({ facility, isRiskAgent }: { facility: FacilityData; isRiskAgent: boolean }) {
  const deployment = useDeployment();
  const { address } = useAccount();
  const now = useNow();
  const { data: allowance } = useAssetAllowance(address, facility.address);

  const [reason, setReason] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("");

  const markLate = useContractAction();
  const declareDefault = useContractAction();
  const recoveryApprove = useContractAction();
  const recordRecovery = useContractAction();

  if (!deployment) return null;

  const asset = assetContract(deployment.asset);
  const facilityCall = facilityContract(facility.address);
  const nowSec = BigInt(Math.floor(now / 1000));
  const dueInSec = secondsUntil(facility.dueAt, nowSec);
  const canMarkLate = facility.statusName === "Open" && facility.principal > 0n && dueInSec < 0;

  const graceDeadline = facility.lateSince + facility.terms.grace;
  const graceElapsed = nowSec >= graceDeadline;
  const canDeclareDefault = isRiskAgent && facility.statusName === "Late" && graceElapsed && reason.trim() !== "";

  const outstandingLoss = facility.lossFirstLoss + facility.lossJunior + facility.lossSenior;
  const recoveryAmountUnits = parseUsdc(recoveryAmount);
  const canRecover = facility.statusName === "Defaulted" && recoveryAmountUnits > 0n && recoveryAmountUnits <= outstandingLoss;
  const recoveryNeedsApproval = recoveryAmountUnits > 0n && (allowance ?? 0n) < recoveryAmountUnits;

  return (
    <div className="card">
      <div className="card-head">
        <StatusBadge status={facility.statusName} />
        <span className="card-title">{facility.name}</span>
        <AddressLink address={facility.originator} />
      </div>

      <p className="muted">
        {facility.dueAt === 0n
          ? "Not drawn yet."
          : facility.statusName === "Open"
            ? dueInSec >= 0
              ? `Due in ${formatDuration(dueInSec)}.`
              : `Past due by ${formatDuration(-dueInSec)}.`
            : null}
      </p>
      {facility.statusName === "Late" && (
        <p className="muted">
          {graceElapsed
            ? "Grace period elapsed. Ready for declareDefault."
            : `Grace elapses in ${formatDuration(Number(graceDeadline - nowSec))}.`}
        </p>
      )}

      {facility.statusName === "Defaulted" && (
        <div className="loss-breakdown">
          <p>
            Reason: <em>{facility.defaultReason || "(none recorded)"}</em>
          </p>
          <p className="muted">Declared at {new Date(Number(facility.defaultedAt) * 1000).toLocaleString()}</p>
          <p>
            Losses: first-loss {formatUsdc(facility.lossFirstLoss)} · junior {formatUsdc(facility.lossJunior)} · senior{" "}
            {formatUsdc(facility.lossSenior)}
          </p>
        </div>
      )}

      <div className="row">
        <button
          className="btn"
          disabled={!canMarkLate || markLate.isPending || markLate.isConfirming}
          onClick={() => markLate.writeContractAsync({ ...facilityCall, functionName: "markLate", args: [] })}
        >
          {markLate.isPending || markLate.isConfirming ? "Marking..." : "Mark late"}
        </button>
      </div>
      {markLate.error && <p className="error">{describeContractError(markLate.error)}</p>}
      <TxLink hash={markLate.hash} />

      {facility.statusName === "Late" && (
        <div className="form-block">
          <textarea placeholder="Default reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn btn-danger"
            disabled={!canDeclareDefault || declareDefault.isPending || declareDefault.isConfirming}
            onClick={() => declareDefault.writeContractAsync({ ...facilityCall, functionName: "declareDefault", args: [reason] })}
          >
            {declareDefault.isPending || declareDefault.isConfirming ? "Declaring..." : "Declare default"}
          </button>
        </div>
      )}
      {declareDefault.error && <p className="error">{describeContractError(declareDefault.error)}</p>}
      <TxLink hash={declareDefault.hash} />

      {facility.statusName === "Defaulted" && outstandingLoss > 0n && (
        <div className="row">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Recovery amount"
            value={recoveryAmount}
            onChange={(e) => setRecoveryAmount(e.target.value)}
          />
          {recoveryNeedsApproval ? (
            <button
              className="btn"
              disabled={recoveryApprove.isPending || recoveryApprove.isConfirming}
              onClick={() => recoveryApprove.writeContractAsync({ ...asset, functionName: "approve", args: [facility.address, MAX_UINT256] })}
            >
              {recoveryApprove.isPending || recoveryApprove.isConfirming ? "Approving..." : "Approve"}
            </button>
          ) : (
            <button
              className="btn"
              disabled={!canRecover || recordRecovery.isPending || recordRecovery.isConfirming}
              onClick={() => recordRecovery.writeContractAsync({ ...facilityCall, functionName: "recordRecovery", args: [recoveryAmountUnits] })}
            >
              {recordRecovery.isPending || recordRecovery.isConfirming ? "Recording..." : "Record recovery"}
            </button>
          )}
        </div>
      )}
      {(recoveryApprove.error || recordRecovery.error) && (
        <p className="error">{describeContractError(recoveryApprove.error ?? recordRecovery.error)}</p>
      )}
      <TxLink hash={recordRecovery.hash} />
    </div>
  );
}
