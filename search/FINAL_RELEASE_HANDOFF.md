# ARCY SEARCH — final Codex acceptance / release handoff
Updated: 2026-10-11. This document is operational guidance, NOT a production approval.

## Non-negotiable boundaries
- Work ONLY on `feature/search-multichain-premium-20261011` until every gate passes. Keep PR #1 in draft.
- The original `arcyusdc.xyz` hero/owl, Burn, Unlocks, Pulse, Swap, Research, X/Telegram links, all original root APIs, worker, cron, and brand assets must remain intact.
- Do not merge to `main`, update DNS, change aliases/protection, or promote a production deployment before owner approval and successful real preview acceptance.
- Sources must match both chain ID AND full token contract. No synthetic candles, missing-as-zero, guessed LP lock, stale whales, or unsupported official-contract badge.

## 1. Local clean checkout / exact branch
```bash
git fetch origin
git switch feature/search-multichain-premium-20261011
git pull --ff-only
node --version
npm test
npm run test:browser
```
- Use Node 22 or newer. Resolve all regressions, do not suppress failures.
- Browser suite must pass all 320 / 390 / 768 / 1440 viewports, zero horizontal overflow and zero page errors.
- Repeat quick-card test when just 1–2 of 20 source fields are verified: three tiles should remain level, and missing fields must say NOT VERIFIED.
- Verify small `priceUsd` numbers show four significant digits without scientific notation where feasible; K/M/B for supply, volume, valuation. A Market Cap / FDV label appears exactly ONCE.

## 2. Real mainnet coverage — no mocked data
```bash
node scripts/search-mainnet-acceptance.cjs
node scripts/search-four-contracts-live.cjs
node scripts/search-chart-ranges-live.cjs
node scripts/search-robinhood-chart-live.cjs
```
Mainnet cases:
- Arc: ARCY `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` and Circle USDC `0x3600000000000000000000000000000000000000`.
- Ethereum: Circle USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` and ONDO `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3`.
- Robinhood Chain: APLD `0xb8dbf92f9741c9ac1c32115e78581f23509916fd`.
- Enforce exact addresses, three distinct chain IDs (5042 / 1 / 4663), five schema cards, 20 fields and source evidence. Record sourced counts and provider errors per token.
- A source outage (429, 503, RPC timeout) is not "no history" or "zero holders"; record it as temporary, investigate provider terms/limits, retry conservatively. Do not force all 20 fields to be populated.
- For chart 4H / 1D / 1W / 30D, ensure *actual* pool-matched OHLCV, source link, timestamp, correct candle interval, no stale 4H, no identity mismatch. The engine may try at most two independently matched pools and 1W shares real 30D closes; report any unavailable window honestly.

## 3. Authenticated Vercel PREVIEW, NOT production
- Team: `arcy3`. Project: `arcy-official`. Deploy latest *branch SHA* as **Preview**.
- If a Vercel API / preview fetch reports `403 read_protection_bypass`, reconnect Vercel to the correct team/account, use a permitted authenticated browser, and do not call the preview externally verified until access works.
- Test deployed `/search/`, three exact-token deep links and `/api/search?action=health`.
- Expected health response: `readOnly=true`, networks `arc,ethereum,robinhood`, chainIds `5042,1,4663`, `expectedCards=5`, `expectedMetrics=20`.
- Test `/api/search?action=report&chain=arc&address=0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` and matching Ethereum and Robinhood calls.
- Test `/api/search?action=chart&chain=ethereum&address=0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3&range=1W`, then 4H, 1D and 30D. Provider failure may require a controlled retry; never fabricate candlesticks.
- Confirm deployed API returns no private credentials, no leaked keys/headers, and no HTML-error response interpreted as JSON.
- Cold Arc scans can take tens of seconds; record load timings with empty caches and warm caches separately.

## 4. Manual buyer and device acceptance
- Android Chrome/Brave and iPhone Safari, desktop Chromium. Validate Search/Scan, network picker, named search, verified vs unverified candidates, full contract, wrong-network non-match, back/forward/deep reload, copy link and responsive logo layout.
- 3 headline tiles should not overrun 320px or become a 2+1 grid. Blank data should say NOT VERIFIED, not pretend current market observations.
- Full "Explore full on-chain report" CTA is easily visible and opens 5 cards with 20 sourced or explicitly unknown fields.
- Original home sections and burn/unlock/weekly Pulse remain present and functional.
- Market Cap and FDV cannot be conflated; burn address *current custody* is not lifetime completed buyback-and-burn; a pool is not an LP lock; dated holder snapshots older than 48 hours cannot be shown as current.
- Verify no deployment protection bypass token is posted publicly.

## 5. Production gates / rollback
Before asking the owner to release:
1. Green CURRENT-HEAD Node + Chromium workflows and real chain report checks. Review unresolved chart outages honestly.
2. Authorized, directly tested deployed preview (not just a READY build) and real browser screenshots at phone widths.
3. Provider licensing, public API usage quotas, image reuse, WAF/rate-limits, and error handling reviewed for production traffic.
4. Recent Arc holder signed source configured if claiming CURRENT whales; otherwise display NOT VERIFIED without stale data.
5. Record the currently deployed `main` production SHA and Vercel deployment ID as rollback.
6. Explicit owner approval to merge Search-only PR #1 and deploy production. Verify production `/search/`, home, /api/search health and actual reports, then monitor 4xx/5xx.

Final Codex report MUST include: exact branch/SHA, passing/failing test counts, 3-chain real contracts and field coverage, availability of each chart interval, Android/iPhone results, Vercel preview URL, remaining blockers, and a definitive GO / NO-GO with technical reasons. Never report GO on test fixtures alone.
