# ARCY SEARCH — isolated release acceptance
Status: **DRAFT / not cleared for production**
Date: 2026-10-11

## Hard product boundaries
- `arcyusdc.xyz` main site **must remain exactly the existing ARCY page**: original hero and waving owl, Burn, Unlocks, Pulse, Swap, Research, social links, existing 11 root APIs and background worker integrations.
- This branch upgrades only Search: original homepage Search CTA -> `/search/`; original site's own domain will eventually serve it.
- `/search/token/{arc|ethereum|robinhood}/{fullEvmContract}` is token-specific detailed research; direct refresh/back/link must work.
- The superseded new standalone Vercel project is **NOT the production replacement**. Do not transfer domains to it, merge prototype repos, or change DNS.
- This branch was NOT merged into `main`, and preview deployments have **no production target**.

## Product behavior
- Deep navy/cyan minimal search, network names and pictograms, logo-first exact-chain/address candidate matching.
- An image, ticker, explorer listing or stock-token registry reference is NOT sufficient to claim price integrity, economic safety or an issuer's solvency.
- Three highlighted metrics use the most relevant **actually source-backed** fields on that chain: price/liquidity/holders when verified; otherwise pinned supply and current burn-address balances. No blank 2+1 mobile cards or numbers fabricated from missing data.
- Historical chart: real GeckoTerminal matched network + full token contract + exact pool, latest available *up to 30* daily USD closes, clear source attribution, touch/keyboard accessible UTC date and pool price. Arc/ETH/Robinhood support verified with real provider fixtures/live acceptance.
- Source outage 429/5xx/timeout => explicit TEMPORARY failure and retry hint; genuinely unproven pool => NOT VERIFIED. Fail closed; never interpolate untrusted price candles, assume $1 pegging or reuse a chart from another token.
- All deep information remains optionally expandable (5 cards / 20 fields, evidence, explanations), missing signals identified without false zeroes.

## Automated acceptance
- Original legacy regressions: 185 tests historically passed.
- With 4 new credential/evidence guard tests: 189 tests passed on earlier commits; additional temporary chart outage check added subsequently. Check latest Actions outcome before promoting.
- Chromium UI acceptance at 320, 390, 768, 1440 px: original page intact, zero horizontal scroll, old Search CTA, dark 3-chain picker, deep-link report, 3 aligned metrics, source-specific charts and unavailable-provider behaviors.
- Real mainnet report (previously): Arc ARCY ~11/20, Ethereum USDC ~12/20, Robinhood APLD ~3/20 data-source fields. These are coverage observations, NOT completeness guarantees.
- Real Robinhood Chain GeckoTerminal OHLCV: pool-matched token `0xa8c350770f2dbdca9d2f2af57b71c4bd28aa9319`, 22 valid observed daily USD closes from 2026-09-20 through 2026-10-11 in one observed test. The 30D chart label must not falsely claim 30 samples if fewer exist.
- Robinhood explorer count: optional `BLOCKSCOUT_API_KEY` (free PRO key format `proapi_...`); server-side ONLY. Never print keys, put them in browser, or include them in evidence source URLs. No key or failed source => NOT VERIFIED; do not attempt whale concentration based on a partial list.

## Provider operations and limitations
- GeckoTerminal Public API: published free limit **approximately 10 calls/minute**, subject to variation. Historical endpoint typically involves token-pool discovery and an OHLCV call. 2-minute server/CDN caching helps but is NOT a replacement for production quota or a licensed tier.
- Source types: Arc/ETH/Robinhood mainnet RPC (pinned-block supply), DexScreener exact chain/pair spot information, Ethereum/Robinhood Blockscout source holder count, Ed25519-signed COMPLETE Arc worker publication when configured, official Robinhood stock token registry, GeckoTerminal per-pool chart. Stock-token registry identity is not proof of direct share ownership.
- Original source terms, attribution, redistribution limits, reliability SLAs, WAF and commercial-use permissions **must be checked** for public traffic; a free endpoint or a browser-accessible image is not automatically licensed for unlimited commercial redistribution.
- Existing request limiter is **per serverless runtime only**. Configure a distributed Vercel WAF/rate-limit and upstream provider quota handling before significant launch traffic.
- Never treat current burn-address ownership as lifetime completed buybacks; never copy outdated ARCY fee allocation marketing numbers as current on-chain fact.
- Unavailable third-party metadata should never block on-chain data rendering. Mainnet source failures should give explicit status rather than a false official badge.

## Explicit blockers to production merge / public rollout
- [ ] Latest complete Node and Chromium tests are green after all branch changes.
- [ ] Vercel team `arcy3` authorization works with `arcy-official` **branch preview** and API; prior connector checks returned 403. This prevents actual deployment HTTP/browser acceptance even if Vercel reports READY. User must re-authorize its Vercel connector for the correct account/team if this persists.
- [ ] From an authorized browser, verify deployed `/search/`, `/search/token/ethereum/0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` (ONDO), `/search/token/arc/0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` (ARCY), Robinhood stock token, and live `/api/search?action=report&chain=ethereum&address=...`.
- [ ] Confirm external API quota and image reuse permissions plus production Vercel WAF.
- [ ] Independently verify loading/failure/freshness and chain identity with deployed live APIs, not only fixtures.
- [ ] Performance/accessibility review on Android/Brave and iOS/Safari. Ensure no significant regressions to original site.
- [ ] Owner approves promoting Search-only change; retain original site version as one-click rollback.

**Release decision: remain DRAFT and not on the live domain until these gates pass.**


## Chart timeframe upgrade — 2026-10-11
- User-requested mobile timeframe controls: **4H, 1D, 1W, 30D** (four hour, one day, one week, thirty days). Default 30D.
- No weekly OHLCV endpoint is fabricated: 1W uses 7 daily pool closes; 1D uses 24 hourly; 4H uses up to 16 real 15-minute closes; 30D uses up to 30 daily closes. Sample count and UTC candle timestamp are taken from returned source, not assumed.
- GeckoTerminal timeframe and aggregate values correspond to its published `minute`, `hour`, `day` OHLCV endpoint. Chart requests explicitly bind network + full token contract + timeframe, and source addresses are cross-checked against OHLCV response metadata.
- Each interval is cached independently, while exact-contract pool lookup is shared for two minutes to reduce GeckoTerminal public API calls on rapid interval switching.
- Outdated sparse pool data for a four-hour selection is **not shown as current**. Without at least three recent source candles, the chart stays unavailable. Concurrent response ordering protected with AbortController and a generation counter.
- The on-chain report CTA appears immediately below the research heading in a high-contrast accent card with live source-backed metric count and 20-check label; risk warning and full evidence live behind its expandable disclosure.
- Regression test: **195/195 Node tests + 4/4 Chromium widths** at commit `f1f6da810dfe68bc368a419b78811c2b4dc24bdd`, https://github.com/arcycoin-glitch/arcy-website/actions/runs/38157508585 .
- Live GeckoTerminal WETH multi-range probe on GitHub Actions was rate-limited (HTTP 429) for intraday windows, with daily data unavailable from the selected pool. This is a **provider availability limitation**, not a pass; do not claim four independently verified live timeframes. The interface clearly shows unavailability instead of inferred prices. https://github.com/arcycoin-glitch/arcy-website/actions/runs/38157279491 .
- New preview build blocked by **Vercel Hobby daily deployment quota (HTTP 402, `api-deployments-free-per-day`)**; last checked no Vercel deployment existed for the newest commit. The user may wait for quota renewal or adjust their plan/billing themselves. Do not bypass the quota or link an earlier preview as the new version.
