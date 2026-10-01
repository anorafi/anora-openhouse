# Risk model (ANO-41)

Facility-specific Senior capacity, calculated from modeled trade-credit losses, with the structure enforced by the contract and frozen at creation. No screen, field, label, or transaction step changes.

## What it does

For a facility with capital cap `C`, originator first-loss reserve `R`, funded Junior `J`, and Senior `S` (`P = S + J`), horizon `H`, and net collections `Q_s(H)` per scenario `s`:

```
L_s(P, H) = max(0, P - Q_s(H))
R          >= VaR_aR(L)
R + J      >= VaR_aS(L)             with aS > aR
CVaR_aS(max(0, L - R - J)) / S <= eS   when S > 0
R + J + S  <= C
```

The solver (`apps/web/src/lib/trancheModel.ts`, `planTranches`) finds the largest safe `S` for the existing stake `R` and the Junior actually funded `J`. It is deterministic: same input and policy give the same output and the same snapshot hash. Junior that is not funded is never counted as protection. If no structure is feasible the capacity is zero and the existing UI shows zero availability.

At creation `J = 0`, so the plan gives `S0`. It is submitted as two numbers the contract already understands:

| Plan output | Contract term |
|---|---|
| `seniorPerJuniorBps = floor(S0 * 10_000 / R)` | `seniorPerJuniorBps`, enforced by `seniorCapacity()` |
| `capitalCap = R + S0` | `capitalCap`, enforced by `deposit` |

`capitalCap = R + S0` caps total provider capital at `S0`, so adding Junior later cannot push the reserve past its quantile.

## Policy parameters (versioned)

`POLICY_V1`: `varReserve` 0.90, `varSenior` 0.99, `tailSenior` 0.02, `recoveryWindowDays` 30, `dustUnits` 10,000. These are explicit Anora policy constants, not values implied by any paper. A change means a new `version`.

## Scenarios and assumptions

Five buyer buckets (the largest buyer gets the underwriting share, default 40 percent, the rest split evenly), each paying, paying late, or defaulting, in two regimes (normal and a systemic shock with elevated default probability). Late and recoverable invoices are modeled separately from permanent default: a late invoice is collected by `H` if its delay fits inside the grace plus the recovery window, a default recovers `recovery * (1 - cost)` scaled by `min(1, window / delay)`. Tenor, route (corridor multiplier), financing type, severity, concentration, and recovery delay all feed the distribution. Raising any of them never raises Senior capacity (property-tested).

**The assumptions are illustrative demo assumptions, not calibrated default rates.** They are labelled `illustrative` in every snapshot. With verified underwriting data (`largestBuyerPct`) the snapshot says `verified`. On a live network without verified data the listing is blocked (`UNVERIFIED_DATA_BLOCKED`); on a faucet (test) network the illustrative assumptions are allowed.

## Snapshot

Every plan carries the model version, policy, inputs, assumptions, outputs (`R/J/S`, capacity, attachment points), and eligibility reason, and the keccak256 of its canonical JSON (`snapshotHash`). It is frozen on chain at creation.

## Feature flag

`features.riskModel` in the runtime manifest, default `false`, set at build time with `RISK_MODEL=1`. With the flag off the app sends exactly the previous terms (ratio 22,500, `capitalCap = limit`) through the original `createFacility` and the screens are unchanged. With it on, `planFacility` (`apps/web/src/lib/facilityPlan.ts`) is the single function behind the originator preview and the create transaction, and `createFacilityWithModel` records the model.

## Contract changes

Redeploying the factory is required. Existing facilities are not changed.

- `AnoraFactory.createFacilityWithModel(name, terms, modelVersion, snapshotHash)` next to the unchanged `createFacility`. Both versions and hash must be non-zero. Emits `TermsFrozen(facility, modelVersion, snapshotHash, seniorPerJuniorBps, capitalCap)`.
- `AnoraFacility.initializeWithModel` stores `modelVersion` and `snapshotHash`. There is no setter, so they are immutable. `terms` is unchanged.
- `AnoraFactory.MAX_SENIOR_PER_JUNIOR_BPS = 100_000`: a higher ratio is `InvalidTerms`.
- `AnoraFacility.withdraw` (Junior): reverts `JuniorProtectionBreached` if, while the facility is Open or Late and Senior capital exists, `seniorAssets > (juniorAssets_after + firstLossReserve) * seniorPerJuniorBps / 10_000`. Closed and Defaulted facilities are never blocked, so no capital is trapped after repayment or default.
- `_distributeFee`: when no Senior holder exists, the whole fee goes to Junior (mirrors the earlier Junior-empty fix).

Senior deposits above the facility's calculated cap already revert (`SeniorCapacityExceeded`, `CapitalCapExceeded`). The ABI only grows; the web app and the indexer decode the new event (`TermsFrozen`), and the facility summary carries `model`.

## Tests

- TypeScript: named fixtures (zero or too small stake, missing data, rounding, correlated defaults, delayed recovery, no feasible structure), determinism, and property tests that capacity never rises with severity, concentration, tenor, or recovery delay and never falls with a bigger stake (limit not binding).
- Foundry: unit tests for each revert and the snapshot, a fuzz test that every holder can exit after full repayment (Senior-only, Junior-only, both), a fuzz test that a Junior withdrawal reverts only when Senior would lose protection, a stateful invariant suite (Senior stays protected while exposed, asset balance matches the ledger, no safe Junior withdrawal is rejected), and a fixture shared with the TypeScript test (ratio 21,880, cap 95,642,572).

## Deliberately not done

- No manifest switch to the new factory, no deployment, no seeding. The flag stays off until the new factories are verified.
- Calibration against real default data. The assumptions are illustrative until verified underwriting records exist.
- `seniorFeeShareBps` and the late-fee rate are still fixed values in the UI, not derived from the model.
- The grace-start rule (`dueAt` or `markLate`) is unchanged.
- No new UI to explain a blocked listing: the open button stays disabled.
