import { useState } from "react";
import type { Address } from "viem";
import { keccak256, toBytes } from "viem";
import { useAccount } from "wagmi";
import { StatusBadge } from "./StatusBadge";
import { TxLink } from "./TxLink";
import { assetContract, facilityContract, factoryContract, MAX_UINT256 } from "../config/contracts";
import { useDeployment } from "../hooks/useDeployment";
import { useAssetAllowance, useAssetBalance } from "../hooks/useAsset";
import { useContractAction } from "../hooks/useContractAction";
import { useAllFacilityAddresses, useMinFirstLossBps } from "../hooks/useFactory";
import { useFacilities, type FacilityData } from "../hooks/useFacilities";
import { useNow } from "../hooks/useNow";
import { describeContractError } from "../lib/errors";
import { secondsUntil } from "../lib/facility";
import { formatDuration, formatUsdc, parseUsdc } from "../lib/format";

const MINT_AMOUNT = 100_000n * 10n ** 6n;
const DEFAULT_FINANCING_FEE_BPS = "200";
const DEFAULT_LATE_FEE_BPS = "10";
const DEFAULT_SENIOR_PER_JUNIOR_BPS = "22500";
const DEFAULT_SENIOR_FEE_SHARE_BPS = "6000";
const DEFAULT_CAPITAL_CAP = "1000";

export function Originate({ onView }: { onView: (facility: Address) => void }) {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { data: minFirstLossBps } = useMinFirstLossBps();
  const { data: allowance } = useAssetAllowance(address, deployment?.factory);
  const { data: assetBalance } = useAssetBalance(address);
  const { data: addresses } = useAllFacilityAddresses();
  const { facilities } = useFacilities(addresses);

  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [firstLoss, setFirstLoss] = useState("");
  const [tenorMinutes, setTenorMinutes] = useState("");
  const [graceMinutes, setGraceMinutes] = useState("");
  const [financingFeeBps, setFinancingFeeBps] = useState(DEFAULT_FINANCING_FEE_BPS);
  const [lateFeePerDayBps, setLateFeePerDayBps] = useState(DEFAULT_LATE_FEE_BPS);
  const [seniorPerJuniorBps, setSeniorPerJuniorBps] = useState(DEFAULT_SENIOR_PER_JUNIOR_BPS);
  const [seniorFeeShareBps, setSeniorFeeShareBps] = useState(DEFAULT_SENIOR_FEE_SHARE_BPS);
  const [capitalCap, setCapitalCap] = useState(DEFAULT_CAPITAL_CAP);

  const mint = useContractAction();
  const approve = useContractAction();
  const open = useContractAction();

  const myFacilities = facilities.filter((f) => address && f.originator.toLowerCase() === address.toLowerCase());

  if (!isConnected || !address) {
    return (
      <section className="panel">
        <h2>Originate</h2>
        <p className="muted">Connect a wallet to open a facility.</p>
      </section>
    );
  }

  if (!deployment) return null;

  const asset = assetContract(deployment.asset);
  const limitUnits = parseUsdc(limit);
  const firstLossUnits = parseUsdc(firstLoss);
  const capitalCapUnits = parseUsdc(capitalCap);
  const minFirstLoss = minFirstLossBps !== undefined ? (limitUnits * minFirstLossBps) / 10_000n : 0n;
  const needsApproval = firstLossUnits > 0n && (allowance ?? 0n) < firstLossUnits;

  const canOpen =
    name.trim() !== "" &&
    limitUnits > 0n &&
    firstLossUnits >= minFirstLoss &&
    capitalCapUnits >= limitUnits &&
    tenorMinutes !== "" &&
    graceMinutes !== "";

  return (
    <section className="originate-page">
      <div className="page-title">
        <h1>Originate</h1>
        <p>Open a new isolated facility and stake its first-loss capital.</p>
      </div>

      <section className="panel">
        <h2>New facility</h2>
        <p className="muted">Tenor and grace are entered in minutes for this demo (converted to seconds onchain).</p>
        <p className="balance-row">
          <span>Wallet balance</span>
          <strong>
            {assetBalance !== undefined ? formatUsdc(assetBalance) : "..."} {deployment.assetSymbol}
          </strong>
        </p>
        {deployment.faucet ? (
          <div className="row">
            <button
              className="btn"
              disabled={mint.isPending || mint.isConfirming}
              onClick={() => mint.writeContractAsync({ ...asset, functionName: "mint", args: [address, MINT_AMOUNT] })}
            >
              {mint.isPending || mint.isConfirming ? "Minting..." : "Get test USDC (100,000)"}
            </button>
            {mint.error && <span className="error">{describeContractError(mint.error)}</span>}
            <TxLink hash={mint.hash} />
          </div>
        ) : (
          <p className="muted">
            Get {deployment.assetSymbol} on Robinhood Chain:{" "}
            <a href="https://docs.robinhood.com/chain/bridging" target="_blank" rel="noreferrer">
              bridging docs
            </a>
            .
          </p>
        )}
        <div className="form-grid">
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Facility name" />
          </label>
          <label>
            Credit limit ({deployment.assetSymbol})
            <input type="text" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </label>
          <label>
            First-loss stake ({deployment.assetSymbol})
            <input type="text" inputMode="decimal" value={firstLoss} onChange={(e) => setFirstLoss(e.target.value)} />
          </label>
          <label>
            Tenor (minutes)
            <input type="text" inputMode="numeric" value={tenorMinutes} onChange={(e) => setTenorMinutes(e.target.value)} />
          </label>
          <label>
            Grace period (minutes)
            <input type="text" inputMode="numeric" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
          </label>
          <label>
            Financing fee (bps)
            <input type="text" inputMode="numeric" value={financingFeeBps} onChange={(e) => setFinancingFeeBps(e.target.value)} />
          </label>
          <label>
            Late fee per day (bps)
            <input type="text" inputMode="numeric" value={lateFeePerDayBps} onChange={(e) => setLateFeePerDayBps(e.target.value)} />
          </label>
          <label>
            Senior per Junior (bps)
            <input type="text" inputMode="numeric" value={seniorPerJuniorBps} onChange={(e) => setSeniorPerJuniorBps(e.target.value)} />
          </label>
          <label>
            Senior fee share (bps)
            <input type="text" inputMode="numeric" value={seniorFeeShareBps} onChange={(e) => setSeniorFeeShareBps(e.target.value)} />
          </label>
          <label>
            Capital cap ({deployment.assetSymbol})
            <input type="text" inputMode="decimal" value={capitalCap} onChange={(e) => setCapitalCap(e.target.value)} />
          </label>
        </div>
        {minFirstLossBps !== undefined && limitUnits > 0n && (
          <p className="muted">
            Minimum first-loss required: {formatUsdc(minFirstLoss)} {deployment.assetSymbol}
          </p>
        )}
        {needsApproval ? (
          <button
            className="btn"
            disabled={approve.isPending || approve.isConfirming}
            onClick={() => approve.writeContractAsync({ ...asset, functionName: "approve", args: [deployment.factory, MAX_UINT256] })}
          >
            {approve.isPending || approve.isConfirming ? "Approving..." : "Approve first-loss stake"}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!canOpen || open.isPending || open.isConfirming}
            onClick={() =>
              open.writeContractAsync({
                ...factoryContract(deployment.factory),
                functionName: "createFacility",
                args: [
                  name,
                  {
                    limit: limitUnits,
                    firstLoss: firstLossUnits,
                    tenor: BigInt(Math.round(Number(tenorMinutes) * 60)),
                    grace: BigInt(Math.round(Number(graceMinutes) * 60)),
                    financingFeeBps: BigInt(financingFeeBps || "0"),
                    lateFeePerDayBps: BigInt(lateFeePerDayBps || "0"),
                    seniorPerJuniorBps: BigInt(seniorPerJuniorBps || "0"),
                    seniorFeeShareBps: BigInt(seniorFeeShareBps || "0"),
                    capitalCap: capitalCapUnits,
                  },
                ],
              })
            }
          >
            {open.isPending || open.isConfirming ? "Opening..." : "Open facility"}
          </button>
        )}
        {(approve.error || open.error) && <p className="error">{describeContractError(approve.error ?? open.error)}</p>}
        <TxLink hash={open.hash} />
      </section>

      <section className="panel">
        <h2>My facilities</h2>
        {myFacilities.length === 0 && <p className="muted">You have not originated any facilities on this network yet.</p>}
        <div className="card-list">
          {myFacilities.map((facility) => (
            <MyFacilityCard key={facility.address} facility={facility} onView={onView} />
          ))}
        </div>
      </section>
    </section>
  );
}

function MyFacilityCard({ facility, onView }: { facility: FacilityData; onView: (facility: Address) => void }) {
  const deployment = useDeployment();
  const { address } = useAccount();
  const now = useNow();
  const { data: allowance } = useAssetAllowance(address, facility.address);

  const [drawAmount, setDrawAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [evidenceText, setEvidenceText] = useState("");

  const drawdown = useContractAction();
  const repayApprove = useContractAction();
  const repay = useContractAction();
  const attachEvidence = useContractAction();

  if (!deployment) return null;

  const asset = assetContract(deployment.asset);
  const facilityCall = facilityContract(facility.address);
  const nowSec = BigInt(Math.floor(now / 1000));
  const dueInSec = secondsUntil(facility.dueAt, nowSec);
  const maxDraw = facility.terms.limit - facility.principal;
  const drawAmountUnits = parseUsdc(drawAmount);
  const repayAmountUnits = parseUsdc(repayAmount);

  const canDrawdown = facility.statusName === "Open" && drawAmountUnits > 0n && drawAmountUnits <= maxDraw;
  const canRepay = (facility.statusName === "Open" || facility.statusName === "Late") && repayAmountUnits > 0n && repayAmountUnits <= facility.owed;
  const repayNeedsApproval = repayAmountUnits > 0n && (allowance ?? 0n) < repayAmountUnits;
  const evidenceHash = evidenceText.trim() !== "" ? keccak256(toBytes(evidenceText.trim())) : undefined;
  const hasEvidence = !/^0x0+$/.test(facility.evidenceHash);

  return (
    <div className="card">
      <div className="card-head">
        <StatusBadge status={facility.statusName} />
        <span className="card-title">{facility.name}</span>
        <button className="text-button" onClick={() => onView(facility.address)}>View →</button>
      </div>
      <p className="muted">
        Due:{" "}
        {facility.dueAt === 0n
          ? "not drawn yet"
          : dueInSec >= 0
            ? `in ${formatDuration(dueInSec)}`
            : `${formatDuration(-dueInSec)} past due`}
      </p>
      <p className="muted">Owed (live): {formatUsdc(facility.owed)} {deployment.assetSymbol}</p>

      <div className="row">
        <input type="text" inputMode="decimal" placeholder="Drawdown amount" value={drawAmount} onChange={(e) => setDrawAmount(e.target.value)} />
        <button
          className="btn"
          disabled={!canDrawdown || drawdown.isPending || drawdown.isConfirming}
          onClick={() => drawdown.writeContractAsync({ ...facilityCall, functionName: "drawdown", args: [drawAmountUnits] })}
        >
          {drawdown.isPending || drawdown.isConfirming ? "Drawing..." : "Drawdown"}
        </button>
      </div>
      {drawdown.error && <p className="error">{describeContractError(drawdown.error)}</p>}
      <TxLink hash={drawdown.hash} />

      <div className="row">
        <input type="text" inputMode="decimal" placeholder="Repay amount" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
        {repayNeedsApproval ? (
          <button
            className="btn"
            disabled={repayApprove.isPending || repayApprove.isConfirming}
            onClick={() => repayApprove.writeContractAsync({ ...asset, functionName: "approve", args: [facility.address, MAX_UINT256] })}
          >
            {repayApprove.isPending || repayApprove.isConfirming ? "Approving..." : "Approve"}
          </button>
        ) : (
          <button
            className="btn"
            disabled={!canRepay || repay.isPending || repay.isConfirming}
            onClick={() => repay.writeContractAsync({ ...facilityCall, functionName: "repay", args: [repayAmountUnits] })}
          >
            {repay.isPending || repay.isConfirming ? "Repaying..." : "Repay"}
          </button>
        )}
      </div>
      {(repayApprove.error || repay.error) && <p className="error">{describeContractError(repayApprove.error ?? repay.error)}</p>}
      <TxLink hash={repay.hash} />

      <div className="row">
        <input
          type="text"
          placeholder="Evidence text (invoice, receipt...)"
          value={evidenceText}
          onChange={(e) => setEvidenceText(e.target.value)}
        />
        <button
          className="btn"
          disabled={!evidenceHash || attachEvidence.isPending || attachEvidence.isConfirming}
          onClick={() => evidenceHash && attachEvidence.writeContractAsync({ ...facilityCall, functionName: "attachEvidence", args: [evidenceHash] })}
        >
          {attachEvidence.isPending || attachEvidence.isConfirming ? "Attaching..." : "Attach evidence"}
        </button>
      </div>
      {evidenceHash && <p className="muted">Hash: {evidenceHash}</p>}
      {hasEvidence && <p className="muted">Stored: {facility.evidenceHash}</p>}
      {attachEvidence.error && <p className="error">{describeContractError(attachEvidence.error)}</p>}
      <TxLink hash={attachEvidence.hash} />
    </div>
  );
}
