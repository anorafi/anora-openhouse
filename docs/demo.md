# Demo data

Curated facilities for the submission demo. Robinhood Chain is the default network; Arbitrum Sepolia stays selectable and has a faucet.

## Factories

| Chain | Factory |
|---|---|
| Robinhood Chain (4663, USDG) | `0x2Db15442C0242c5A0498E6Ff58a37e86E2d63692` |
| Arbitrum Sepolia (421614, TestUSDC) | `0x6D051e17Be86CC7e3f24AbAf1393028c5B800c83` |

Opening a facility on Arbitrum Sepolia needs no approval from us: the page approves the connected wallet automatically through the indexer (see Self-serve in `docs/operations.md`). On Robinhood the factory owner still approves originators by hand. The Sepolia factory owner is `0x845b2fcEd375929b34017106463b4aCb2D9ca099`; the old owner (deployer) no longer owns it.

## Robinhood facilities

| Kind | Name | Address |
|---|---|---|
| open | Sumatra Coffee Receivables 31 | `0x42D8bC6F1b386D3495d80D49a5A085D26176a6e1` |
| open | Java Cocoa Purchase Orders 52 | `0xeCC9E2E491bDCDf8Ba03DCF7A347237ea1798dFf` |
| open | Thailand Rice Shipment 61 | `0x322eEb199a377167F90A08Beea573DF7272dab1f` |
| active | Vietnam Cashew Export 44 | `0x0b4ea63e5a64F3a3713e896338DE3981bb1316D5` |
| late | Penang Electronics Order 47 | `0x54eAa0B38E694f51b2e6dbb0B7d38CF334C1F384` |
| recovered | Chattogram Garment Order 55 | `0xEA88831f9628679C2a262D0B4EAa0Ba57E8caBAA` |
| repaid | Kochi Spice Receivables 38 | `0x2Bd14d1AD47f548Cc0FF78B14D71b4A587d0671F` |

## Arbitrum Sepolia facilities

| Kind | Name | Address |
|---|---|---|
| open | Sumatra Coffee Receivables 71 | `0x93bE29aEeA1bEaE2298a03d04Db5B68d373E6A34` |
| open | Java Cocoa Purchase Orders 72 | `0x50973Fe15f1f3e68e354FD7EfA7c69C1f1Ad7764` |
| open | Thailand Rice Shipment 73 | `0x7104a40b5A49DBCdB5cb84A9693C1cDE942c85F4` |
| active | Vietnam Cashew Export 74 | `0x2030416d861c6Ecc9f06d6eaA8139FDC8C4C8398` |
| late | Penang Electronics Order 75 | `0x104184c5C040F727E289846551BB751b611F7Dbd` |
| recovered | Chattogram Garment Order 76 | `0x0B5E59f5a5dBC083607bb030CE5CF1688372d939` |
| repaid | Kochi Spice Receivables 77 | `0x242c0460A56d4c1784783884Dbc7afeB932e2529` |

Kinds: open = open for supply, tenor 60/90/120 days, active = drawn, repayable by the originator, late = past due, marked late by the keeper, recovered = defaulted, fully recovered, claimed, repaid = full cycle: supply, draw, repay, claim. Two Open facilities on Robinhood carry an approved and anchored underwriting record and one is a sample; on Sepolia one is anchored, one is approved but not anchored, one is a sample.

## Sepolia: sized demo and spare facilities (2 Oct 2026)

The curated set above uses very small amounts. For the recording, Sepolia also has a sized set, seeded with `PROFILE=sized`, and a faucet that gives 10,000 TestUSDC per claim (the default draft in the open-facility form is 5,000 to 20,000, so one claim covers its first-loss).

| Kind | Name | Address | Notes |
|---|---|---|---|
| open | Mekong Rubber Consignment 81 | `0xe1667Ca261622288bDfd816a7A19c6035c12B38C` | limit 20,000, first-loss 4,000, underwriting approved and anchored. Holds 6,000 TestUSDC of test deposits from the browser checks |
| open | Sihanoukville Rice Cargo 82 | `0x6D6f62D5591E3c18daF0F1B2Daa4538ed04cAcb4` | limit 20,000, first-loss 4,000, approved but not anchored. Untouched |
| open | Surabaya Coffee Forward 83 | `0xf7FF52Daf2B0d761e15722E988a2c18e024C3466` | limit 20,000, first-loss 4,000, no record (sample label). Untouched |
| late (spare) | Cebu Shrimp Export 84 | `0x9352E9Cc75d0b19aDd6Ae1ddBB26Cb07f6a8A0EC` | tenor 120 s, grace 90 s, drawn 6,000. Marked late by the keeper; not defaulted, not repaid |
| late (spare) | Colombo Tea Auction 85 | `0xbd08BDADC018B9Af94526a73D1d7C934922F6F17` | same as above |
| active (spare) | Karachi Textile Shipment 86 | `0x99B4E0Ba038EF50E6D511F15F9aEb23385301409` | tenor 90 days, drawn 6,000, not repaid |

Open facilities have Senior capacity 9,000 (2.25 times the first-loss) and up to 16,000 of Junior room, so a Senior and a Junior supply of 1,000 each updates the portfolio visibly.

### Recording a transition on chain

The spare facilities are there so that a transition can be done live instead of waiting for time to pass. Each step is a real transaction:

- Default: the grace period of the two late facilities is already over. The risk agent wallet declares default with a reason, then the originator wallet remits the recovery and the supplier claims.
- Repayment: the originator wallet repays 6,300 (6,000 principal and 5 percent fee) on the active facility or on a late one, then the supplier claims. The demo originator holds enough TestUSDC for it.
- Signers: the risk agent wallet for default, the originator wallet for repay and recovery, the investor wallet for claims.

```bash
secret with anora-openhouse -- env CHAIN=sepolia PROFILE=sized bun run apps/indexer/scripts/seed-demo.ts
```

Running it again adds a new set with the same names, so change the numbers in `sizedPlan` first.

## Repeat the seed

The plan lives in `apps/indexer/scripts/demoPlan.ts` (checked by `demoPlan.test.ts`: first loss at least 10 percent of the limit, Senior within capacity, at most 2 USDG locked in Open facilities). The seed creates new facilities on every run, so run it once per factory.

```bash
secret with anora-openhouse -- env CHAIN=robinhood bun run apps/indexer/scripts/seed-demo.ts
secret with anora-openhouse -- env CHAIN=sepolia bun run apps/indexer/scripts/seed-demo.ts
```

It tops up gas from the deployer, uses the faucet on Sepolia, waits for the short tenors, lets the keeper mark the Late facility, and writes `~/.cache/claude-work/seed-<chain>.json`. Restart `anora-keeper` after a new factory so it watches it.

## USDG ledger (Robinhood, 1 Oct 2026)

| Wallet | Before | After |
|---|---|---|
| Originator | 6.8 | 7.45 |
| Investor | 13.08 | 10.63 |
| Deployer | 29.997525 | 29.997525 |
| Facilities | 0 | 1.8 |
| Total | 49.877525 | 49.877525 |

Facilities hold 1.8 USDG: 0.9 first loss in the three Open facilities (returned only when they draw and close), 0.4 first loss in the Active and Late facilities (returned when they close), and 0.5 supplied from the browser check into one Open facility. The 0.12 USDG stranded earlier in the old facility `0xd0dE25BbB45a1Cd2C331E32f74d542ee8898cB56` is not part of this ledger and cannot be withdrawn.
