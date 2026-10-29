# Market Radar V2 — external-API-only

Four sections: **Arc (5042)**, **Ethereum (1)**, **Robinhood Chain (4663)** and **Pons Launch** (recent Pons launches on Robinhood Chain; not a fourth chain).

**Not built, by design:** no persistent indexer, no blockchain node/pool, no historical scan, no database, no `eth_getLogs`. Everything is a bounded, cached read from public APIs plus a few point `eth_call`s.

## Sources and verified limits
| Source | Used for | Limits (from provider docs) | Access |
|---|---|---|---|
| GeckoTerminal public API | ranking (top pools by 24h volume; new pools for Pons) | keyless ≈ 5 calls/min | keyless only outside Vercel |
| CoinGecko Onchain API (Demo) | same data, key-authenticated | 10,000 credits/month, ~30 calls/min | `COINGECKO_DEMO_API_KEY` |
| CoinGecko Onchain API (Pro) | same | paid tier | `COINGECKO_PRO_API_KEY` (not opened; paid) |
| DEX Screener API | independent cross-check per token (`/tokens/v1/{chain}/{a,b,…≤30}`) | 300 req/min | free; on Vercel only with `DEXSCREENER_PUBLIC_DISPLAY_APPROVED=true` |
| Pons factory contracts (Robinhood RPC) | onchain launch + graduation proof | ≤2 batched JSON-RPC requests per refresh | existing `ROBINHOOD_RPC_URL` |

Budget (Demo): 5 calls per refresh cycle × 48 cycles/day (30 min TTL) = 7,200 calls/month < 10,000. TTL cannot be configured below 20 min. Coalesced in-flight requests, edge cache, 429 cooldown (Retry-After honoured), stale-if-error ≤ 3 h labelled `STALE`.

## Publication gates (fail closed)
Responses are served only when **both** `MARKET_RADAR_PUBLIC_DISPLAY_APPROVED=true` and `MARKET_RADAR_JSON_DELIVERY_APPROVED=true`, in every environment including Preview. Without them: `503 RADAR_NOT_CONFIGURED`. On Vercel without a CoinGecko key: `503 RADAR_SOURCE_KEY_REQUIRED`. These approvals are licence decisions for the operator; this PR does not set them.

## Field statuses
- `CROSS_VERIFIED` — two indexers agree on the **same pool** within tolerance (price 3 %, volume/liquidity 25 %, FDV/mcap 10 %, 24h change ±3 pp, pool creation ±10 min). Agreement between indexers is not an onchain proof.
- `SOURCE_REPORTED` — only one provider supplied the value.
- `NOT_VERIFIED` — missing or providers disagree. Value is `null` and the UI shows **N/A · NOT VERIFIED**. Nothing is estimated or averaged.
- `ONCHAIN_VERIFIED` — Pons `getLaunchedToken` / `graduationStatus` read from an official factory.

## Pons Launch
Candidates = newest pools on Robinhood from GeckoTerminal (≤ 20); each is listed **only if** an official Pons factory confirms it onchain. Zero confirmed launches is shown honestly as empty. RPC failure or wrong chain id is an error, never unverified tokens.

## Still unverified (needs CI probe / operator)
DEX Screener slugs `arc` and `robinhood`; CoinGecko Demo onchain coverage of Arc/Robinhood; the licence approvals above. Run `scripts/probe-radar-v2.cjs` via the "Market Radar source compatibility probe" workflow.
