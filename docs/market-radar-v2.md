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
Candidates = base tokens of the newest and the highest-volume Robinhood pools from GeckoTerminal (1 page each, ≤ 20 unique tokens: 10 newest + highest-volume; a public-RPC batch of 80 eth_calls was rate-limited in CI, 40 was not). Live probe: the newest 40 pools held no Pons launches, so the top-volume window is added; tokens still on the bonding curve have no DEX pool and are not covered; each is listed **only if** an official Pons factory confirms it onchain. Zero confirmed launches is shown honestly as empty. RPC failure or wrong chain id is an error, never unverified tokens.

## Live verification (GitHub Actions run, commit 1102c3d, keyless, CI only)
- GeckoTerminal `arc`, `eth`, `robinhood`: HTTP 200, 20 pools each, 20/20 contract-matched rows. Network ids confirmed.
- DEX Screener slugs `arc`, `robinhood`, `ethereum` confirmed with live pairs (POLL on Arc, PONS on Robinhood, UNI on Ethereum). ARCY returned 0 pairs on DEX Screener (not indexed there); this is reported as such, not worked around.
- Pons factories match the integrator documentation (Mobula: active `0xa5aab3f0…1feb`, legacy `0x0c37a24f…77a4`; both used). Real launch read: PONS token is a member via the legacy factory, `graduationStatus` graduated=true; WETH negative control is not a member.
- End-to-end library run (keyless): arc 10 tokens, ethereum 9 (only 9 distinct base tokens in the top-20 pools), robinhood 10; one GeckoTerminal + one DEX Screener call per section.
- Final Pons run (33d8227): 20 candidates checked, 1 launch confirmed onchain (PONS); its fields are SOURCE_REPORTED because DEX Screener did not return the same pool address as GeckoTerminal (no forced agreement). Public RPC rate-limited an 80-call batch, hence the 20-token cap.
- The first Pons run found 0 launches among the newest 20 pools; Pons candidates now also include the top-volume window (same call budget).

## Licence review (free, non-commercial public site; ARCY sells no data and offers no API product)
Read from the official pages on 2026-10-30:
- **CoinGecko API Terms** (coingecko.com/en/api_terms): the licence is for integrating the API into websites and apps; attribution "Powered by CoinGecko" must be prominent, not smaller than size 10 (4.3); "re-distribute or syndicate access to the CoinGecko API" is prohibited (4.1.6); copying/deriving Data beyond what is permitted is restricted (6.2); caching is discouraged and must refresh at least every 24 h (6.1); limits per plan (4.2). The terms do not mention GeckoTerminal/onchain data and say nothing explicit about re-serving data as JSON. **Attribution guide** (brand.coingecko.com): key-authenticated data → "Powered by CoinGecko API" linking coingecko.com/en/api; GeckoTerminal public API → "On-chain data provided by GeckoTerminal" linking geckoterminal.com; place it next to the data; do not imply partnership.
- **DEX Screener API Terms** (docs.dexscreener.com/api/api-terms-and-conditions, updated 2023-08-18): limited, revocable licence; commercial and non-commercial use allowed; no attribution duty; forbidden to build a product whose primary purpose competes with DEX Screener, and to make the API "or any portion" available to third parties for unauthorized purposes ("unauthorized" is undefined). Nothing on caching or re-serving.

Assessment for this use model:
1. Showing the data on the free public ARCY SEARCH page with the required credit is the use both terms describe. Attribution is implemented per the guide (text, link, ≥12 px, directly under the rows), and DEX Screener is credited too although not required.
2. The JSON action is **not intended as a public feed**. Because syndicating API access is prohibited and re-serving data is not addressed, `/api/search?action=radar` answers only requests that come from the ARCY page (`Sec-Fetch-Site: same-origin` or same-host `Origin`) and returns `403 RADAR_SITE_ONLY` otherwise, with `Vary` set so the edge cache cannot hand a cached body to other callers. Headers can be forged by non-browser clients, so this documents and enforces intent; it is not a security boundary. Data is held in memory/edge cache for 10–30 min only (terms require ≤ 24 h).
3. **Residual points that are still not written down anywhere I could read:** whether CoinGecko's API terms cover the onchain endpoints used with a Demo key and the keyless GeckoTerminal API, whether browser-visible JSON (the page's own network call) counts as redistribution, and what DEX Screener means by "unauthorized". Neither provider states a permission process. If the operator wants certainty, ask CoinGecko support and DEX Screener (contact in their API terms, section 9) in writing.
4. The three approval flags are **not set by this PR or by me**. Setting `MARKET_RADAR_PUBLIC_DISPLAY_APPROVED`, `MARKET_RADAR_JSON_DELIVERY_APPROVED` and `DEXSCREENER_PUBLIC_DISPLAY_APPROVED` is an operator decision, taken on the basis of the above (residual points in 3).

## Vercel Preview end-to-end (commit 6ccac61, real providers, Chrome)
All four sections returned HTTP 200 with live data (Arc 9, Ethereum 9, Robinhood 10, Pons Launch 1 tokens). Edge cache confirmed (`x-vercel-cache: HIT`, same `asOf` on repeat calls). Desktop and a 390 px frame render without horizontal overflow. Findings fixed in 6ccac61: full-width status badge, browser machine-translation of tickers/tab names, native-ETH zero-address rows linking to a research page, no hint about clone tickers (two non-factory "PONS" clones rank 3–4 on Robinhood with ~$50M volume and are correctly absent from Pons Launch) and extreme volume/liquidity ratios.
Not verifiable from a browser: the `403 RADAR_SITE_ONLY` path (browsers cannot forge `Sec-Fetch-Site`); covered by unit tests.

## Logos and coverage update (PR #99)
Measured with real providers (GitHub Actions probe, keyless, in-process only, commit c9d4a8e); "before" = main at f799ee4 on Vercel Preview.

| | Before | After |
|---|---|---|
| Tokens shown (Arc / Ethereum / Robinhood / Pons) | 9 / 9 / 10 / 1 = 29 | 10 / 9 / 10 / 1 = 30 |
| Logo coverage | 0 % | 76.7 % (23/30) |
| Field completeness (not N/A, 7 fields) | 89.7 % | 91.4 % |
| Cross-verified fields | 41.9 % | 50.5 % |
| GeckoTerminal/CoinGecko calls per section refresh | 1 (Pons 2) | 2 (Pons 2 + RPC) |

Logos: the provider's token image for the exact chain + contract (GeckoTerminal/CoinGecko, DEX Screener fallback), https allow-listed provider CDNs only. The 7 tokens without a logo have no image at either provider: Arc WETH `0x41d5…`, cirBTC, EURC `0x834d…`, BTC `0x30ed…`; Ethereum native ETH (zero address); the two non-factory "PONS" clones on Robinhood. They get a neutral placeholder; no logo is borrowed from another chain or contract.

Remaining N/A fields and exact reasons (live run): market cap `SOURCES_DISAGREE` (providers' circulating-supply definitions differ) or not published (native/rebasing tokens; FDV is never substituted); pool creation time `SOURCES_DISAGREE` (DEX Screener's first-seen time differs by more than 10 min for some V4 pools); 24h change `SOURCES_DISAGREE` (two pools differ); Robinhood liquidity `SOURCES_DISAGREE` for 3 tokens.

Provider quirks found and handled: GeckoTerminal `tokens/multi.total_reserve_in_usd` can be impossible (4.04 for a $4.7M pool on Arc), so token totals smaller than the token's own top pool fall back to the pool figure and are labelled "(pool)"; provider names arrive HTML-escaped (decoded); zero market cap/FDV is treated as not stated; DEX Screener sees fewer pools than GeckoTerminal, so a lower DEX Screener volume/liquidity total is "partial coverage" (single-source), a higher one is a contradiction.

Budget (Demo): 8 calls per cycle (3 top-pool pages + Pons new-pools page + 4 `tokens/multi`; Pons reuses the cached Robinhood top-volume page), TTL 45 min (floor 40) = 7,680 calls/month < 10,000.

Not covered: whole-chain coverage (candidates are the base tokens of the provider's 20 highest-volume pools; ranking by provider-stated 24h token volume over all its pools). A second page would lift Ethereum from 9 to 10 tokens but needs a 60 min TTL on the free plan.

## Still unverified (needs CI probe / operator)
CoinGecko Demo-key onchain coverage of Arc/Robinhood (keyless works; a Demo key was not available); the licence approvals above. Run `scripts/probe-radar-v2.cjs` via the "Market Radar source compatibility probe" workflow.
