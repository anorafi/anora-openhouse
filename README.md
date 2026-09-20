# Anora Open House

Isolated onchain credit facilities for curated originators. Each facility is
its own vault (a minimal clone opened through `AnoraFactory`) with Senior and
Junior tranches; the originator stakes first-loss capital, draws liquidity,
and repays with a financing fee. A default in one facility never touches
another. Late payments pause drawdown automatically. Default is declared by a risk
agent with the reason recorded onchain, first-loss capital absorbs the loss
first, and recoveries flow back through the waterfall, Senior first.

Built for the Arbitrum Open House Singapore 2026 buildathon. Target chain:
Arbitrum Sepolia.

| Contract | Robinhood Chain (mainnet, USDG) |
|---|---|
| AnoraFactory | [`0x9a01C5E22602E565d39067454dD70c38D063D328`](https://robinhoodchain.blockscout.com/address/0x9a01C5E22602E565d39067454dD70c38D063D328) |
| AnoraFacility (implementation) | [`0x8695a1C6AD462DFc7a6cb7980dB99D9Eb1c26F6f`](https://robinhoodchain.blockscout.com/address/0x8695a1C6AD462DFc7a6cb7980dB99D9Eb1c26F6f) |
| USDG | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |

| Contract | Arbitrum Sepolia |
|---|---|
| AnoraFactory | [`0xDD4977E7D6249d0c5035Ed55DB1c710Fec4E9707`](https://sepolia.arbiscan.io/address/0xDD4977E7D6249d0c5035Ed55DB1c710Fec4E9707) |
| AnoraFacility (implementation) | [`0x58D4b3A476Bf7033661277432b0B96716011a02f`](https://sepolia.arbiscan.io/address/0x58D4b3A476Bf7033661277432b0B96716011a02f) |
| TestUSDC | [`0x38513243bA873d05b8b1E6622fE12e7685E4eAc6`](https://sepolia.arbiscan.io/address/0x38513243bA873d05b8b1E6622fE12e7685E4eAc6) |

Monorepo, Bun workspaces.

```
contracts/   Foundry: AnoraFactory, AnoraFacility, tests, deploy script
apps/        web and api (coming)
packages/    shared code (coming)
```

```
bun install
bun run test:contracts
```

## apps/web

Live demo build: https://openhouse.anora.finance (redeploy with `bin/deploy-web.sh`).

Vite + React + TypeScript + wagmi v2 + viem, talking directly to `AnoraFactory`
and each `AnoraFacility` clone (plus the pool asset) through an injected
wallet (MetaMask). Plain CSS, no UI framework. Single-page app with hash
routing (`src/lib/route.ts`); no server-side state.

```
bun run dev:web      # http://127.0.0.1:5173
bun run build:web     # type-checks then builds apps/web/dist
bun run test:web      # vitest: waterfall math, facility figures, route parsing, formatting, deployments map
```

### Factory model

The protocol is one `AnoraFactory` per chain opening isolated `AnoraFacility`
clones (`Clones.clone`), not a single shared pool. Each facility has its own
Senior/Junior capital, first-loss stake, drawdown, and late/default/recovery
waterfall; a default in one facility never touches another. The factory holds
the protocol-level `riskAgent()` and `minFirstLossBps()` floor; every facility
reads `riskAgent()` back from its factory rather than storing its own.

### Pages

| Route | Page | What it does |
|---|---|---|
| `#markets` | Markets | `factory.allFacilities()`, one live card per facility (status, limit, capital/cap, first-loss %, Senior capacity, tenor/grace, financing fee, evidence). |
| `#opportunity/<facility>` | Opportunity | Facility detail plus the supply panel (approve → `deposit(tranche, amount)`) and the withdraw panel (`withdraw(tranche, shares)`). |
| `#portfolio` | Portfolio | My Senior/Junior shares across every facility, valued live pro rata against each tranche's assets; no fabricated chart. |
| `#activity` | Activity | `getLogs` over the last ~50,000 blocks across every facility, filtered to events where the connected wallet is the provider or the originator. |
| `#originate` | Originate | Form to `createFacility` (approve first-loss stake to the factory first) plus a live list of facilities I originated, each with drawdown, repay, and evidence-hash attachment. |
| `#risk` | Risk | Every facility with due/late/grace countdowns; mark late (anyone, past due), declare default (risk agent only, reason required, after grace), record recovery (after default). |

Every number on every page is a live contract read (`useFacilities`,
`useFactory`, `useAsset`, `usePositions`, refetched every ~5s and after each
transaction); every button sends a real transaction through
`useContractAction` (`writeContract` + `useWaitForTransactionReceipt`), there
is no mock data left in `src/components`.

### Supported networks

| Network | Chain ID | Asset | Faucet |
|---|---|---|---|
| Arbitrum Sepolia | 421614 | TestUSDC | yes, `mint(address,uint256)` |
| Robinhood Chain | 4663 | USDG | no |

`contracts/deployments.json` is the single source of truth for both networks:
factory address, asset address and symbol, whether the asset has a public
faucet, and the block explorer base URL. `apps/web/src/config/deployments.ts`
imports that file directly (`resolveJsonModule`) and exposes
`deploymentFor(chainId)`; nothing about a network is hardcoded in the UI
beyond the chain definitions in `apps/web/src/config/wagmi.ts`. The header's
network selector calls `switchChain`, and every read/write hook pulls its
factory/asset address from `useDeployment()`
(`apps/web/src/hooks/useDeployment.ts`), keyed by the connected `chainId` so
switching networks never shows stale data. A chain missing from the file
shows a "not supported" card with a chain switcher instead of the app.

ABIs are generated, not hand-written: `bun scripts/export-abi.ts` reads
`contracts/out/{AnoraFactory,AnoraFacility,TestUSDC}.sol/*.json` (run
`forge build` in `contracts/` first) and writes `apps/web/src/abi/*.ts` as
`as const` arrays. Re-run it whenever a contract's interface changes, and
commit the output. The generated `TestUSDCAbi` is a plain ERC-20 subset
(balanceOf, allowance, approve, mint) reused for USDG on Robinhood Chain; the
mint button only renders when the active network's `faucet` flag is true.

**Tenor-in-minutes demo convention**: `AnoraFacility.Terms.tenor` and
`.grace` are seconds onchain, but Arbitrum Sepolia is a live network we
cannot warp time on. The Originate form takes both in **minutes** and
multiplies by 60 before sending the transaction, so a demo facility can go
from Open to markLate-eligible, then default-eligible, in a couple of minutes
instead of days. `apps/web/scripts/smoke-vbrowser.mjs` drives this whole
lifecycle end to end (connect, originate, deposit both tranches, drawdown,
mark late, declare default, record recovery, withdraw) against a real VPS
Chrome window with an injected wallet; see its header for the env vars
(`SMOKE_CHAIN`, `SMOKE_UNIT`, `SMOKE_TENOR_MIN`, `SMOKE_GRACE_MIN`,
`SMOKE_RESUME`, `SMOKE_SHOTS`).


## Contract quality

- OpenZeppelin 5.7: `Clones` for facilities, `SafeERC20`, `ReentrancyGuard`, `Initializable`, `Ownable2Step`, `Pausable`.
- 26 Foundry tests including a fuzz test that checks the waterfall never creates or loses capital (`testFuzz_waterfallConservesCapital`).
- Slither (`uvx --from slither-analyzer slither . --filter-paths "lib/|test/|script/"`) reports no high or medium findings. Remaining informational items are intentional: late fees accrue per whole day (`divide-before-multiply`), and due dates, grace periods and late fees are timestamp based by design (`timestamp`).

## apps/keeper

Permissionless watcher. It subscribes to `Drawn` events over Alchemy websockets on Robinhood Chain and Arbitrum Sepolia and schedules a `markLate()` call for the exact due timestamp; a one-minute poll over every facility in `contracts/deployments.json` is the fallback. Late status itself is derived onchain from timestamps; the keeper only makes sure somebody calls the permissionless function. Anyone can call `markLate`, so the keeper holds no privilege; it only makes sure nobody has to. Runs on the VPS as the `anora-keeper` systemd user unit; `bun run test:keeper` covers the selection rule.

```
KEEPER_PRIVATE_KEY=0x... bun run keeper
```
