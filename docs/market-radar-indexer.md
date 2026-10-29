# Market Radar — incremental indexer & signed snapshots (issue #95)

Why: a full 24h `eth_getLogs` scan of the Uniswap v4 PoolManager is not guaranteed to finish inside the
60 s Vercel function (provider block-range/result caps, rate limits, block rate). The API therefore has two sources:

| `MARKET_RADAR_SOURCE` | Behaviour |
|---|---|
| unset / `live` | On-demand scan (adaptive, parallel, classified errors). Fails closed with `RADAR_ONCHAIN_SCAN_INCOMPLETE` + reason. |
| `snapshot` | Reads the Ed25519-signed snapshot built by the Railway indexer. No RPC scan in Vercel. |

Public output is still gated by `MARKET_RADAR_ONCHAIN_ENABLED=true`. Production stays off until the
Chainlink display-rights review and the per-network measurement are done.

## Indexer (Railway worker)
`lib/market-radar-indexer.js` reads only new confirmed blocks per run, stores per-pool aggregates in ~5-minute
block segments on the persistent volume, trims to 24h, and **publishes only when segments are contiguous and the
first segment starts ≥ 24h before the confirmed head**. Otherwise status is `catching_up`/`bootstrapping` and nothing is published.
Confirmations: Arc 2, Ethereum 12, Robinhood 40 blocks behind the tip.

Worker env (Railway): `ARC_RADAR_INDEXER_ENABLED=true`, `ARC_RADAR_INTERVAL_MS` (default 300000),
RPC URLs (`ARC_RPC_URL`, `ETH_RPC_URL`, `ROBINHOOD_RPC_URL`), existing `ARC_HOLDER_SIGNING_KEY`, `ARC_HOLDER_PUBLISHED_DIR`, `ARC_HOLDER_QUEUE_TOKEN`.
Routes: `GET /radar/snapshot/<network>` (signed envelope), `GET /radar/status` and `POST /radar/refresh/<network>` (Bearer).

## API (Vercel)
`MARKET_RADAR_SOURCE=snapshot`, `ARC_RADAR_PUBLISHED_URL` (or existing `ARC_HOLDER_PUBLISHED_URL`), `ARC_HOLDER_PUBLIC_KEY`,
optional `ARC_RADAR_MAX_AGE_SEC` (default 1200). Fail-closed codes: `RADAR_SNAPSHOT_UNVERIFIED` (no key / bad or missing signature),
`_CHAIN_MISMATCH`, `_STALE`, `_WINDOW_SHORT`, `_INVALID`, `_MISSING`, `_FETCH_FAILED`, `_NOT_CONFIGURED`.

## Diagnostics (non-production only)
Outside `VERCEL_ENV=production`, 503 bodies carry `diagnostics` (phase, window, block rate, scan counters: calls, retries,
splits, learned block cap, failure classes, elapsed) and one `[radar]` log line is written. `?diagnose=1` adds it to 200s.
RPC URLs/keys are redacted. Live probe: `node scripts/probe-market-radar-onchain.cjs arc ethereum robinhood`.

## Not measured here
The build sandbox has no outbound RPC access, so per-network live timings/token counts must come from a Preview
deployment or the probe script on a connected machine.

---

# Update (issue #96)

## Pool-key coverage (why Arc returned 200 with 0 tokens)
Uniswap v4 swaps only carry the pool id. `PositionManager.poolKeys` knows only pools registered through the PositionManager, so
pools initialised directly on the PoolManager (launch platforms, custom routers) stayed unresolved. Keys now come from, in order:
1. **Registry** (indexer): every `Initialize` event of the PoolManager, scanned newest-first + forward each run, persisted in `keys-<network>.json`.
2. `PositionManager.poolKeys` (bounded, top pools by swaps and by raw amount).
3. A late `Initialize` scan of the 24h window (live mode only).

Every key from any source is accepted only if `keccak256(abi.encode(poolKey)) == poolId`.
Honest scope: if keys resolve for < 85% of the window's swaps the API fails closed with `RADAR_POOL_KEY_COVERAGE_LOW`
(indexer status `registry_backfilling`, nothing published). Published bodies carry `coverage.swapsResolvedShare`, `keySources`, `scopeNote`
("Ranked from X of Y pools … Z% of swaps"). Registry start block: Ethereum 21,500,000 (before v4 launch), Arc/Robinhood 0; override with `RADAR_INIT_FROM_<NETWORK>`.

## Robinhood "301 range errors in ~600 calls"
Rate-limit wording (`rate limit exceeded`, `compute units exceeded`) matched the old range regex and triggered range halving down to single blocks.
Classification now checks strong range patterns first, then rate limits. Queued pieces are re-cut to the learned cap, a timeout lowers the growth ceiling,
and a live scan stops early (`window too large for a live scan at the provider block cap`, with `callsNeeded`/`etaMs`) when the learned cap makes 24h infeasible.
That is the signal to use `MARKET_RADAR_SOURCE=snapshot` for that network. The indexer persists the learned cap (`learnedCap`) and uses a 20,000-call guard.

## pons Launch Radar (fourth tab)
`GET /api/search?action=radar&chain=pons`. pons is a launch platform on Robinhood Chain (4663), **not** a fourth blockchain.
Sources (official docs, https://docs.ponsfamily.com/): factories `0xA5aA…1feB` (active, from block 8,991,118) and `0x0c37…77a4` (legacy, from 8,600,612),
`TokenLaunched` topic0 `0xdb51ea9a…235a`, pool `Swap` topic0 `0xc42079f9…ca67` (both re-derived by keccak in tests). Launch time = block timestamp of the event.
Per launch the API re-reads `factory.getLaunchedToken(token)` (exists/token/deployer/paired == WETH), `token.liquidityPool() == pool`, ERC-20 metadata, and
`graduationStatus`. Volume/price in USD are only set when all of that verifies and a fresh Chainlink ETH/USD exists; otherwise `fieldStatus` says `UNAVAILABLE`.
Volume and tx count are totals since launch (distinct transactions). Newest first, max 10. Not operated/endorsed by pons; the name is written lowercase and links to the app per their terms.
A third-party article lists a different factory/curve/v4 hook design; it is not an official source and is not used (`PONS_EXTRA_FACTORIES` can add verified factories).
Indexer: `lib/pons-launch-indexer.js` (7-day lookback, cursors for launches and swaps, publishes only when both reach the confirmed head). Snapshot kind: `pons`.

## Holder worker RPC (Phase 1)
`RPC_CALL_FAILED` means a provider answered the JSON-RPC call with an error that is not a revert, range or rate-limit error. The cause was invisible because only the last
error code survived. Failures now carry secret-free `attempts` (`provider` slot, class, HTTP status, rpc code, sanitized message), logged as `HOLDER_RPC_ATTEMPTS` and
added to the batch result as `rpcAttempts`. Chain-id checks accept any numeric encoding; differently worded `eth_call` execution failures are getter outcomes.
`GET /holder/rpc-diagnostics` (Bearer `ARC_HOLDER_QUEUE_TOKEN`) probes each provider (chainId, head, tiny getLogs, eth_call) and reports `arcRpcUrlSet`.
`ARC_RPC_URL` not being set is fine: the code falls back to `https://rpc.mainnet.arc.io` + `https://rpc.quicknode.mainnet.arc.io`.

## Safe Railway deployment and rollback plan (nothing was changed on the live service)
Before: note the current deployment id of `arcy-holder-durable`; `GET /unlocks/audit`, `GET /snapshots/<contract>.json` keep working throughout.
Persistent volume (`ARC_HOLDER_PUBLISHED_DIR`, `ARC_INDEX_CACHE_DIR`) is **only appended to**: new files live under `market-radar/` and never touch `unlock-editions/`, `pulse*/` or holder snapshots.
1. Deploy this branch to a **separate Railway service** (same Dockerfile, new volume, `ARC_RADAR_INDEXER_ENABLED=true`) OR to the existing service with `ARC_RADAR_INDEXER_ENABLED` **unset** first (the code is inert: no loop, routes only answer `/radar/*`).
2. Verify `GET /radar/status` (Bearer) and `GET /holder/rpc-diagnostics`; run `POST /radar/refresh/<network>` once per network and watch `lastRun.status` go `catching_up → … → published`.
3. Set `ARC_RADAR_INDEXER_ENABLED=true`; confirm holder batches are unaffected (`HOLDER_WORKER_BATCH`), CPU/memory stable.
4. Preview env: `MARKET_RADAR_ONCHAIN_ENABLED=true`, `MARKET_RADAR_SOURCE=snapshot`, `ARC_RADAR_PUBLISHED_URL`, `ARC_HOLDER_PUBLIC_KEY`.
Rollback: unset `ARC_RADAR_INDEXER_ENABLED` (loop stops on restart) or redeploy the recorded previous deployment id; delete only `<volume>/market-radar/` if desired. Vercel: unset `MARKET_RADAR_ONCHAIN_ENABLED` (Radar returns 503 `RADAR_NOT_ENABLED`, no RPC contact). Production remains off.

---

# Low-RPC operation (PR #94 live Preview findings, 2026-10-29)

Live Preview of `199944e`: all four Radar endpoints returned 503 — Arc (24h = 170k blocks, provider cap 10k, rate limited), Ethereum
(`RADAR_POOL_KEY_COVERAGE_LOW`, 82.2% < 85%, registry empty), Robinhood (829k blocks, repeated 429), pons (1.66M-block window, all calls 429).
Conclusion: a 24h log scan is not a synchronous-request workload on free RPCs. The fail-closed behaviour is correct and unchanged.

## What the indexer does to stay cheap
- **Shared adaptive pacer** per RPC (`ARC_RADAR_MIN_INTERVAL_MS`, default 150 ms; pons 250 ms). 429 or "rate limit" JSON-RPC errors double the interval (max 8 s) and honour `Retry-After`; healthy calls decay it. The pace is persisted (`paceMs`) so the next run starts gently.
- **2 parallel log scans** (`ARC_RADAR_CONCURRENCY`, max 4); drops to 1 after a 429. Up to 40 patient retries per range (bounded by the run budget) instead of failing the run.
- **A rate-limited primary never fans out to the fallback** (no quota burn on the free plan); `eth_getLogs` never uses the Robinhood free-plan fallback.
- **Dedicated credentials**: `RADAR_ARC_RPC_URL`, `RADAR_ETHEREUM_RPC_URL`, `RADAR_ROBINHOOD_RPC_URL` take precedence over `ARC_RPC_URL`/`ETH_RPC_URL`/`ROBINHOOD_RPC_URL`, so Radar never competes with the Holder worker's quota. Set them to a separate key.
- **Incremental**: after bootstrap each run reads only the blocks since the last run (a few calls); the learned block cap is persisted.
- API 503s for scan/coverage/snapshot failures are edge-cached for 30 s so page loads (4 readiness probes) cannot hammer the RPC.

## Bootstrap (one time, on the Railway worker, never in Vercel)
Rough one-time cost at observed caps: Arc ≈ 17 swap calls + registry; Ethereum ≈ 7,200-block window + Initialize backfill from block 21.5M (≈ a few hundred calls); Robinhood ≈ 830k blocks / ≤2,000-block chunks ≈ 420 calls; pons 7-day lookback (~5.8M blocks) ≈ a few thousand calls, then incremental.
```
node scripts/radar-warm.cjs ethereum     # registry backfill newest-first; publishes when ≥85% of swaps resolve
node scripts/radar-warm.cjs arc
node scripts/radar-warm.cjs robinhood
node scripts/radar-warm.cjs pons
```
Each round is bounded (90 s), resumable and prints sanitized progress (`blocksBehind`, `registry.remainingBlocks`, pace). Ethereum's share rises as the registry reaches older pools; until then the API stays 503 `RADAR_SNAPSHOT_MISSING` (no ranking is guessed).

## Proofs inside a signed snapshot
`snapshot.integrity`: confirmed head hash and block, contiguous segment range, registry progress (`low/high/keys/complete`), RPC chain id, source contract, confirmations, public-key fingerprint, RPC calls of the run;
`coverage`: `swapsResolvedShare`, `keySources`, `scopeNote`; `window`: actual seconds. The API verifies signature, chain, freshness (≤ `ARC_RADAR_MAX_AGE_SEC`, default 1200), window ≥ 24h and row validity before serving.

## Holder protection
The loop starts only when `ARC_RADAR_INDEXER_ENABLED=true`; everything is additive (`/radar/*` routes, files under `market-radar/`). Use separate Radar RPC keys, keep the interval ≥ 5 min, and deploy dormant first (see rollback plan above). `GET /holder/rpc-diagnostics` may be run after the dormant deploy.
