# Market Radar provider audit — issue #89 (29 Oct 2026)

Facts below come from pages read on 29 Oct 2026. Where a page could not be read, it is marked **unverified**. This is a technical review, not legal advice.

## Context that matters
ARCY SEARCH is a free public research interface associated with a community token. Not selling data does not by itself make use "non-commercial", and a source credit does not create a licence.

## Comparison

| Option | Cost | Display rights | Machine-readable JSON delivery | Chain coverage seen | Decision |
|---|---|---|---|---|---|
| **CoinGecko API (Pro/commercial)** | Basic $35, Analyst $129, Lite $499, Pro $999 /month (pricing page); Enterprise on request | Standard commercial: public display with credit. Terms §4.3: "Powered by CoinGecko" ≥10 px; attribution guide has text + link for GeckoTerminal onchain data | Terms §4.1.6: no re-distribute / syndicate unless an Executed Agreement. Support article: cached, selected-field or reformatted responses are *not* exempt; redistribution needs a custom licence. Pricing page lists "Commercial redistribution licence" under Enterprise | Robinhood onchain live since 1 Jul 2026 (changelog). `arc` network id **not found** in changelog | Not enabled. Needs written confirmation that ARCY's frontend **and** its `/api/search?action=radar` JSON are covered |
| **CoinGecko Demo (free)** | $0, 10k credits, 100/min | Support article: Demo has **no commercial rights**; attribution does not change that | — | — | Rejected |
| **GeckoTerminal public API** | Free, beta, 30 calls/min | **Could not locate API terms**; fetched help page states nothing on commercial use | Unverified | arc/eth/robinhood ids used by existing internal probe | Not used for a public ranking until terms are shown in writing |
| **DEX Screener API** | Free/paid tiers per terms | API terms (v. 18 Aug 2023): commercial use allowed; **no product whose primary purpose is to compete directly with DEX Screener**; §2 no making the API "or any portion thereof" available to third parties; no attribution clause | A public top-volume leaderboard JSON is both close to DEX Screener's own trending/top lists and a form of third-party availability | Arc / Robinhood chain ids **not confirmed** | Not used for the Radar (existing per-token adapter keeps its own gate) |
| **Direct onchain (chosen)** | RPC calls only | Public blockchain data read by ARCY; no provider licence | ARCY serves its own computed facts, with scope and caveats | Arc, Ethereum, Robinhood all have an official Uniswap v4 PoolManager | **Selected** |

## Residual items (honest list)
- **Chainlink reference prices** are read from public onchain contracts only for USDC/ETH→USD conversion. Terms for *off-chain display* of feed values were not reviewed; the values are shown only as USD volume/price, not as a Chainlink feed. Confirm if desired.
- **Coverage is Uniswap v4 only.** Ethereum v4 volume is a small part of Ethereum DEX activity; other venues on all three chains are not counted. This is stated in the UI.
- **Public RPC limits** (`eth_getLogs` caps, rate limits) can make a scan incomplete; the endpoint then returns 503 and shows no ranking. A dedicated RPC for Ethereum is recommended.
- **Logos:** only exact-contract artwork already in ARCY's CC0 registry is shown; every other token gets a text badge. No logo is fetched from a third-party CDN.
- **Liquidity** is N/A everywhere (not computed for v4).
- Live Arc/Ethereum/Robinhood counts were **not measurable from the build sandbox** (RPC hosts blocked); use `scripts/probe-market-radar-onchain.cjs`.

## Draft permission request (only if a hosted provider is wanted later)
> Subject: Written confirmation of display and JSON-delivery rights — ARCY SEARCH Market Radar
>
> ARCY SEARCH (www.arcyusdc.xyz) is a free public web research tool. We would like to show, for Arc, Ethereum and Robinhood Chain, up to 10 tokens per network ranked by 24h pool volume, with price, liquidity, 24h change, contract, DEX and pool link, refreshed at most every 10 minutes. Our browser calls our own endpoint `/api/search?action=radar&chain=…`, which returns a bounded JSON response (≤10 rows, selected fields) cached for 600 s; your API key never reaches the browser. Please confirm in writing (1) whether this public display and (2) this JSON delivery model are permitted under our current plan, (3) the exact attribution wording/placement, and (4) whether the `arc` network is supported. If not, please state which licence would permit it.
