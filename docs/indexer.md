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

## Metadata, underwriting, and documents

The same process serves a metadata service. It keeps its own SQLite file (`metadata.db`), uploaded files under `documents/`, and a random signing secret in `meta.secret` (mode 600), all next to the index in `~/.local/share/anora-indexer/`. Set `META_DOMAIN`, `META_MAX_FILE_BYTES` (default 5 MiB), `META_DB`, `META_DOCUMENTS`, and `META_SECRET_FILE` to override.

Roles come from the chain, not from the service: the originator is `facility.originator()` and the reviewer is `facility.riskAgent()` (the factory's risk agent). Revoking an originator at the factory does not stop them managing metadata for facilities they already opened.

### Sign in

| Route | Purpose |
|---|---|
| `POST /v1/auth/nonce` `{address, chainId}` | returns a single-use nonce (5 minutes) and the EIP-4361 message to sign, bound to `META_DOMAIN` |
| `POST /v1/auth/verify` `{message, signature}` | checks the signature, consumes the nonce, returns a random bearer `token` valid for 1 hour |

Send the token as `Authorization: Bearer <token>`. The service sets no cookies.

### Records

| Route | Who | Effect |
|---|---|---|
| `POST /v1/facilities/{chainId}/{address}/metadata/versions` | originator | adds an immutable draft version: `company`, `route`, `financingType` and optional `operatingHistoryYears`, `verifiedAssets`, `buyerConcentrationPct`, `documentCoverage` |
| `POST .../underwriting/approve` `{version, grade, note}` | reviewer | adds an immutable approval for a draft. The canonical JSON (sorted keys, no whitespace) is stored with `digest = keccak256(canonical JSON)` |
| `GET .../metadata` | anyone | latest approval, its digest, and `anchored` |

`anchored` is true only when the facility's onchain `evidenceHash` equals the latest approval's digest. To anchor, the originator calls `attachEvidence(digest)` on the facility. A newer approval has a new digest, so it reads `anchored: false` until it is anchored again. Older drafts and approvals are never edited or deleted.

### Documents

| Route | Who | Effect |
|---|---|---|
| `POST .../documents/upload-url` `{name, mime, size, visibility}` | originator | reserves a slot and returns a 5 minute signed `uploadUrl`. Types: `application/pdf`, `image/png`, `image/jpeg`. `visibility` is `public` or `restricted` |
| `PUT /v1/uploads/{id}?exp=&sig=` (body: the file) | link holder | stores the file once; size and magic bytes must match; records `sha256` and the next manifest version |
| `GET .../documents` | anyone | the versioned manifest. `url` is a 5 minute signed link, or `null` for a restricted document the reader may not open |
| `GET /v1/downloads/{id}?exp=&sig=` | link holder | the file |

Restricted documents open for the originator, the reviewer, and any signed-in wallet with a `Deposited` event on that facility.

### Metadata errors

| Code | Status | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | missing, unknown, or expired session |
| `INVALID_NONCE`, `INVALID_DOMAIN`, `INVALID_SIGNATURE` | 401 | sign-in checks failed |
| `FORBIDDEN` | 403 | wrong role for the facility |
| `INVALID_SIGNATURE` | 403 | upload or download link tampered with or expired |
| `METADATA_NOT_FOUND` | 404 | no approved record yet |
| `VERSION_NOT_FOUND` | 404 | approving a draft that does not exist |
| `UNSUPPORTED_TYPE`, `SIZE_MISMATCH`, `TYPE_MISMATCH` | 400 | file rejected |
| `PAYLOAD_TOO_LARGE` | 413 | file or body over the limit |
| `ALREADY_STORED` | 409 | the upload slot was already used |
| `METADATA_UNAVAILABLE` | 503 | the facility could not be read from the chain |

The web app shows `METADATA_UNAVAILABLE` in the modal and does not fall back to sample figures. Sample figures appear only when there is no approved record, and are labelled as such.

### Seeding sample records

```bash
secret with anora-openhouse -- bun run apps/indexer/scripts/seed-metadata.ts
```

Signs in as the demo originator and the risk agent, adds a draft, approves it, anchors the digest with `attachEvidence` on Arbitrum Sepolia, and uploads one public and one restricted sample document to the first facility. `SEED_FACILITIES` (comma separated) picks facilities, `SEED_SKIP_ANCHOR` leaves some unanchored, `SEED_API` points at another server.

## Reset

```bash
systemctl --user stop anora-indexer
rm ~/.local/share/anora-indexer/index.db*
systemctl --user start anora-indexer
```

It rebuilds from `deploymentBlock` in under a minute on both chains.

## Rate limits

The API limits each client with a token bucket per class of request. A client is identified by its connection address. Behind Caddy the first `X-Forwarded-For` entry is used, and only when the connection comes from the local proxy.

| Class | Requests | Budget per minute |
|---|---|---|
| Sign in (`POST /v1/auth/*`) | nonce, verify | 10 |
| Writes (other `POST`, `PUT /v1/uploads/*`) | metadata, approval, upload URLs, uploads | 20 |
| Reads (`GET`) | everything except health | 240 |
| JSON-RPC proxy (`/rpc/{chainId}`) | every proxied call | 600 |

`GET /v1/health` and preflight requests are not limited. A request over budget gets HTTP 429 with the code `RATE_LIMITED`, a `Retry-After` header in seconds, and the usual CORS headers. A `POST` body over 64 KiB gets HTTP 413 with `PAYLOAD_TOO_LARGE`; file uploads are capped by the upload size limit instead. Buckets idle for ten minutes are dropped.

## JSON-RPC proxy

`POST /rpc/{chainId}` (421614 and 4663) forwards JSON-RPC from the browser to a node, so the site carries no provider key. The manifest points every network's `rpcUrl` at this endpoint and keeps the public node in `publicRpcUrl`. The indexer reads the manifest, keeps the provider host in `alchemyHost`, and takes the key from `ALCHEMY_API_KEY` in its environment (the unit starts through `secret with anora-openhouse --`). Upstreams per chain, in order: the keyed provider, then the public node. A 429, a 5xx, a timeout, a network error, or an answer that is not a matching batch moves on to the next upstream. When none answers, the reply is HTTP 503 and each call carries the error `RPC_UNAVAILABLE`.

Both single calls and batches (up to 100 calls) are accepted. A batch reaches the upstream as one batch of the calls that are not already cached.

Allowed methods: `eth_chainId`, `eth_blockNumber`, `eth_call`, `eth_getBalance`, `eth_getCode`, `eth_getLogs`, `eth_estimateGas`, `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_getBlockByNumber`, `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getTransactionCount`, `eth_sendRawTransaction`, `net_version`. Anything else gets the error `-32601`. `eth_getLogs` must name a block hash, or a numeric range of at most 10,000 blocks, or `latest` on both ends; anything else gets `-32602`.

Caching and deduplication, per chain and per call with identical parameters:

| Calls | Kept for |
|---|---|
| `eth_chainId`, `net_version`, `eth_getCode` | one hour |
| `eth_call`, `eth_getBalance`, `eth_blockNumber`, gas and fee reads, `eth_estimateGas` | three seconds |
| `eth_getLogs` | five seconds (one minute with a block hash) |
| `eth_getBlockByNumber` | one minute for a numeric block, three seconds otherwise |
| `eth_getTransactionByHash`, `eth_getTransactionReceipt` | one minute, only once the answer is not null |
| `eth_sendRawTransaction`, `eth_getTransactionCount` | never cached and never shared |

Identical calls that are in flight at the same time share one upstream request. Errors are never cached. A request body is limited to 256 KiB, and the proxy uses its own rate limit class (600 per minute per client). CORS is the same as for the rest of the API.

The web app reads through this endpoint with JSON-RPC batching and one large multicall per read, and polls the chain and the indexer every fifteen seconds. Measured from one open Markets tab with seven facilities: about 20 requests per minute to the proxy and none to the provider, against roughly 2,300 requests per minute straight to the provider before.
