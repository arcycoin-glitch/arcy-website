# Search reliability pass — 2026-11-01 (branch `data/search-reliability-20261101`, Draft PR #123)

Scope: backend only. UI, cards, labels, API contracts, protected files and approved baselines are untouched.
Start: `main` @ 426e23f (includes PR #122). Baseline: `npm test` 819/819.

## What was measured (evidence, not assumptions)
Read-only CI probes (`scripts/probe-discovery-latency.cjs`, `scripts/probe-explorer-access.cjs`, GitHub-hosted runner, 10 queries per chain, 600 ms apart). These are runner measurements, not Production measurements.

| Explorer search | Result |
|---|---|
| Ethereum (eth.blockscout.com) | 9 of 10 answered; p50 2669 ms, p95 6412 ms; 6 of 9 above 1 s; 1 timeout at 8 s |
| Arc (explorer.arc.io) | 10 of 10 HTTP 403 |
| Robinhood (robinhoodchain.blockscout.com) | 10 of 10 HTTP 403 |
| Honest identifying User-Agent | No effect (still 403) |
| arcscan.app / arcexplorer.org | DNS failure / timeout |

Consequences: (1) the old flat 1 s cap discarded most valid Ethereum explorer answers; (2) Arc, Robinhood and therefore Pons name search cannot rely on the explorer index from CI. Whether Production sees 403 is **not measured**.

## Changes
1. `rpc-errors.js` (new) + `robinhood-rpc.js`: JSON-RPC rate-limit/capacity errors (e.g. -32005) now fail over to the independent backup, which still has to prove chain 4663. Reverts, invalid params and invalid opcodes are deterministic and are never re-sent. Before this, Robinhood treated every JSON-RPC error as final while Arc and Ethereum already recovered. Test 2 in `test/rpc-resilience.test.js` fails on `main` and passes here.
2. `multichain-service.discover`: foreground stays ~1 s whenever any other candidate exists (the existing contract, pinned by two existing tests). Only when nothing else was found does the explorer index get up to 4 s (UI waits 7–12 s).
3. `diagnostics.js`: explorer.arc.io, robinhoodchain.blockscout.com and api.robinhood.com get proper provider labels (previously "other"); new aggregate-only outcome `deadline` shows when an optional provider misses its window. No addresses, queries or URLs are stored (tested).
4. Tests: `test/rpc-resilience.test.js` (8 tests: transient vs deterministic classification, failover, no-resend of reverts, wrong-chain backup rejected, slow explorer kept, hung explorer bounded, telemetry privacy, cross-chain identity isolation).
5. `scripts/scheduled-health.cjs` + `.github/workflows/scheduled-health.yml`: read-only check every 6 h (4 requests): health, per-chain discovery isolation (no dependency on any single token listing).

Tried and rejected: an origin-wide 403 cool-down in `source-request.js`. It would change request counts that an existing test pins and the benefit is unmeasured, so it was removed.

## Before / after
- Tests: 819/819 → 827/827 (full suite).
- Discovery: Ethereum answers arriving in 1–4 s are now kept when no other candidate exists; latency for searches that already had candidates is unchanged. Not measured in Production.
- Robinhood: JSON-RPC rate limits now recover through the backup (proved by unit test, not by Production traffic).
- RPC/API budget: no new requests on the normal path; at most the already-existing backup call on a transient Robinhood error.
- Verified-coverage figures are unchanged by this pass (no Mechanics/Holder/Market logic touched). Accuracy remains UNESTABLISHED.

## What runs automatically, and what does not
- Runs on its own: GitHub Actions regression on every PR; `scheduled-health.yml` every 6 h once this file exists on `main` (GitHub cron is best-effort). A failing run is the alert; GitHub notifies per each person's settings.
- Does **not** run: anything inside a Claude session after it ends; any repair, rollback or deploy; any holder-worker/Railway action. In-process diagnostics reset on every cold start.

## Not done in this pass (honest scope)
Phase 3 areas other than the Robinhood RPC path (supply, holder snapshots, liquidity/market, Unlocks/Pulse internals) were audited only by reading the discovery/RPC/source layers; no change was justified by measured evidence, so none was made. Pons name discovery without an explorer needs a new data source or the Radar cache, which has its own licensing flags — owner decision. Ethereum RPC has a single endpoint (no backup); adding one is an infrastructure decision, not made here.

## Release / rollback
Release only after review: mark PR #123 ready, merge via the protected workflow, let Vercel deploy, then run `node scripts/scheduled-health.cjs` against Production. Rollback: revert the merge commit (or promote the previous Vercel deployment); the change is additive and has no data migration.

## Addendum — Radar 24h change (Robinhood) and health check

Real-source probe (`scripts/probe-radar-change24h.cjs`, production Radar code, keyless GeckoTerminal + DEX Screener, CI runner, ~minutes apart, so the token lists differ slightly):

| Network | Run | Reported | Recovered same-pool | Sources disagree | Missing at source | Parse loss (software) | GeckoTerminal / DEX / RPC requests |
|---|---|---|---|---|---|---|---|
| Robinhood | before | 8 | 0 | 2 (Claude, Kongo) | 0 | 0 | 4 / 1 / 5 |
| Robinhood | after  | 7 | 0 | 3 (Claude, ORIGO, Kongo) | 0 | 0 | 4 / 1 / 5 |
| Pons | before / after | 1 | 9 / 9 | 0 | 0 | 0 | 1 / 1 / 13 (both) |
| Arc | before / after | 8 / 9 | 0 | 2 / 0 | 0 | 0 | 4 / 1 / 0 (both) |
| Ethereum | after | 8 | 0 | 2 | 0 | 0 | 4 / 1 / 0 |

(The "before" Ethereum line was dropped by GitHub's 10-annotation cap; its request counts are therefore only shown for "after". The before/after lists are different snapshots, so only the mechanism, not a coverage delta, is comparable.)

Root cause of the `—` cells: in every measured Robinhood row the provider **did** report `price_change_percentage.h24` for the exact pool (raw column), and no value was lost in parsing or candidate selection. The cells are empty because GeckoTerminal and DEX Screener disagree by more than the existing 3-point rule on very large movers (e.g. Claude +750 % vs +609 %; ORIGO +2880 % vs +2524 %; Kongo +836 % vs +797 %). Those values are correctly `NOT_VERIFIED / SOURCES_DISAGREE`. A fixed 3-point band is strict for +700 % moves (a 1 % price-snapshot drift is already ~8 points there); relaxing it would be a verification-standard change, so it was **not** made and is an owner decision. The reported screenshot cell for FOREVER was not reproducible (both sources agreed in both runs).

Change: same-pool recovery from the token lookup's `include=top_pools` (same single request, same credit) now also runs for Robinhood, but only when a shortlisted row lacks h24. Measured effect on today's data: 0 additional values, 0 additional requests (nothing was missing at the source). It protects against pool-list rows that omit h24, proven only by unit tests (recovered from the same exact pool; other pools never borrowed; exact 0 % kept; pools younger than 24 h keep POOL_LESS_THAN_24H_OLD; Arc/Ethereum request shape unchanged; no include when nothing is missing).

Health check: `scheduled-health.cjs` no longer requires the historical Arc ARCY token to be discoverable and contains no token address; it still checks the health endpoint (5 token-card schema; the sixth UI card is the global Unlock calendar), the chain ids 5042 / 1 / 4663 and per-network identity isolation with 4 requests (tests in `test/scheduled-health.test.js`).

Full suite: 836/836.

## Final reliability pass (PR #124) — measurements of 2026-11-01 (CI runner → public production API, read-only)

Baseline: `main` bd9ddee (merge of PR #123), Production deployment on the same SHA, `npm test` 836/836. Rollback candidate: the previous Vercel production deployment (promote it in Vercel) or revert the merge commit.

### Field fill by network and card (10 Radar tokens per network; Pons = 8 tokens, Robinhood subset, NOT added to the three-network total)
Fill is **completeness, not accuracy**; no ground truth exists, so accuracy is UNESTABLISHED. Each card has 4 measured fields per token.

| Network | Supply | Holder & Whale | Liquidity & Exit | Market Activity | Contract & Mechanics | All five cards |
|---|---|---|---|---|---|---|
| Arc (10) | 40/40 | 24/40 | 39/40 | 40/40 | 19/40 | 162/200 = 81.0 % |
| Ethereum (10) | 40/40 | 37/40 | 39/40 | 40/40 | 26/40 | 182/200 = 91.0 % |
| Robinhood (10) | 40/40 | 40/40 | 40/40 | 40/40 | 20/40 | 180/200 = 90.0 % |
| **Three networks** | | | | | | **524/600 = 87.3 %** |
| Pons (8, subset) | 32/32 | 32/32 | 32/32 | 32/32 | 11/32 | 139/160 = 86.9 % |

(The sixth UI card, Token Unlocks, is a global calendar and not part of per-token fill.)

Evidence classes of the same fields (three networks, 600 fields): on-chain verified 248, single source 276, not verified 76. Independently cross-verified (multi-source) fields in these five cards: 0. Pons: on-chain 65, single source 74, not verified 21. Data freshness/staleness was not separately measured in this pass. Weakest cards: Contract & Mechanics (19–26 of 40 on main networks, 11 of 32 on Pons) and Arc Holder & Whale (24/40) — consistent with PR #122's finding that most gaps are missing verified source code, not parsing defects.

### Radar "—" cells (24 h change), reasons and decisions
| Network | Shown | Dash | Reason of each dash |
|---|---|---|---|
| Pons | 10 (8 recovered from the same exact pool) | 0 | – |
| Robinhood | 8 | 2 | Claude (13.6 h old) and NIGGARACKET (~15 h old): both providers report a partial window and disagree |
| Ethereum | 9 | 1 | **GTA6** (pool `0xc4fc3066…f88f`, opened 2026-10-29, > 2 days): GeckoTerminal 62.092 vs DEX Screener 57.19 → 4.9 points apart; both are full 24 h windows, so this is a genuine source disagreement; tolerance (3 points) intentionally unchanged |
| Arc | 8 | 2 | bob and NVIDIH (< 1 h old): partial window, providers disagree |

DacityCoin and Super Inu were no longer among the ten Ethereum Radar rows at measurement time, so their current state could not be re-verified by address; the young-pool rule was verified on the Arc/Robinhood young pools above and by unit tests.

**Finding (not changed):** GeckoTerminal reports `h24` for pools younger than 24 h as the change since the pool opened (e.g. Ribon 0.2 h old: m15 = m30 = h1 = h6 = h24 = 189.894; ORIGO 5.1 h: h6 = h24 = 2262.8). Seven rows currently shown as "24 h change" are therefore partial windows (Arc Ribon, Pons WANDER, ORIGO, ZKBLAST, WAFERMAP, INSULA, SLIPPYGME). Hiding them changes displayed values and the Discovery Score (momentum component and the EXTREME_PUMP flag), and the ranking effect could not be bounded here, so it is a recommendation for owner approval, not a code change.

**Changed:** when a pool is younger than 24 h and the sources disagree, the stored reason is now `POOL_LESS_THAN_24H_OLD` with a text that says the figures are partial windows (value stays null; `sourcesDisagree: true` kept for diagnostics). Pools older than 24 h keep `SOURCES_DISAGREE`.

### Transport policy (Arc and Robinhood)
Provider-side rate-limit/capacity errors fail over to the chain-checked backup; contract reverts, invalid params, wrong chain and pruned-history/unknown-block errors are deterministic and are not re-sent. Arc previously re-sent every JSON-RPC error (including a missing optional `owner()` getter) to the backup, and then to the legacy reader. Unit tests count the calls (1 instead of 2–3 per revert).

Measured with the paired Mechanics replay benchmark (same recorded provider answers fed to `main` and to this branch, 52 contracts): RPC requests Arc **426 → 312 (−114, −26.8 %)**, all networks **1078 → 964 (−10.6 %)**; Sourcify 76 → 76; field coverage identical on every network and field (Arc 6/6/6/11, Robinhood 3/3/4/10, Ethereum 12/12/16/18, Pons 0/0/0/7 for taxes/mint/owner/architecture); provider failures 36 → 33; the mandatory regression gate passed. Live latency is noise and is not claimed.

### Health check (`scripts/scheduled-health.cjs`)
7 read-only requests: health endpoint (5-entry token-card schema; the sixth UI card is the global Unlock calendar), per-network discovery isolation ×3, exact-address on-chain read of one issuer-documented canonical contract per network ×3 (proves RPC → decoding → API without any DEX/explorer index). Does not call Radar/holders/reports (no provider credits). A first run against Production caught a wrong card-count assumption in the version merged by PR #123 (it would have failed every scheduled run); fixed here and re-run green against Production.

## Can the site run itself? (answer as of this PR)
**Does by itself, without a person:** serves every request from stateless Vercel functions with bounded timeouts; coalesces identical in-flight reads; keeps per-origin cool-downs and circuit breakers per process; fails over Arc/Robinhood RPC to a chain-checked backup on transient errors; withholds (shows "—"/NOT_VERIFIED with a reason) instead of inventing data; GitHub Actions runs the regression suite on every PR and the scheduled health check every 6 h (first scheduled run after PR #123 is 18:17 UTC; GitHub cron is best-effort).
**Absorbs automatically:** a single RPC provider outage or rate limit on Arc/Robinhood; slow/hung explorer or DEX index (partial result with `unavailableSources`); a failed health probe is surfaced as a failed GitHub run.
**Still needs a person:** Ethereum has a single RPC endpoint (no backup); Arc/Robinhood explorer indexes returned 403 to CI (Production reachability unmeasured); the Railway holder worker's health is not observable from this repository (state UNKNOWN in `/api/search?action=health`); alerts depend on GitHub notification settings; provider licences/approvals, budget decisions, merges and deploys; anything that needs new data sources (verified source code for unlisted tokens, Pons names without an explorer); the young-pool and tolerance decisions above.

## 7–14 day unattended monitoring plan (existing tools only)
1. Day 0: merge PR #124 after review; confirm `Scheduled production health check` is green on the next scheduled run.
2. Daily (2 min, optional): open the Actions tab; expected: 4 scheduled runs/day, all green. Any red run = look at the `::error title=ARCY health …` annotation.
3. Day 3 and Day 7: run **Production read-only measurement (manual)** (workflow_dispatch) and compare the per-network fill table with this document; a drop of more than 10 percentage points on one network/card, or any new `NO_REASON` dash in the Radar probe, is a regression to investigate.
4. Day 7 and Day 14: run the **Mechanics before/after benchmark** manually only if mechanics files changed.
5. Success criteria after 14 days: ≥ 95 % of scheduled health runs green (GitHub-side outages excluded), no run red for the same check on two consecutive days without an explanation, fill table not below this baseline by more than 5 points, no unexplained dash in Radar rows.
This plan relies on GitHub-hosted scheduling; it does not rely on a Claude session.

Full suite at the final head: 843/843 (836 baseline + 7 new).
