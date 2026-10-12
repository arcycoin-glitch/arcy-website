# ARCY SEARCH — locked second-page design (12 October 2026)

## Updated owner decision — GeckoTerminal official embed (12 October 2026)
- Preserve the three-chain discovery UI (Arc, Ethereum, Robinhood Chain).
- Preserve `/search/token/:network/:address`, the second-page token identity, search-within-detail, five research cards and 20 evidence checks.
- Preserve the three summary metrics (price, tracked liquidity, supply when source-backed).
- **Price history now uses GeckoTerminal's officially supported live iframe embed**, with attribution and a source link. The owner explicitly selected the provider-controlled chart to eliminate reliance on our blocked historical price endpoint. Native ARCY SVG code remains available for a future licensed use case but is not rendered by default.
- Retain 4H / 1D / 1W / 30D controls as **resolution presets**. GeckoTerminal controls the viewport and live data refresh; do not claim these presets lock the displayed date window.
- Embed only on mapped Arc and Ethereum networks. Robinhood Chain displays an unsupported-chart note rather than a wrong network or token chart. Never synthesize candles. Official embed guide: https://about.geckoterminal.com/embed-charts .
- Use one exactly matched chain+contract+pool for each historical series. Never label FDV as market capitalization.
- The separate raw OHLCV endpoint `search/server/api/chart.js` still fails closed until raw price-data republication permission is confirmed. The official iframe does not call it or require this permission flag. Public API availability is not a redistribution license.

## Search token artwork
- For known contract-matched assets, `search/server/lib/search-logo.js` maps the exact chain+contract to a site-owned ARCY mascot or locally served icons from `spothq/cryptocurrency-icons` (CC0-1.0). Inspect source: https://github.com/spothq/cryptocurrency-icons.
- The local set currently covers USDC, USDT, LINK, UNI, DAI, WBTC and PAXG. In search results, unknown/unsupported addresses must retain initials; never assign an identity or logo by ticker alone.
- Icons are visual decoration, not contract or issuer verification. Do not load remote SVG/HTML or arbitrary third-party artwork based on untrusted token metadata.

## Site regression protection
Do not remove or truncate Burn, Token Unlocks, ARCY Arc Pulse, Research, Swap, X/Telegram or the canonical owl. Arc Pulse's #003 six-section editorial publication must remain an accessible historical edition; a new quiet week may have no new verified news but must not silently erase previous publications.

## QA
- Test mobile viewport at 390px and desktop. Check no horizontal overflow.
- Verify Arc ARCY / Ethereum USDC / Robinhood TSLA source-backed reports.
- Verify logo loading on both search and detail page; malformed and unknown addresses must not get branded logos.
- Verify four iframe resolution presets, exact token contract path, correct network, attribution/source link, raw-data endpoint pending status, and unsupported-chain fallback.
- Automated QA fixture charts are not live production price evidence.
