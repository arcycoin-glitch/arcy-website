# ARCY MARKET RADAR — Top 10 by observed pool volume (preview)

## Scope
Add a second-page **Token Research | Market Radar** switcher. Existing five cards, 20 metrics, price chart, search, mobile behavior, Pulse, Token Unlocks, and home page remain intact. Radar shows up to ten tokens *per network* and pages five rows at a time. Each entry links to /search/token/{network}/{exactContract}. Network tabs: Arc 5042, Ethereum 1, Robinhood Chain 4663.

## Data scope (do not overclaim)
CoinGecko Onchain's **top pools by 24-hour USD volume**, sorted h24_volume_usd_desc; poll pages 1–2 (up to 40 pools). Retain **base-token** only, require exact network-contract joins, de-duplicate by address. Ranking uses each token's **single highest-volume observed pool**; neither token aggregate 24-hour DEX volume nor complete all-chain Top 10. Other pools (outside sampled pages, where token appears as quote) can be missed. Therefore label as Top 10 observed base tokens by their largest tracked pool and provide evidence scope + provider attribution. No synthetic numbers. Incomplete response is a source error, not empty zeroes.

## Public licensing gate — intentionally OFF
Public source rendering and client JSON endpoint are locked unless ALL three environment variables are set by an authorized operator:
- COINGECKO_PRO_API_KEY (server-only, never embedded in the client)
- MARKET_RADAR_PUBLIC_DISPLAY_APPROVED=true (active paid CoinGecko commercial license with attribution)
- MARKET_RADAR_JSON_DELIVERY_APPROVED=true (appropriate permission/contractual confirmation for delivery of the bounded JSON response; standard display rights do not necessarily authorize a programmatic data feed)

Without approvals, GET /api/market-radar?network=arc|ethereum|robinhood returns HTTP 503 RADAR_NOT_CONFIGURED. The UI displays an honest source-unavailable/license status rather than imaginary rankings. NO live production rollout or enabling of these flags without verifying terms. Do not use the existing public GeckoTerminal API for a third-party public ranking feed without first confirming permitted publication rights.

Paid endpoint:
https://pro-api.coingecko.com/api/v3/onchain/networks/{arc|eth|robinhood}/pools?sort=h24_volume_usd_desc&include=base_token,quote_token&page=1 (and page=2 if necessary).
Server caches snapshots for 600 seconds; Vercel edge caching s-maxage 600. Stale results are not served on failed refresh.

## Verification
- node --test test/market-radar.test.js
- node scripts/probe-market-radar.cjs (source connectivity **internal CI only**, GeckoTerminal public endpoint, no redistribution, three network probes)
- On authorized dev environment: compare each ranked token against its exact contract page; verify 10-minute freshness, license attribution, no duplicate token addresses, no cross-chain links, 5-row pager and mobile view.
- Regression: existing 20-metric fields and chart controls still render, details open, 3 networks searchable, home Pulse and Unlocks unchanged.
- Review any deployment preview with a real browser for responsive scrolling before merge. Do not merge while data rights remain unresolved.

## Disclaimers
Ranking is **not** an all-chain census, not a whale alert, and not investment advice. Prices and liquidity are for the selected highest-volume pool, not necessarily executable prices. Unknown values remain unavailable, not zero.
