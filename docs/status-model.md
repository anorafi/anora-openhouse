# Facility and position status model

Linear: ANO-29. This document is the single reading of the contract state that the web app and the indexer must agree on. It is backed by fixtures that Foundry writes from the real contract, and both the web app and the indexer run those fixtures in their tests.

Facility status describes the facility. Position status describes one wallet's claim on it. They are separate on purpose: `settled` in the UI is wallet-shaped, but the UI badge sits on the facility.

## Where the truth comes from

| Source | Used for |
|---|---|
| Contract getters | `status` (Open, Late, Defaulted, Closed), `principal`, `fee`, `dueAt`, `lateSince`, `firstLossReserve`, `seniorAssets`, `juniorAssets`, `seniorTotalShares`, `juniorTotalShares`, `losses()`, per-wallet `seniorShares` and `juniorShares` |
| Events | `Deposited`, `Withdrawn`, `Drawn`, `Repaid`, `MarkedLate`, `DefaultDeclared`, `Recovered`, `FacilityClosed` |
| Clock | `block.timestamp` against `dueAt`, only for the past-due overlay |

The web app reads getters (`apps/web/src/lib/book.ts`, `stageOf`). The indexer folds events (`apps/indexer/src/derive.ts`). The fixtures prove both give the same answer for the same history.

Terms used below: **shares** is `seniorTotalShares + juniorTotalShares`. **Outstanding loss** is `lossFirstLoss + lossJunior + lossSenior` from `losses()`.

## Facility status

| Status | Predicate | Web stage and label | Web market status | Indexer |
|---|---|---|---|---|
| DRAFT | Offchain only. No contract exists yet. | none | none | none |
| FUNDING | `status` is Open, `dueAt` is 0, shares is 0 | `open`, "Seeking capital" | Open | FUNDING |
| FUNDED | `status` is Open, `dueAt` is 0, shares above 0 | `funded`, "Funded" | Funding | FUNDED |
| ACTIVE | `status` is Open and `dueAt` above 0 | `drawn`, "Drawn" | Active | ACTIVE |
| LATE | `status` is Late | `late`, "Past due" | Late | LATE |
| DEFAULTED | `status` is Defaulted and outstanding loss above 0 | `defaulted`, "Defaulted" | Defaulted | DEFAULTED |
| RECOVERED | `status` is Defaulted, outstanding loss is 0, shares above 0 | `recovered`, "Recoveries in" | Recovered | RECOVERED |
| REPAID | `status` is Closed and shares above 0 | `repaid`, "Repaid" | Repaid | REPAID |
| CLOSED | REPAID or RECOVERED, and shares is 0 | `settled`, "Settled" (came from REPAID) or `closed`, "Closed at loss" (came from RECOVERED) | Settled or Closed | CLOSED |

Notes on the predicates:

- **ACTIVE uses `dueAt`, not `principal`.** `dueAt` is set at the first drawdown and never cleared. The contract closes the facility the moment principal and fee both reach zero, so Open with `dueAt` above 0 always means something is still owed. Principal can be 0 while the fee is not: `repay` pays principal first, so repaying exactly the principal leaves the fee outstanding and the facility Open. Reading "drawn" from `principal` alone mislabels that state as FUNDED and offers the market to new capital.
- **FUNDED is about shares held now, not deposits ever made.** A provider who deposits and then withdraws everything before any drawdown leaves the facility FUNDING again.
- **Past due overlay.** ACTIVE with `block.timestamp` above `dueAt` is "past due, keeper pending". The indexer exposes it as `pastDue`. The web app shows no overlay and keeps the Drawn badge until `markLate` lands. Drawdown already reverts in that window (`PastDue`).
- **RECOVERED is derived.** The contract has no recovered state. After full recovery `status` stays Defaulted and `losses()` is all zero.
- **CLOSED is terminal and has no claimants.** Both UI badges that map to it come from different histories, so the web app keeps two stages. The "Closed at loss" label on the recovered path is misleading, because full recovery leaves no loss. See open decisions.
- **Defaulted with outstanding loss and no shares** is still DEFAULTED, in both implementations.

## Position status

Per wallet and facility, from that wallet's shares:

| Status | Predicate | Web action |
|---|---|---|
| NONE | The wallet never deposited. | "Funding closed", or "View market" while the facility accepts capital |
| HELD | Shares above 0 and the facility is not REPAID or RECOVERED | "View position" |
| CLAIMABLE | Shares above 0 and the facility is REPAID or RECOVERED | "Claim funds" |
| SETTLED | Shares are 0 after at least one deposit | "View history" |

`marketAction` returns "View market" first whenever the facility still has capacity to supply, whatever the wallet holds.

## Transitions

```
FUNDING -> FUNDED            first deposit
FUNDED  -> FUNDING           all shares withdrawn before a drawdown
FUNDED  -> ACTIVE            drawdown (originator, before dueAt)
ACTIVE  -> REPAID            principal and fee both paid (repay closes the facility)
ACTIVE  -> LATE              markLate (anyone, after dueAt, principal above 0)
LATE    -> REPAID            full repayment
LATE    -> DEFAULTED         declareDefault (risk agent, after grace)
DEFAULTED -> RECOVERED       recordRecovery clears the outstanding loss
REPAID / RECOVERED -> CLOSED last share withdrawn
```

Transitions that cannot happen, and what stops them. Each has a Foundry test in `contracts/test/Lifecycle.t.sol`.

| Attempt | Reverts with | Why |
|---|---|---|
| declareDefault while Open | `FacilityNotLate` | default needs a late mark first |
| declareDefault before grace ends | `GraceNotElapsed` | grace starts at `markLate` |
| declareDefault by anyone but the risk agent | `NotRiskAgent` | only the factory's risk agent can |
| markLate before `dueAt` | `NotPastDue` | not late yet |
| markLate with no drawdown | `NotPastDue` | nothing is owed |
| markLate twice | `FacilityNotOpen` | status is already Late |
| markLate after close | `FacilityNotOpen` | status is Closed |
| drawdown after Late or Closed | `FacilityNotOpen` | only an Open facility lends |
| drawdown after `dueAt`, not yet marked | `PastDue` | keeper delay cannot extend lending |
| recordRecovery while Open | `NothingToRecover` | there is no loss |
| recordRecovery above the loss | `NothingToRecover` | cannot recover more than was lost |
| recordRecovery after full recovery | `NothingToRecover` | outstanding loss is 0 |
| repay after default | `Overpayment` | default zeroes principal and fee |
| repay above what is owed | `Overpayment` | |
| withdraw more shares than held | `InsufficientShares` | |
| withdraw lent-out capital | `InsufficientLiquidity` | liquidity excludes the first-loss reserve and lent principal |

## Fixtures

`contracts/test/Lifecycle.t.sol` runs the cycle on the real contract and writes `contracts/test/fixtures/status/<scenario>.json`. Each file holds the raw getter values, every factory and facility log, the clock, and the expected statuses. Regenerate with `forge test --match-contract LifecycleTest`. The output is deterministic.

The web app (`apps/web/src/lib/statusFixtures.test.ts`) and the indexer (`apps/indexer/src/statusFixtures.test.ts`) both load every fixture. Both also assert the scenario list, so a missing fixture fails the build.

| Scenario | Facility | Web stage | Position (provider) |
|---|---|---|---|
| funding | FUNDING | open | NONE |
| funded | FUNDED | funded | HELD |
| funded_withdrawn | FUNDING | open | SETTLED |
| active | ACTIVE | drawn | HELD |
| active_fee_only | ACTIVE | drawn | HELD |
| past_due_unmarked | ACTIVE, `pastDue` true | drawn | HELD |
| late | LATE | late | HELD |
| defaulted | DEFAULTED | defaulted | HELD |
| recovered_partial | DEFAULTED | defaulted | HELD |
| recovered_full | RECOVERED | recovered | CLAIMABLE |
| closed_after_recovery | CLOSED | closed | SETTLED |
| repaid | REPAID | repaid | CLAIMABLE |
| settled | CLOSED | settled | SETTLED |

## Differences found while writing this, and fixed

| Where | Before | After |
|---|---|---|
| Web `stageOf`, `active_fee_only` | `funded`, so the market offered the facility to new capital while a fee was owed | `drawn` |
| Indexer, `funded_withdrawn` | FUNDED, because it remembered any past deposit | FUNDING, from shares held now |
| Indexer, `settled` and `closed_after_recovery` | REPAID and RECOVERED even with no shares left | new CLOSED status |

The web app does not read facility status from the indexer, so adding CLOSED to the API changes no screen.

## Open decisions and contract risks

Nothing here is decided. The contract was not changed for ANO-29.

1. **Explicit recovery signal.** Full recovery is only visible as Defaulted plus zero outstanding loss. Options: an event, a new status, or keep deriving it.
2. **Grace start.** Grace runs from `markLate`, so a late keeper delays default. The alternative is to run it from `dueAt`.
3. **Broader CLAIMABLE.** The Notion model reads CLAIMABLE as shares above 0 and withdrawable liquidity above 0. The implementations narrow it to REPAID or RECOVERED, so a provider in a FUNDED facility or after a partial recovery shows HELD although a withdrawal would succeed.
4. **"Closed at loss" label.** The `closed` stage is a facility that defaulted, was fully recovered, and had every share withdrawn. No loss remains, so the label is wrong. The copy is Gama's, so it was not changed.
5. **`deposit` has no status check.** Verified: a Junior deposit succeeds in a Defaulted facility and in a Closed one. Senior is blocked only by capacity. The UI hides the form, the contract does not stop it.
6. **Recovery after every holder left.** Verified: after a default, all shares withdrawn, then `recordRecovery`, the recovered amount (3 USDC in the test) is credited to `seniorAssets` with `seniorTotalShares` at 0 and stays in the facility with no claimant.
7. **Unused market status.** `MarketStatus` includes "Paused", but no stage maps to it.
