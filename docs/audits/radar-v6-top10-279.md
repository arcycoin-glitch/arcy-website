# Radar V6 — Premium Top 10 Discovery Engine (#279, PR #299, 2026-11-20)

PR #299 builds on PR #298 (`arcy-research-rank-2`, 7 commits, kept unchanged) on top of main `97df18d` (V5 #295 + P0 #297).

## Bottlenecks found before coding
| Network | Production V5 main list | Root cause |
|---|---|---|
| Ethereum | 5–6 established projects | Most listed contracts lack a source showing official identity. The DEX-only 24h volume of many DeFi tokens is below the $100k network floor. Filter B quality < 40. |
| Arc | 3 | The explorer answers CI with HTTP 403, so there is no Arc-native index. The V3 window holds mostly monitor-class pools. |
| Robinhood | 5 | Providers disagree up to 21×, there is no official-source evidence, and many rows are tokenized equity. |
| Pons | 3 | Factory launches with thin liquidity, and collapses visible only in daily series. |

## What V6 adds
| Layer | Version | Rule |
|---|---|---|
| Profile completeness | `arcy-profile-completeness-1` | Six weighted components: identity 20 · official site / docs / purpose 20 · market & source agreement 20 · contract-control analysis 15 · development 15 · history 10. Every awarded part carries its source, URL and time. **The main ranking requires ≥ 60, plus identity ≥ 12 and market ≥ 10 on their own.** Missing evidence scores zero. A logo scores nothing. Development activity counts only from a repository linked from the official page, never from volume. |
| Official sources | `official-discovery.js`, `official-check.js` | Every run, the builder fetches pages on maintainer-reviewed official domains, or the creator-submitted DEX Screener site. A page that publishes the exact contract becomes a dated dossier. Registry domain → `PRIMARY_SOURCE_VERIFIED` (official identity). Creator site → `PARTIAL_EVIDENCE` (identity stays at metadata level). Reviewed static pages are re-checked: if the address is missing, the result is `IDENTITY_SOURCE_CONFLICT` (forged or changed site). Fetches use https only, public hosts, one redirect within the same site, 8 s timeout, a size cap and a per-run budget. |
| Compression | `arcy-compression-1` | Uses real dated daily series only: on-chain reserve samples (RPC) or GeckoTerminal pool OHLCV (completed UTC days only). Measures volatility, range, ATR (only with real high/low), Bollinger bandwidth percentile, volume ratio, liquidity stability and participation. Outcomes: `COMPRESSION_CONFIRMED` (contraction + volume/participation held + stable liquidity), `COMPRESSION_EMERGING` (contraction without volume evidence), `BREAKOUT_ACTIVITY_CONFIRMED` (≥ 2× volume after consolidation, 3-day move within (0, +35 %], participants not falling), `INSUFFICIENT_HISTORY` (< 21 days or stale), `NO_COMPRESSION_EVIDENCE` (incl. dead, flat, illiquid or draining series). |
| Integrity | `arcy-integrity-1` | Each finding is CONFIRMED, SUSPICIOUS, UNVERIFIED or UNAVAILABLE. Checks: recent and historical pump, collapse (memory or a ≥ 40 % 3-day fall), liquidity drain, thin liquidity with high volume, wallet concentration, wash overlap, repeated transactions, provider discrepancy, honeypot / failed exit, critical controls, persistent hold. A confirmed critical finding → WATCH_ONLY. A pump or collapse history → WATCH_ONLY (established projects: context only). Two independent suspicious signals → RESEARCH_CANDIDATE. One observation is counted once. |
| Sorter | `arcy-research-rank-3` + `arcy-research-score-1` | Bands in order: `TOP_RESEARCH_SIGNAL` (≥ 2 independent signals: compression/breakout, reviewed on-chain demand, observed activity growth, verified development; no pump history; no suspicious signal; not established), then `QUALITY_GROWTH`, `ESTABLISHED_QUALITY`, `ADDITIONAL_RESEARCH`. Score = 0.45 × quality + 0.40 × profile + 0.15 × positive compression. Discovery Score is unchanged. WATCH_ONLY never fills a slot. |
| Universe | `established-universe.json` 2026-11-20.1 | Ethereum grows from 28 to 47 exact contracts, each with official domains and pages to check. Arc and Robinhood use the dated capture of their own explorer index when the live explorer returns 403. Batched DEX responses never overwrite a complete per-token pool listing (bug fix). |
| Info | `researchInfoV6` | At most 12 parts and ≤ 900 characters, data time last. Shows band, reason, network/contract, profile breakdown and gaps, identity sources, site/docs status, market, compression window, history, manipulation, contract-risk coverage, rank and score. |

## Real data (Preview snapshot builder, CI, Production V3 input)
See the PR body for the per-run tables. Snapshot runs: 08:25 (V6 gates only), 08:37 (official discovery), 08:44, 08:47 and 08:5x UTC. Every run validated and was read back.

## Limits (not hidden)
- Most established Ethereum tokens trade mainly on CEXs. Their DEX volume is below the $100k floor, so they fail the unchanged V3 gate.
- No configured source verifies X accounts. They are never inferred.
- On-chain contract-control analysis runs only for early-stage candidates (RPC budget). Established rows show 0/15 security and say so.
- Provider OHLCV uses the keyless tier only on manual, PR and merge runs. Scheduled runs need an operator CoinGecko Demo key (`COINGECKO_DEMO_API_KEY` secret). Without it, scheduled runs rely on the cached candles (refreshed at most every 20 h) and on on-chain series.
- The Arc/Robinhood canonical capture expires on 2027-01-04.
