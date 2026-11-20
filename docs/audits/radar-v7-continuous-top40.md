# ARCY Radar V7 — continuous, research-first Top 40

Scope: successor to PR #299 (V6), preserving its evidence/risk rules. This branch does not merge or release production.

## Contract

- The V6 research engine selects **at most 40 per network**: Arc, Ethereum, Robinhood, Pons.
- Main ranking uses the **unchanged** V6 hard gates (profile completeness >=60, identity >=12, market >=10, critical risk veto, history, exact contract, verified provenance). No forced backfill, fake logo/profile, or altered safety threshold.
- A-grade `TOP_RESEARCH_SIGNAL` (measured compression + corroborating independent signal) sorts first; quality growth and established-quality candidates follow; other qualifying research candidates follow last. Missing compression is *not* a positive signal.
- WATCH_ONLY and anonymous tokens do not fill empty main slots. If only 7 qualify, show 7.
- The V4 / V5 ranking and older snapshots remain capped at 10.
- Existing Radar page DOM and CSS are unchanged. Overview remains compact (5 rows collapsed); expanded list shows the verified results and detailed view uses existing 5-row pagination (up to 8 pages).
- Source data, scores, reasons, Info, and risk evidence remain attached to exact chain ID + contract. Discovery Score is unchanged.

## Always-on execution after release

- GitHub Actions cron **41 */2 * * *** (UTC, every two hours), plus manual dispatch and on-push update.
- Cron runs independently of page visits; only a validated read-only snapshot is committed to the data-only branch. Workflows are serialized, with no force push; Vercel does not deploy the data branches.
- Freshness window stays 6h; controlled stale-grace 24h; after expiry the public handler falls back to legacy Radar, never inventing current rows.
- All ranked candidates can use prior exact-pool OHLCV history from the data branch. Up to 10 uncached pools per network are fetched in any single cycle (provider global budget still applies). Cached history is rechecked per provider freshness; failures retain dated source labels.
- The audited market-memory risk ledger is carried across refresh cycles. Snapshot history index retains last 84 runs (~7 days).
- Cron provider OHLCV requires configured CoinGecko Demo/Pro key; no unauthorized keyless cron polling. If not configured, the compression model reports insufficient evidence and A signals are not fabricated.
- The workflow's validation suite runs before publication; invalid output aborts without replacing the previous good snapshot.

## Release / verification steps

1. CI tests pass: `node --test test/radar-v6-top10.test.js test/radar-v4.test.js test/radar-v5-final.test.js test/radar-immutable-snapshot.test.js` plus workflow's complete Radar test suite.
2. Run preview on PR, verify each network `rows.length <= 40`, no shared Pons/Robinhood contract, exact-address identity, score and rank order.
3. Verify data-branch readback and timestamp, data size below 3 MB, mobile 320/390px layout unchanged, navigation uses 5-row paging.
4. Confirm data provider entitlement and production feature flag. Only after review/merge is cron guaranteed to run from default branch.
5. Do not claim 40 qualifying real projects without sufficient source data. Publish actual count and shortfall reasons.
