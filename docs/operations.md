# Operations

Three roles hold three different keys. None of them is a business login: each is an address with one narrow power.

## Roles

| Role | Address | Power | Cannot do |
|---|---|---|---|
| Owner (Robinhood factory) | `0x07dF8cd6D20b71ba7F16309d2844B88d1043fFfB` | `setRiskAgent`, `setOriginatorApproved`, `setMinFirstLossBps`, `pause`, `unpause`, `transferOwnership` (two-step) on each factory | declare default (rejected with `NotRiskAgent`), move depositor funds |
| Owner (Arbitrum Sepolia factory) | `0x845b2fcEd375929b34017106463b4aCb2D9ca099` | same powers as above on the Sepolia factory only; a separate testnet key whose only routine job is approving originators through the self-serve endpoint | everything on Robinhood |
| Risk agent | `0x77E6296ff0b10eDc6e74a38c491c3e28c501D064` | `declareDefault(reason)` after the grace period, on every facility | change roles, approve originators, pause |
| Keeper | `0xD86D0f3f813cD63660a023ccDD34D0fc5C6190C3` | sends `markLate()` after `dueAt` (the call is permissionless, so the address needs no role and only pays gas) | anything else |

Facilities read the risk agent from their factory on every call, so `setRiskAgent` on the factory changes it for every existing and future facility of that factory.

## Factories

| Chain | Factory |
|---|---|
| Arbitrum Sepolia (421614) | `0x6D051e17Be86CC7e3f24AbAf1393028c5B800c83` |
| Robinhood Chain (4663) | `0x2Db15442C0242c5A0498E6Ff58a37e86E2d63692` |

Current addresses are always in `contracts/deployments.json` and in the published `manifest.json`.

## Secrets

All in the secret bundle `anora-openhouse` (never in the repo, chat, or wiki):

| Name | Holds |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | Robinhood owner key, also the gas and test-token funder for browser checks |
| `SEPOLIA_OWNER_PRIVATE_KEY` | Arbitrum Sepolia owner key, read by the indexer for self-serve approvals |
| `RISK_AGENT_PRIVATE_KEY` | risk agent key |
| `KEEPER_PRIVATE_KEY` | keeper key |
| `KEEPER_PRIVATE_KEY_OLD` | previous keeper key (it was the owner key); delete once no longer needed |
| `DEMO_INVESTOR_PRIVATE_KEY`, `DEMO_ORIGINATOR_PRIVATE_KEY` | demo wallets |

Run anything that signs through `secret with anora-openhouse -- <command>`.

## Keeper

- Unit: `anora-keeper` (systemd user unit), started with `secret with anora-openhouse -- bun run src/index.ts` in `apps/keeper`.
- It reads `contracts/deployments.json` once at start. After any factory redeploy, restart it: `systemctl --user restart anora-keeper`. A keeper started before the redeploy watches the old factory.
- Check: `systemctl --user status anora-keeper` and `journalctl --user -u anora-keeper -n 20`. Each poll logs one line per chain with the facility count.
- Keep a little native gas on the keeper address on both chains.

## Approving originators

`setOriginatorApproved(address, true)` from the owner on the factory. `false` blocks new facilities only; existing facilities keep repaying and paying out.

### Self-serve on Arbitrum Sepolia

Any wallet can open a facility on Arbitrum Sepolia without asking us. When a connected wallet opens "Open a facility" and `approvedOriginators(wallet)` is false, the web app calls `POST /v1/originator-approvals` with `{chainId, address}` on the indexer API. The indexer signs `setOriginatorApproved(address, true)` with `SEPOLIA_OWNER_PRIVATE_KEY` and answers once the receipt is mined. The contract is unchanged, so the allowlist and revocation still work.

- Only chains whose manifest entry has `features.selfServeOriginator` accept the call. The manifest builder sets it for chains with a faucet (Sepolia) and `SELF_SERVE_ORIGINATOR=0` turns it off. Robinhood (real USDG) never has it: originators there stay approved by hand.
- Limits: 5 requests per minute per client, one approval per address per 60 seconds, approvals sent one at a time. Already-approved wallets get `alreadyApproved: true` and no transaction.
- Errors: `CHAIN_NOT_SUPPORTED` 400, `INVALID_ADDRESS` 400, `OWNER_UNAVAILABLE` 503 (key missing), `RATE_LIMITED` 429, `APPROVAL_FAILED` 502.
- Turn it off without a redeploy of the contract: unset `SEPOLIA_OWNER_PRIVATE_KEY` for the indexer unit and restart it (the endpoint answers 503 and the page falls back to the normal "not approved" message), or rebuild the manifest with `SELF_SERVE_ORIGINATOR=0`.
- Revoke one wallet: `setOriginatorApproved(address, false)` from the Sepolia owner. The wallet would be approved again the next time it opens the page, so also turn self-serve off if the revoke must stick.
- Rotate the Sepolia owner key: `transferOwnership(next)` then `acceptOwnership()` from `next`, then `secret set` the new value under `SEPOLIA_OWNER_PRIVATE_KEY` and restart `anora-indexer`.
- Risk: the key sits in the server's secret store and signs automatically. It controls the Sepolia factory only (test tokens, no real value), but it can approve originators, set the risk agent and pause. Keep a little native gas on it.

## Emergency pause

`pause()` on a factory stops new facility creation only. Existing facilities keep accepting repayments and withdrawals. `unpause()` reverses it.

## Rotation

- **Risk agent:** create a new key, fund it with gas, then owner calls `setRiskAgent(newAddress)` on each factory. Verify `riskAgent()` on the factory and on one facility.
- **Keeper:** create a new key, fund it, `secret set` the new value, restart the unit, wait for a `markLate` or a poll line from the new address.
- **Owner:** `transferOwnership(next)`, then `acceptOwnership()` from `next`.

## If a key leaks

| Key | Impact | Recovery |
|---|---|---|
| Keeper | only its gas balance; `markLate` is permissionless anyway | rotate the keeper, sweep leftover gas |
| Risk agent | can declare default on a late facility past grace | owner calls `setRiskAgent` on each factory immediately |
| Owner | can change the risk agent, approve originators, pause creation (Sepolia owner: testnet only, see Self-serve above) | move to a new owner if the key is still controlled; otherwise deploy a new factory and stop listing the old one. Facilities of the old factory keep taking their risk agent from it |

## Verification used on 30 Sep 2026

On Arbitrum Sepolia, a short-tenor test facility was drawn, marked late by the keeper address above (the transaction sender is the keeper, not the owner), and defaulted by the risk agent address. The owner address is rejected with `NotRiskAgent` when it tries `declareDefault`.
