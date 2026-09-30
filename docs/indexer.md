# Indexer

`apps/indexer` reads the factory and facility events of every enabled network in the manifest, stores them in SQLite, and serves them over a read-only HTTP API. The web app uses it for history when a network in `manifest.json` has `indexerApi`; without that field it falls back to Blockscout.

## Run

```bash
cd apps/indexer
bun test
bun run src/index.ts
```

On the VPS it runs as the user unit `anora-indexer` (`~/.config/systemd/user/anora-indexer.service`), bound to `127.0.0.1:8105` and published by Caddy at `https://anora-api.dimsky.xyz`. Restart it after every factory deployment or manifest change, because it reads the manifest once at start:

```bash
systemctl --user restart anora-indexer
```

| Variable | Default | Meaning |
|---|---|---|
| `INDEXER_MANIFEST` | `apps/web/public/manifest.json` | networks, factories, `deploymentBlock`, `confirmations` |
| `INDEXER_DB` | `~/.local/share/anora-indexer/index.db` | SQLite file |
| `INDEXER_PORT` | `8105` | listen port, always on 127.0.0.1 |
| `INDEXER_INTERVAL_MS` | `5000` | pause between sync rounds |
| `INDEXER_MAX_LAG` | `400` | blocks behind the head before data routes answer `INDEXER_BEHIND` |
| `INDEXER_CHUNK` | `2000` | blocks per `getLogs` request; halves on failure, minimum 10 |
| `INDEXER_REORG_WINDOW` | `128` | recent blocks whose hashes are re-checked each round |
| `INDEXER_ORIGINS` | `https://openhouse.anora.finance` | extra allowed CORS origins, comma separated; `http://127.0.0.1:*` and `http://localhost:*` are always allowed |

## Sync

Each round reads the head, re-checks the stored block hashes inside the reorg window, and backfills from the cursor (or `deploymentBlock`) in chunks. A block whose hash changed is deleted together with everything after it and indexed again. Events are upserted by `chainId:txHash:logIndex`, so a rerun never duplicates. A facility created inside a chunk is queried for the same range in a second call. The cursor moves only after a chunk is stored.

## API

All routes are `GET`, values that can exceed 2^53 are decimal strings, addresses are lower case.

| Route | Returns |
|---|---|
| `/v1/health` | per chain: `indexedBlock`, `chainBlock`, `lag`, `state` (`ok`, `behind`, `rpc_unavailable`) |
| `/v1/facilities?chainId=` | derived facilities |
| `/v1/facilities/{chainId}/{address}` | one derived facility |
| `/v1/accounts/{address}/positions?chainId=` | deposits, withdrawals, shares, status per facility |
| `/v1/activity?chainId=&account=&facility=&cursor=&limit=` | canonical events, newest first, `limit` up to 500, `nextCursor` is opaque |

An event carries `schemaVersion`, `id`, `chainId`, `blockNumber`, `blockHash`, `txHash`, `logIndex`, `confirmations`, `final`, `facility`, `event`, `actor`, `data`, `observedAt`.

Facility status is derived from events: `FUNDING`, `FUNDED`, `ACTIVE` (with `pastDue` while the keeper has not marked it), `LATE`, `DEFAULTED`, `RECOVERED` (default with no outstanding loss), `REPAID`. A position is `HELD`, `CLAIMABLE` (shares left and the facility is `REPAID` or `RECOVERED`), or `SETTLED` (no shares left). Claimability is inferred from events, not read from the contract.

## Errors

The body is `{ "error": { "code", "message" } }`.

| Code | Status | When |
|---|---|---|
| `INVALID_REQUEST` | 400 | missing `chainId`, bad address, bad cursor |
| `UNSUPPORTED_CHAIN` | 404 | chain not in the manifest |
| `FACILITY_NOT_FOUND` | 404 | no `FacilityCreated` for that address |
| `INDEXER_BEHIND` | 503 | lag above `INDEXER_MAX_LAG`; adds `indexedBlock` and `chainBlock` |
| `RPC_UNAVAILABLE` | 503 | the head was never read |

The web app shows these as a banner and never substitutes other data. When the indexer cannot be reached at all the banner reads "Could not reach the indexer".

## Reset

```bash
systemctl --user stop anora-indexer
rm ~/.local/share/anora-indexer/index.db*
systemctl --user start anora-indexer
```

It rebuilds from `deploymentBlock` in under a minute on both chains.
