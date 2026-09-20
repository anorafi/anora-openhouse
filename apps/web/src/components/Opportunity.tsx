import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { AddressLink } from "./AddressLink";
import { StatusBadge } from "./StatusBadge";
import { TxLink } from "./TxLink";
import { assetContract, facilityContract, MAX_UINT256 } from "../config/contracts";
import { useDeployment } from "../hooks/useDeployment";
import { useAssetAllowance, useAssetBalance } from "../hooks/useAsset";
import { useContractAction } from "../hooks/useContractAction";
import { useFacility } from "../hooks/useFacilities";
import { useMyPosition } from "../hooks/usePositions";
import { describeContractError } from "../lib/errors";
import { bpsToPct, toPct, valueShares } from "../lib/facility";
import { formatDuration, formatUsdc, parseUsdc } from "../lib/format";

const MINT_AMOUNT = 100_000n * 10n ** 6n;

type TrancheChoice = "Senior" | "Junior";

export function Opportunity({
  facility: facilityAddress,
  onBack,
  onComplete,
}: {
  facility: Address | null;
  onBack: () => void;
  onComplete: () => void;
}) {
  const { address, isConnected } = useAccount();
  const deployment = useDeployment();
  const { facility, isLoading } = useFacility(facilityAddress ?? undefined);
  const position = useMyPosition(facilityAddress ?? undefined, address);

  const [depositTranche, setDepositTranche] = useState<TrancheChoice>("Junior");
  const [depositAmount, setDepositAmount] = useState("");
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [acceptedLiquidity, setAcceptedLiquidity] = useState(false);
  const [withdrawTranche, setWithdrawTranche] = useState<TrancheChoice>("Junior");
  const [withdrawShares, setWithdrawShares] = useState("");

  const { data: assetBalance } = useAssetBalance(address);
  const { data: allowance } = useAssetAllowance(address, facilityAddress ?? undefined);

  const mint = useContractAction();
  const approve = useContractAction();
  const deposit = useContractAction();
  const withdraw = useContractAction();

  useEffect(() => {
    if (deposit.isConfirmed) onComplete();
  }, [deposit.isConfirmed]);

  if (!facilityAddress) {
    return (
      <section className="panel">
        <h2>Pick a facility</h2>
        <p className="muted">Choose a facility from Markets to view its detail and supply capital.</p>
        <button className="btn" onClick={onBack}>Back to Markets</button>
      </section>
    );
  }

  if (isLoading || !facility) {
    return (
      <section className="panel">
        <p className="muted">Loading facility...</p>
      </section>
    );
  }

  const asset = assetContract(deployment!.asset);
  const facilityCall = facilityContract(facility.address);
  const depositAmountUnits = parseUsdc(depositAmount);
  const withdrawSharesUnits = parseUsdc(withdrawShares);
  const needsApproval = depositAmountUnits > 0n && (allowance ?? 0n) < depositAmountUnits;
  const canDeposit = acceptedRisk && acceptedLiquidity && depositAmountUnits > 0n && !needsApproval;

  const myShares = withdrawTranche === "Senior" ? position.seniorShares : position.juniorShares;
  const canWithdraw = withdrawSharesUnits > 0n && withdrawSharesUnits <= myShares;

  const seniorValue = valueShares(position.seniorShares, facility.seniorTotalShares, facility.seniorAssets);
  const juniorValue = valueShares(position.juniorShares, facility.juniorTotalShares, facility.juniorAssets);

  const utilization = facility.terms.capitalCap === 0n ? 0 : toPct(facility.totalCapital, facility.terms.capitalCap);
  const protectionPct = facility.totalCapital === 0n ? 0 : toPct(facility.firstLossReserve + facility.juniorAssets, facility.totalCapital);
  const hasEvidence = !/^0x0+$/.test(facility.evidenceHash);

  return (
    <section className="opportunity-page">
      <button className="text-button" onClick={onBack}>
        Markets / <strong>{facility.name}</strong>
      </button>
      <header className="opportunity-heading">
        <div>
          <div className="title-with-status">
            <h1>{facility.name}</h1>
            <StatusBadge status={facility.statusName} />
          </div>
          <span>
            Originated by <AddressLink address={facility.originator} />
          </span>
        </div>
      </header>
      <div className="opportunity-layout">
        <aside className="supply-panel">
          <h2>Supply</h2>
          <p className="panel-copy">Supply capital to the Senior or Junior tranche of this facility.</p>
          {!isConnected || !address ? (
            <p className="muted">Connect a wallet to supply or withdraw capital.</p>
          ) : (
            <>
              <p className="balance-row">
                <span>Wallet balance</span>
                <strong>
                  {assetBalance !== undefined ? formatUsdc(assetBalance) : "..."} {deployment?.assetSymbol}
                </strong>
              </p>
              {deployment?.faucet ? (
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
                  Get {deployment?.assetSymbol} on Robinhood Chain:{" "}
                  <a href="https://docs.robinhood.com/chain/bridging" target="_blank" rel="noreferrer">
                    bridging docs
                  </a>
                  .
                </p>
              )}
              <label>
                Tranche
                <select value={depositTranche} onChange={(e) => setDepositTranche(e.target.value as TrancheChoice)}>
                  <option value="Senior">Senior</option>
                  <option value="Junior">Junior</option>
                </select>
              </label>
              {depositTranche === "Senior" && (
                <p className="panel-copy">Senior capacity left: {formatUsdc(facility.seniorCapacity)} {deployment?.assetSymbol}</p>
              )}
              <label>
                Amount
                <div className="amount-input">
                  <input
                    inputMode="decimal"
                    placeholder={`Amount ${deployment?.assetSymbol}`}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                  <span>{deployment?.assetSymbol}</span>
                  <button onClick={() => assetBalance !== undefined && setDepositAmount(formatUsdc(assetBalance).replace(/,/g, ""))}>Max</button>
                </div>
              </label>
              <label className="review-check">
                <input type="checkbox" checked={acceptedRisk} onChange={(e) => setAcceptedRisk(e.target.checked)} />
                Returns depend on the originator repaying this facility.
              </label>
              <label className="review-check">
                <input type="checkbox" checked={acceptedLiquidity} onChange={(e) => setAcceptedLiquidity(e.target.checked)} />
                Withdrawals are limited to the facility's free liquidity.
              </label>
              {needsApproval ? (
                <button
                  className="accent-button wide"
                  disabled={!acceptedRisk || !acceptedLiquidity || approve.isPending || approve.isConfirming}
                  onClick={() => approve.writeContractAsync({ ...asset, functionName: "approve", args: [facility.address, MAX_UINT256] })}
                >
                  {approve.isPending || approve.isConfirming ? "Approving..." : "Approve"}
                </button>
              ) : (
                <button
                  className="accent-button wide"
                  disabled={!canDeposit || deposit.isPending || deposit.isConfirming}
                  onClick={() =>
                    deposit.writeContractAsync({
                      ...facilityCall,
                      functionName: "deposit",
                      args: [depositTranche === "Senior" ? 0 : 1, depositAmountUnits],
                    })
                  }
                >
                  {deposit.isPending || deposit.isConfirming ? "Depositing..." : "Deposit"}
                </button>
              )}
              {(approve.error || deposit.error) && <p className="error">{describeContractError(approve.error ?? deposit.error)}</p>}
              <TxLink hash={deposit.hash} />

              <div className="form-block">
                <h3>Withdraw</h3>
                <p className="panel-copy">
                  My shares: Senior {formatUsdc(position.seniorShares)} ({formatUsdc(seniorValue)}) · Junior{" "}
                  {formatUsdc(position.juniorShares)} ({formatUsdc(juniorValue)})
                </p>
                <label>
                  Tranche
                  <select value={withdrawTranche} onChange={(e) => setWithdrawTranche(e.target.value as TrancheChoice)}>
                    <option value="Senior">Senior</option>
                    <option value="Junior">Junior</option>
                  </select>
                </label>
                <label>
                  Shares
                  <input
                    inputMode="decimal"
                    placeholder="Shares (1 share = 1 unit deposited)"
                    value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)}
                  />
                </label>
                <button
                  className="secondary-button wide"
                  disabled={!canWithdraw || withdraw.isPending || withdraw.isConfirming}
                  onClick={() =>
                    withdraw.writeContractAsync({
                      ...facilityCall,
                      functionName: "withdraw",
                      args: [withdrawTranche === "Senior" ? 0 : 1, withdrawSharesUnits],
                    })
                  }
                >
                  {withdraw.isPending || withdraw.isConfirming ? "Withdrawing..." : "Withdraw"}
                </button>
                {withdraw.error && <p className="error">{describeContractError(withdraw.error)}</p>}
                <TxLink hash={withdraw.hash} />
              </div>
            </>
          )}
        </aside>
        <section className="market-detail-panel">
          <dl className="opportunity-metrics">
            <div>
              <dt>Limit</dt>
              <dd>{formatUsdc(facility.terms.limit)}</dd>
            </div>
            <div>
              <dt>First-loss</dt>
              <dd>{toPct(facility.terms.firstLoss, facility.terms.limit)}%</dd>
            </div>
            <div>
              <dt>Financing fee</dt>
              <dd>{bpsToPct(facility.terms.financingFeeBps)}%</dd>
            </div>
            <div>
              <dt>Tenor / grace</dt>
              <dd>
                {formatDuration(Number(facility.terms.tenor))} / {formatDuration(Number(facility.terms.grace))}
              </dd>
            </div>
          </dl>
          <div className="detail-section">
            <header>
              <strong>Utilization</strong>
              <span>{utilization}% of capital cap</span>
            </header>
            <progress className="accent-progress" max="100" value={utilization}>{utilization}%</progress>
          </div>
          <div className="detail-section">
            <header>
              <strong>Protection before Senior</strong>
              <span>{protectionPct}% absorbs losses before Senior capital.</span>
            </header>
            <div className="protection-bar">
              <span>{protectionPct}%</span>
              <span>{(100 - protectionPct).toFixed(2)}%</span>
            </div>
          </div>
          <div className="detail-section">
            <h2>Facility overview</h2>
            <dl className="detail-list">
              <div>
                <dt>Settlement asset</dt>
                <dd>{deployment?.assetSymbol}</dd>
              </div>
              <div>
                <dt>Principal outstanding</dt>
                <dd>{formatUsdc(facility.principal)}</dd>
              </div>
              <div>
                <dt>Owed (live)</dt>
                <dd>{formatUsdc(facility.owed)}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{hasEvidence ? `${facility.evidenceHash.slice(0, 14)}…` : "not attached"}</dd>
              </div>
            </dl>
          </div>
          <div className="inline-links">
            <span>Facility on explorer:</span>
            <AddressLink address={facility.address} className="text-link" />
          </div>
        </section>
      </div>
    </section>
  );
}
