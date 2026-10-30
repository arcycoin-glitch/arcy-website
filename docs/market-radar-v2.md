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

## Radar V3 — discovery engine (ARCY Discovery Score)

**Why:** V2 took the base tokens of the 20 highest-volume pools. That produces a list of the biggest liquidity pools (WETH, wrapped BTC, stablecoins), not a discovery list. V3 keeps the same sources, quota discipline and UI contract and replaces *selection and ranking*.

**Candidates (per chain, GeckoTerminal / CoinGecko Onchain):** top pools by 24h volume, trending pools (24h), newest pools. Merged per base-token contract; each row remembers which views surfaced it. Pons Launch reuses the three Robinhood pages (no extra provider call). Still not a census of the chain.

**Identity exclusion (discovery list only — search, contract review and every other feature are unaffected):**

| Reason | Evidence used (never ticker alone) |
|---|---|
| `WRAPPED_BASE_ASSET` | canonical contract (registry), CoinGecko coin id of a base asset, or a base-asset ticker whose price is consistent with the chain's ETH/BTC reference |
| `STABLECOIN` | canonical contract, CoinGecko stable coin id, or stable-asset name holding a currency peg |
| `IMPERSONATION_SUSPECT` | uses a base-asset/major-stable ticker without identity proof and without the matching price |
| `UNVERIFIED_LOOKALIKE` | Robinhood: same ticker as an official pons launch, contract not confirmed by a pons factory |
| `DUPLICATE_SYMBOL_UNVERIFIED` | same ticker on one chain: the contract with stronger evidence (factory, coin id, score) stays |
| `NATIVE_PLACEHOLDER` | zero address |
| `NOT_FACTORY_LAUNCH` | Pons section only |

**Eligibility gates (hard):** verified price; verified 24h volume and liquidity above the *network* floor; volume/liquidity ratio ≤ 1000; ≥ 5 trades when counts are known. Floors differ per network (`discovery.PROFILES`).

**ARCY Discovery Score (0–100)** — weights 20 volume · 15 liquidity · 20 pool freshness · 15 trading activity · 10 momentum · 10 cross-source agreement · 5 buy/sell balance · 5 pool breadth (Pons: volume 20, liquidity 10, freshness 25, activity 20, momentum 5, agreement 10, balance 5, breadth 5). Each component is scaled on a per-network log scale between its floor and reference. A component whose input is missing is *removed* and the remaining weights re-normalised; `discovery.missing` and `weightCoverage` say so. Penalties (evidence, not accusation): `HIGH_TURNOVER` (volume > 100× liquidity, −15), `LARGE_TRADES_FEW_TXNS` (−10), `ONE_SIDED_FLOW` (−5). Volume *growth* is not used: no verified historical volume is stored (`volumeGrowth: NOT_AVAILABLE`). Pool age is the age of the token's highest-volume pool, not the token's first appearance.

**Diversity:** at most 4 tokens whose top pool is older than 180 days and at most 2 tokenized equities per list. Lists are never padded to 10.

**Response additions (UI contract `version: 2` unchanged):** `engine`, `discovery` (weights, profile, channel counts/status, exclusion counts), `excluded[]` (≤ 40, with reason and evidence), per-token `discovery` (score, reason, components, flags, channels, scopes).

**Quota (Demo plan):** per refresh cycle 3 chains × (top + trending + new) = 9 pool pages + 4 `tokens/multi` = **13 credits**; TTL fixed ≥ 60 min → 720 cycles × 13 = 9,360 credits/month (limit 10,000). Pons membership uses public-RPC point reads only: ≤ 40 candidates per refresh in batches of 10 (a public RPC rejected an 80-call batch), cached per address for the TTL and shared by Robinhood and Pons.


## Pons V2 (bonding curve -> Uniswap v4) support
- Factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` (docs.ponsfamily.com/docs/v2) is registered next to the V1 factories with its own decoder (15-word `getLaunchedToken`: exists = word 14, phase = word 10) and its own `TokenLaunched(address,address,address,address,uint256,uint256)` topic0 (computed locally).
- Discovery: bounded, newest-first `eth_getLogs` windows (<=3 x 8M blocks, RPC cap 10M) over all factories; provider windows are still used. Membership proof is always `getLaunchedToken` on an official factory.
- Phase 2 (GRADUATED_POOL) tokens are ranked like any other token from verified provider data. Phase 0 (BONDING_CURVE) tokens found only by event have no pool, so no verified USD price/volume/liquidity exists: they are listed in `coverage.bondingCurve` (progress from `realQuoteReserve / graduationThreshold`, USD `NOT_VERIFIED`) and never ranked or padded in.
- No extra provider credits: the added work is RPC-only.
