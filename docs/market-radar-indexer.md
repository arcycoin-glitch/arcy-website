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
