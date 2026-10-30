# ARCY data-engine end-to-end audit — 2026-10-30

Branch `audit/data-engine-end-to-end-20261030` · Draft PR #113 · base `main` a16c9ec · Issue #112.
**PRODUCTION: NOT DEPLOYED / MERGE: NOT DONE.** Data-layer files, tests, CI probes and this document only. The 10 protected skeleton files are byte-identical (`test/data-engine-ui-lock.test.js` green, untouched).

## 1. What was and was not measurable

| Area | How inspected | Limit |
|---|---|---|
| Code, tests, caches, budgets | Read every data module named in Issue #112; full suite `npm test` | — |
| Radar V3 / Pons V1+V2 | GitHub CI live-provider + chain probes (real GeckoTerminal, DEX Screener, Robinhood RPC) | Public RPC rate-limits CI (429); keyless provider tier |
| Railway holder worker, Vercel Production state, stored snapshots/cursors | **Not accessible** from this session (no Railway/Production credentials, by rule) | Holder cursor/backlog and published snapshot ages are **NOT MEASURED**. The "~35 records / cursor >1M blocks behind" claim is neither confirmed nor refuted |
| Search 3 networks × 6 cards coverage matrix | Needs Etherscan/GoPlus/Arc-explorer keys that CI does not hold | **NOT MEASURED**; no numbers invented |
| Browser/UI | Not touched; verified by blob hashes only | Preview UI screenshot comparison not done |

## 2. Data-flow map (source → identity → fetch → verify → cache → publish → API)

- **Search (Arc 5042)** `api/search/index.js` → `search/server/api/*` → `search/server/lib/{arc-adapter,arc-rpc,data-engine,holders,mechanics-deep,…}` → `lib/core.js`. Identity: exact 0x address + `eth_chainId==5042` on every call; fallback RPCs must also pass chain-id check; paced (250 ms/call), 4 concurrent, 3 retries with 250 ms·2ⁿ back-off.
- **Search (Ethereum 1 / Robinhood 4663)** `search/server/lib/{eth,robinhood-*,multichain-service,gecko-market,dex-market}`. Pons is a Robinhood subset (confirmed by factory proof, not a fourth chain).
- **Holder & Whale** `scripts/holder-worker.cjs` (Railway, Arc only) → `lib/holder-{refresh,candidates,storage,publication,rpc,log-range,budget}` → signed snapshots → `api/holders.js`. Logs ≥1000 are treated as truncated and the range is halved; unsigned/partial snapshots are not COMPLETE.
- **Unlocks** `lib/unlock-calendar.js` (6 h cadence) → `lib/unlock-storage.js` (Ed25519-signed `latest.json` + `audit.json`) → `api/unlocks.js` (verifies signature; else live CoinBell fallback).
- **Pulse** `lib/pulse-edition.js` / `pulse-networks.js` → signed editions, archive immutability (`PULSE_EDITION_REGRESSION` guard), Vercel Monday 06:00 UTC cron on `/api/pulse`.
- **Radar V3** `lib/radar-v2/**` → GeckoTerminal top/trending/new + `tokens/multi` → DEX Screener cross-check → Pons factory eth_calls/logs → verified gates → Discovery Score → in-memory TTL cache.
- **Burn / site cards** browser `site-refresh.js` (2 min poll) → `api/supply.js` (Arc RPC balances of zero/dead addresses). UI JS is protected, so only the server side was reviewed.

## 3. Root causes found and fixed in this PR

| # | Finding | Evidence | Fix | Test |
|---|---|---|---|---|
| P0-1 | **Unlock worker retried a failing source every worker loop (~30 s)**: `due()` looked only at `refreshAt`, and a failure never moved it. | code: `lib/unlock-storage.js` `due()`; worker loop sleeps 5–30 s | `lib/refresh-backoff.js`; failures counted (`lastFailure.consecutive`), `due()` waits 5 min doubling up to the 6 h cadence; success resets | `test/data-audit-refresh.test.js` (back-off sequence, reset, fresh never due) |
| P0-2 | **Radar quota bound was a single-instance nominal (13 credits × 720 = 9,360/month)** with no enforcement | `lib/radar-v2/sources.js` TTL floor 60 min | Demo TTL floor **80 min** (13 × 540 = **7,020/month/instance**); new fail-closed ledger `lib/radar-v2/budget.js`: per-process monthly cap 7,500 (hard ceiling 8,000, can only be lowered via `RADAR_V2_MONTHLY_CREDIT_CAP`), `RADAR_BUDGET_EXHAUSTED` ⇒ bounded STALE or error, no provider call; ledger shown in `discovery.creditLedger` | cap/ceiling/rollover test; "no upstream call after cap" test; radar-v2 tests updated to the 80-min TTL |
| P0-3 | **`LIQ_DEF_RATIO` ≈2× rule had no proof and applied to any scope** | see §4 | Rule narrowed to **TOKEN-scoped** GeckoTerminal vs DEX Screener only; keeps the LOWER value, `SOURCE_REPORTED`, with `definitionNote`; never CROSS_VERIFIED; POOL-scoped 2× gaps stay NOT_VERIFIED | `test/radar-v3-discovery.test.js` |
| Info | Radar probe evidence extended (factoryEvents, bondingCurve, exclusion evidence) | CI annotations | scripts only | — |

## 4. P0 liquidity discrepancy — independent evidence

CI probe `scripts/probe-liquidity-definition.cjs` (run `e65dee4`), 6 graduated Pons (Uniswap v4) pools chosen from chain `PoolGraduated` events, raw provider fields:

| Quantity | Result |
|---|---|
| DEX Screener `liquidity.usd` ÷ (base amount × price + quote amount × quote price) | 1.00 on all 6 (counts both sides) |
| GeckoTerminal **pool** `reserve_in_usd` ÷ DEX Screener `liquidity.usd` | 0.99–1.03 (the providers agree at pool level) |
| GeckoTerminal token-pools list value for the same pool | identical to the pool endpoint |
| GeckoTerminal **token** `total_reserve_in_usd` ÷ pool value | 0.48–0.50 (≈ the base-side value only) |

Conclusion: this is a **provider definition mismatch at token scope**, not a contradiction and not inflation. DEX Screener and GeckoTerminal agree when compared like-for-like. The product still shows the conservative (lower) number and does not claim cross-verification. 1 of 6 sampled pools returned no GeckoTerminal pool reserve (listed as `null`; counted as unverified).

## 5. Refresh cadence, budgets and SLOs (as implemented)

| Source | Owner | Cadence / TTL | Failure behaviour | Worst-case cost |
|---|---|---|---|---|
| Unlock calendar | Railway worker loop | 6 h; **now back-off 5 min→6 h after failures** | last signed edition kept; audit records consecutive failures | 3 CoinBell GETs per attempt (+ verified-event reads) |
| Pulse | Vercel cron Monday 06:00 UTC + signed editions | weekly | failure never erases `lastSuccessful`; regression of edition number rejected | official-source fetches only |
| Holder snapshots | Railway worker | per-chain progress; complete delay 10 min, failure/429 60 s, unsupported 24 h | partial never COMPLETE | Arc RPC only |
| Radar | Vercel function memory | Demo TTL **80 min** (Pro 10 min, keyless 45 min) | stale-if-error ≤ bound, 429 cooldown, **credit ledger fail-closed** | 13 credits/cycle ⇒ 7,020/month/instance; RPC ≈13 requests per Pons refresh |
| Search resolvers | per request, coalesced | request-scoped | NOT_VERIFIED with reason codes | provider-specific |

Multi-instance bound: the ledger is memory-only. With N warm instances the ceiling is N × 7,500 credits; cold starts reset it. A truly global bound needs a shared durable counter. **Smallest no-cost option** (not implemented — needs operator decision): store the month counter in the existing Redis already used by the holder queue.

## 6. Error / fallback matrix (selected, all covered by tests)

| Failure | Result |
|---|---|
| Wrong chain id | RPC rejected (`CHAIN_ID_MISMATCH`), never mixed |
| Provider 429 | cooldown, no further calls, bounded STALE label |
| Radar credit cap reached | `RADAR_BUDGET_EXHAUSTED`, zero provider calls, STALE if a recent success exists |
| Unlock source down | last signed edition served; retries back off |
| Public RPC 429 on Pons events | event discovery skipped, status reported; provider windows still rank |
| Token without token-level data | dropped as `NO_TOKEN_LEVEL_DATA`, never scored with nulls |

## 7. Radar V3 measured quality (latest CI probe on the same engine)

| Section | Ranked | Notes |
|---|---|---|
| Arc | 7–8 (varies by run) | ~25 below floors, 8 identity exclusions: genuine eligible-token shortfall |
| Ethereum | 10 | |
| Robinhood | 10 | |
| Pons | 10 (was 5) | V2 TokenLaunched ≈ 27/hour; PoolGraduated 178 events, 30/30 phase-2 confirmed; negative control 0 |

On commit 7b06021: completeness 92.7 %, cross-verified 69.1 % (37 tokens; earlier run 90.6 % / 68.0 %). Figures describe one probe run, not a guarantee.

## 8. Production verification (read-only, 2026-10-30)

| Area | Finding |
|---|---|
| Holder worker | Alive; ARCY job in TAIL (checkpoint ~17:23 local), ≤1000-block ranges. Last COMPLETE snapshot ~19 h old; backlog ≈3.78M blocks behind head at last measurement. Railway dashboard/logs/Redis NOT accessible to this audit. |
| `/api/holders` default path | **Defect fixed**: served a 28-day-old committed snapshot (ARCY 41 holders) in front of the newer remote publication (37). Now `publication.freshest()` returns the highest-block valid COMPLETE one (remote memoised 60 s, successes only). Tests: `test/holder-freshest.test.js`. |
| Unlocks | Signed worker edition present, 6 h cadence, back-off fix for failing source (was ~30 s retry loop). |
| Pulse | Cron editions 3–5 signed Monday 06:0x UTC; live overlay differs from archive status for #5 (observation, protected file). |
| Burn / Supply | Live on-chain reads OK. |
| Search matrix | 10 tokens × 3 networks × 6 fields: 186/200 filled (93 %); gaps = Robinhood unknown-contract Mechanics fields, ASTOCK holders. |

## 9. Shared Radar quota (feasibility → implemented, opt-in)

Redis is private to the Railway worker, so Vercel instances cannot reach it directly. Implemented without new resources or Vercel env vars: `POST /quota/radar` on the worker (bearer auth, strict validation, cap ≤ 8000) running an atomic Redis `EVAL` (reserve-if-within-cap / settle); Radar calls it with a 2 s timeout using the already-present `ARC_HOLDER_QUEUE_URL/TOKEN`. Refused → `RADAR_BUDGET_EXHAUSTED` with zero provider calls. Unreachable/404 (old worker) → local per-process ledger still applies (never unlimited). **Activation requires a worker redeploy (operator approval; not done).** Tests: `test/shared-quota.test.js` (5).

## 10. Unlocks CoinBell fan-out (protected file, proposal only)

`api/unlocks.js` is hash-pinned; it was NOT modified and no baseline was refreshed. Patch: `docs/audits/proposals/unlocks-single-flight.patch` (per-instance single-flight + 5-min memo of successful results). Measured with `unlocks-single-flight-probe.mjs`, 5 concurrent cold requests: **15 CoinBell GETs before → 3 after**. Applying it needs an approved baseline update of `scripts/approved-baseline.cjs`/`test/search-v3-data.test.js`.

## 11. Arc log-span probe

Shell cannot reach the Arc RPC; `scripts/probe-arc-log-range.cjs` runs in CI (annotations) to find the maximum accepted `eth_getLogs` span. Widening `tailRange` stays blocked until that evidence exists (and `scripts/holder-worker.cjs` is pinned).

## 12. Open items

**P1** `api/unlocks.js` request-path fallback fans out 3 CoinBell GETs per uncached request (no single-flight). A tested fix exists conceptually but `test/search-v3-data.test.js` pins that file's hash as "unchanged from production"; changing it would need an approved baseline refresh, which this audit may not do. **Decision needed.**
**P1** Global (cross-instance) Radar credit counter and holder-cursor/backlog metrics need durable storage/Railway access.
**P2** Search 3×6 coverage matrix and ARGUS/ONDO/IO.NET/PLUME/MANTRA samples need provider keys in a controlled environment.
**P2** Browser burn poll (2 min) is UI-side; server `api/supply.js` has no cache layer.

Unsupported / never invented: holder counts for unscanned tokens, unlock volumes without issuer proof, market cap when only FDV exists, Pons curve-phase USD price.
