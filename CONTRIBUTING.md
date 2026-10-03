# Contributing

## Layout

- `contracts/` Foundry. `AnoraPool.sol` is the whole protocol; tests in `test/`, deploy in `script/`.
- `apps/web/` Vite + React + wagmi. ABIs are generated: run `bun scripts/export-abi.ts` after `forge build`.
- `contracts/deployments.json` is the source of truth for addresses; `apps/web/src/config/contracts.ts` must match it.

## Workflow

```
bun install
bun run test:contracts
bun run test:web
bun run dev:web
```

- Branch from `main`, open a PR. CI runs forge tests, web tests and the web build.
- Tests first when there is logic to test. No explanatory comments; make the names carry it.
- Commits: short, English, conventional style (`feat(web): ...`, `fix: ...`, `chore: ...`). One cluster per commit.
- Contract changes need a redeploy: `forge script script/Deploy.s.sol --rpc-url $ARBITRUM_SEPOLIA_RPC --private-key $DEPLOYER_PRIVATE_KEY --broadcast`, then update `deployments.json`, `contracts.ts`, README, and re-export ABIs.
- Web deploy to https://anora.finance is done from the VPS with `bin/deploy-web.sh` (ask Dimas).

## Verifying on Robinhood Chain Blockscout

`forge verify-contract --verifier blockscout` is blocked by Cloudflare from the VPS. Use the browser-backed script instead (needs the VPS Chrome, run from `apps/web` so `viem` resolves):

```
cd apps/web && node ../../scripts/verify-blockscout.mjs <address> src/AnoraPool.sol:AnoraPool
```

It generates the standard JSON input with forge, posts it to Blockscout's `/api/v2/.../verification/via/standard-input` from inside the browser session, and polls until `is_verified`. Constructor args are auto-detected. Sourcify still works headless: `forge verify-contract --verifier sourcify --chain-id 4663 ...`.
