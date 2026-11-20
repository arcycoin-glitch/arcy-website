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

## V7 hardening (engineering audit, PR #301 on top of #300)

| # | Defect found in #300 | Effect | Fix |
|---|---|---|---|
| 1 | OHLCV planning queued every cached pool, fresh or stale, before new candidates. | After ~20 h, the same ranked rows re-spent the bounded provider calls. Candidates lower in the list never got history, so they could not earn history or compression evidence. | Order is now FRESH (no call) → NEW (bounded) → STALE (refresh last; dated candles are still served when the budget is spent). Covered by `ohlcvPlan` + V7-H1. |
| 2 | OHLCV targeting looked only at the 10 published WATCH rows. | Near-qualifying rows ranked 11+ never received history. | The engine-internal `watchAll` list is used instead (not published). |
| 3 | With no provider tier (cron without a key), the OHLCV cache was ignored completely. | Every scheduled run lost compression evidence that had already been collected. | Cache-only reuse makes no request; age is judged by the compression model (> 3 days → INSUFFICIENT_HISTORY). |
| 4 | The provider kept calling after a 429. Empty or malformed answers returned null and an empty list overwrote the cache. | Rate-limit hammering; collected history could be lost. | The first 429/5xx stops calls for the run. Failures keep the cached candles. New candles merge into the history by day. Covered by V7-H4. |
| 5 | Compression accepted gapped provider series (days with no candles). | A sparse, illiquid series could read as "compressed". | ≥ 80 % daily coverage is required, else `SERIES_HAS_GAPS`. Covered by V7-H5. |
| 6 | Official discovery always took the same top 18/32 by curation and liquidity. Profile links were fetched only for the 30 most liquid contracts. | Contracts beyond that slice never gained official-source evidence, so the 60-intake / 40-display could not fill progressively. | A persisted rotation ledger checks never-checked contracts first, then least-recent. Links are looked up for the whole intake (two batches). A budget skip is not recorded as a check. Covered by V7-H2/H3. |
| 7 | GitHub research was cached only in process. `repos` had no TTL. | About 10 GitHub calls per project on every 2-hour run. | Persisted TTL cache (`intel-cache.json`); transient failures are never stored. Covered by V7-H6. |
| 8 | No size check before publishing (serving limit 3 MB, 1.5 s read). | At ~13 KB per row, 160 rows is close to the limit. An oversize file would silently force the legacy fallback. | The builder refuses to publish above 2.6 MB; the previous snapshot stays live. Size is reported. Covered by V7-H8. |

Unchanged: ranking bands and score, profile ≥ 60, identity/market gates, risk vetoes, 40-row cap, legacy 10-row paths, UI/CSS.
