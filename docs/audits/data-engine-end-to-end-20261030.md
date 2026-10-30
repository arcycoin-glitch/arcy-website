# ARCY data-engine end-to-end audit — 2026-10-30

Branch `audit/data-engine-end-to-end-20261030` · Draft PR #113 · base `main` a16c9ec · Issue #112.
**PRODUCTION: NOT DEPLOYED / MERGE: NOT DONE.** Data-layer files, tests, CI probes and this document only. The 10 protected skeleton files are byte-identical (`test/data-engine-ui-lock.test.js` green, untouched).

## 1. What was and was not measurable

| Area | How inspected | Limit |
|---|---|---|
| Code, tests, caches, budgets | Read every data module named in Issue #112; full suite `npm test` | — |
| Radar V3 / Pons V1+V2 | GitHub CI live-provider + chain probes (real GeckoTerminal, DEX Screener, Robinhood RPC) | Public RPC rate-limits CI (429); keyless provider tier |
| Railway holder worker, Vercel Production state, stored snapshots/cursors | **Not accessible** from this session (no Railway/Production credentials, by rule) | Holder cursor/backlog and published snapshot ages are **NOT MEASURED**. The "~35 records / cursor >1M blocks behind" claim is neither confirmed nor refuted |
| Search 3 networks × 5 report cards coverage matrix | Public API, no keys needed | **Measured** on production (29 tokens, 580 slots) — see §8.2; accuracy beyond presence not measurable without ground truth |
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
| `/api/holders` default path | **Defect fixed**: served a 28-day-old committed snapshot (ARCY 41 holders) in front of the newer remote publication (37). Now `publication.freshest()` returns the highest-block valid COMPLETE one (remote memoised 60 s, successes only). Tests: `test/holder-freshest.test.js`. |
| Unlocks | Signed worker edition present, 6 h cadence, back-off fix for failing source (was ~30 s retry loop). |
| Pulse | Cron editions 3–5 signed Monday 06:0x UTC; live overlay differs from archive status for #5 (observation, protected file). |
| Burn / Supply | Live on-chain reads OK. |

### 8.1 Holder worker: checkpoint separation, root cause of the stale COMPLETE (live evidence, 2026-10-30 ~18:30 UTC)

Live measurements (public `/api/holders?action=status|published`, Arc public RPC `eth_blockNumber`, ~1.97 blocks/s):

| Cursor / pointer | Block | Meaning |
|---|---|---|
| Published COMPLETE (ARCY) | **24,899,894** (`0x17bf136`) | pinned block of the snapshot users see; `snapshotCreatedAt` (checkpoint start) **2026-10-08 12:21**; `completedAt` **2026-10-29 22:09:36** |
| Live TAIL pin (job `progress.block`) | **28,546,790** | head at TAIL start (~20 h before the measurement; ≈22:10 UTC 10-29, i.e. right after the COMPLETE) |
| Chain head | **28,689,194** | measured live |
| Gap A: COMPLETE block → TAIL pin | **3,646,896** blocks | being scanned by TAIL (`previousBlock+1 → pin`); the per-job `tailCursor` is **not exposed** by the public status |
| Gap B: TAIL pin → head | **142,298** blocks (≈20 h) | covered later by CATCHUP |
| Total COMPLETE block → head | **3,789,300** blocks (≈22.3 days) | the "3.78 M" figure = A + B; A and B are different cursors |

**Why the signed COMPLETE is old:** (1) that snapshot was *pinned* on 10-08 and only finalised on 10-29 (21 days in progress; Railway logs are needed to say why — the `HOLDER_PINNED_RECONCILIATION_IN_PROGRESS` / budget-yield pattern in the operator's log sample is consistent with it); (2) the next refresh must scan 3.65 M blocks with a fixed 1,000-block `eth_getLogs` span = **3,647 RPC calls**, ARCY gets one ≤12 s slice per visit, and the operator's log sample shows ARCY visited **59 times in ≈5.9 h (one visit per ≈6 min; my status polling saw `updatedAt` 18:23:24 → 18:29:13)** among 42 contracts, with 100 % of sampled failed primary/fallback1 attempts being HTTP 429. ≈15–25 ranges per slice ⇒ ≈15–25 k blocks/visit ⇒ ≈150–240 visits ≈ 15–24 h: consistent with TAIL still running 20 h later. This arithmetic is an **estimate**; the real `tailCursor` could only be read from Redis/Railway.

**Chain evidence for the fix:** Arc RPC accepts 1000/2000/5000-block spans, rejects 10,000 (CI probe + my browser probe); it rate-limits after ≈5 rapid calls, so *call count*, not span, is the binding cost; ARCY returned 0 Transfer logs in the sampled 13 k + 25 k blocks after the old COMPLETE. **Change (commit in this PR, needs worker redeploy to take effect):** `lib/holder-log-range.js` grows the next span 1000→2000→4000→5000 only after a *sparse* range (<200 logs) without halving, halves on RPC range-limit / ≥1000 logs, and never regrows within the same call; checkpoint validators accept spans ≤5000. For the live ARCY span: **3,647 → ≤735 `eth_getLogs` calls (>4.9× fewer)** (asserted in `test/holder-infrastructure.test.js`). A 4-batch simulation with an injected 429 on every 3rd `eth_getLogs` shows the TAIL cursor strictly advancing (1,003,001 → 1,012,001 → 1,022,001 → 1,032,001), no reset to DISCOVER and no COMPLETE before reconciliation. **Not measured:** an actual before/after on Railway (no deployment allowed).

**Accuracy finding (not fixed, needs worker change):** the published `snapshot.ageSeconds`/`freshness:LAST_VERIFIED` is computed from `completedAt` (20 h) while the data is pinned **3.79 M blocks (≈22 days) behind head**. Consumers must use `block`, not `ageSeconds`, to judge data age. A `blockTime` field recorded at COMPLETE would fix it; deliberately not added here (changes the signed snapshot schema).

### 8.2 Search coverage matrix (re-measured; the earlier "186/200, 93 %" is WITHDRAWN)

The earlier figure had no reproducible numerator/denominator ("10 tokens × 3 networks × 6 fields" is not 200) and its raw rows were not kept. Re-measurement on production, 2026-10-30 ~18:35 UTC: radar top tokens per chain (Arc 9, Ethereum 10, Robinhood 10 = **29 tokens**), `action=report`, **5 cards × 4 fields = 20 field slots per token ⇒ denominator 580** (the sixth "card", Token Unlocks, is a separate endpoint and not in these reports). *filled* = value present and status ≠ NOT_VERIFIED; *strong* = ON_CHAIN / ON_CHAIN_DERIVED / SIGNED_ONCHAIN_SNAPSHOT / MARKET_API_VERIFIED / VERIFIED_SOURCE / VERIFIED_SOURCE_AND_STATE / SOURCE_REPORTED_RPC_RECONCILED (single-source `SOURCE_REPORTED`/`GETTER_REPORTED` count as filled but not strong).

| Chain (tokens) | Slots | Filled | Strong | Supply | Holders | Liquidity | Activity | Mechanics |
|---|---|---|---|---|---|---|---|---|
| Arc (9) | 180 | **149 (82.8 %)** | 138 (76.7 %) | 36/36 · 36 strong | 20/36 · 20 | 34/36 · 27 | 36/36 · 36 | 23/36 · 19 |
| Ethereum (10) | 200 | **179 (89.5 %)** | 88 (44.0 %) | 40/40 · 40 | 40/40 · 30 | 38/40 · **0** | 40/40 · **1** | 21/40 · 17 |
| Robinhood (10) | 200 | **177 (88.5 %)** | 88 (44.0 %) | 40/40 · 40 | 40/40 · 30 | 37/40 · **0** | 40/40 · **0** | 20/40 · 18 |
| **All (29)** | **580** | **505 (87.1 %)** | **314 (54.1 %)** | | | | | |

(Cells: filled/slots · strong.) So **presence is 87 %, but verification-grade is 54 %**: Ethereum/Robinhood liquidity and activity are single-source (`SOURCE_REPORTED`), Arc holders are missing for 4 of 9 tokens (no worker snapshot; `NOT_VERIFIED`, not guessed), and Mechanics is the weakest card (≈50 % filled on every chain: tradingTaxes/mintCapability/ownerAdmin NOT_VERIFIED for unfamiliar contracts). Reproducible with `node scripts/search-coverage-matrix.cjs` (also added to the CI probe workflow as an annotation). Accuracy beyond presence (are the numbers right?) is only checked where two sources exist (Radar liquidity cross-check, §4); no ground-truth audit of Search fields was possible.

### 8.3 Pulse #5: `live=updated` vs `archive=quiet_week` (explained, consistent by design, one real defect class)

Live evidence: archive #5 `status:quiet_week`, generated **2026-10-26 06:06 UTC** by trigger `cron` (3 placeholder cards). The live `/api/pulse` returns #5 `status:updated`, `trigger:transient`, with two cards `verifiedCurrentWeek:true` whose `publishedAt` is **2026-10-29 21:34 UTC** (Arc blog posts published *after* the Monday signing) and one older card `verifiedCurrentWeek:false`. Code path (`api/pulse.js`): if the signed edition is for the current cycle **and** `quiet_week`, the handler runs a transient source check (cached 15 min if updated, 3 min otherwise) and returns it instead. So there is no contradiction in the data: the archive was correct at signing time; the live view shows later-published items.
**Real issues:** (a) the signed archive for week 44 will remain `quiet_week` forever although two verified items now exist (immutable editions, one signing per week) — the archive under-reports the week; (b) the live response's `audit.lastSuccessful` reports the *transient* run, not the signed edition, so a consumer cannot tell that no signed edition contains these items. Both need a change in the protected `api/pulse.js` / cron design (e.g. a second closing signature on Sunday, or labelling `audit.signed` separately) — proposal only, nothing changed. Archive/publication consistency otherwise verified: editions 3–5 retrievable (`?action=edition&number=N`), numbers monotonic, `nextScheduledAt` 2026-11-02 06:00 UTC.

## 9. Shared Radar quota — cap-safety proof (revised)

**Defect found in my first version (also flagged in the operator note):** `reserve 4` followed by an uncapped `settle(actual−4)` could overshoot the monthly cap. **Fixed:**
1. The counter can only grow through `reserve`, which the Redis Lua script refuses atomically when `current + n > cap`. `settle` now accepts **only negative values (refunds)** — the server rejects positive settle, so no code path can add past the cap.
2. Worst case per metered Demo `load()` is proven structurally to be **4** provider calls (3 channel pages × 1 page + 1 `tokens/multi`; no retries in `lib/radar-v2/http.js`; a 429 starts a cooldown). 4 is therefore reserved **before** any provider call; unused credits are refunded (`used < 4`). A failed cycle keeps the reservation (conservative).
3. **Fail closed:** when the worker is configured but unreachable / Redis down / non-2xx → `RADAR_QUOTA_UNVERIFIABLE`, **zero provider calls**, stale-if-error applies. Only a 404 (worker without the endpoint) or no worker configured falls back to the per-process ledger — in that mode the bound is still `instances × cap` (not global); it is reported as `sharedQuota:"local"` in the response and must not be described as a global limit.
4. Client cap is clamped to the 8,000 hard ceiling (client and server).

**Evidence** (`test/shared-quota-redis.test.js` runs the real Lua on a real `redis-server`, through Radar client → worker HTTP route → quota-store → Upstash-REST shim; 12 concurrent instances × 40 cycles, cap 100, random refunds, simulated provider failures, a Redis outage window): maximum counter value returned by any script call ≤ cap, final counter ≤ cap, counter == net of acknowledged reserves/refunds, and the outage window produced fail-closed results that changed nothing. Skipped automatically only where `redis-server` is not installed. `test/shared-quota.test.js` (6) covers validation, auth, refused/fail-closed/local paths.

**Not proven / not done:** the endpoint is **not deployed** (needs a worker redeploy = operator action); real Upstash behaviour (latency, TLS) was not exercised; the 4-call bound assumes each HTTP call costs 1 credit.

## 10. Unlocks CoinBell fan-out (protected file, proposal only)

`api/unlocks.js` is hash-pinned and was **not modified**; no baseline was refreshed. Patch v2: `docs/audits/proposals/unlocks-single-flight.patch` — concurrent cold requests on one warm instance share one set of 3 GETs; the result is reused for 5 min **only when all three sources answered** (degraded sets are never kept, so retry behaviour is unchanged); callers get independent clones. Proof: `node docs/audits/proposals/unlocks-single-flight-proof.cjs` runs the unmodified file and the patched copy against identical mocked sources and asserts **identical responses and headers** (only wall-clock ISO timestamps normalised):

| Scenario | Responses identical | CoinBell GETs before → after |
|---|---|---|
| all up, 3 sequential | 3/3 | 9 → 3 |
| all up, 5 concurrent cold | 5/5 | 15 → 3 |
| one source down, 3 sequential | 3/3 | 9 → 9 (still retries) |
| all down, 3 sequential | 3/3 | 9 → 9 |

Applying it needs an explicit, reviewed baseline update of `scripts/approved-baseline.cjs` / `test/search-v3-data.test.js` — not done. The live path is a fallback only; the signed worker edition (6 h) normally answers first.

## 11. Arc log-span probe

Shell cannot reach the Arc RPC; `scripts/probe-arc-log-range.cjs` runs in CI (annotations) to find the maximum accepted `eth_getLogs` span. **CI result (commit b22b8e1, Arc head 28,683,493):** span 1000/2000/5000 accepted; **10000 rejected ("requested range too large")** → true maximum is between 5,000 and 9,999. ARCY had 0 Transfer logs in the last 5,000 blocks, so log density is not the limiting factor. The current ≤1000 cap is conservative; a safe widening to ~5,000 is technically possible but is not applied. Widening `tailRange` stays blocked until that evidence exists (and `scripts/holder-worker.cjs` is pinned).

## 12. Open items

**P0** Holder: widened-span change only helps after an operator-approved worker redeploy; real `tailCursor`/Redis/Railway log access is needed to confirm the estimate in §8.1. 42 contracts share one 40 s batch; primary/fallback1 RPC return 429 in the sampled failures — fewer calls (this PR) is the only lever used; no limit/spend was raised.
**P1** Snapshot data age is understated (`ageSeconds` from `completedAt`, data pinned 22 days back) — needs a `blockTime` in the signed snapshot (worker change).
**P1** Pulse: signed archive can under-report a week that later has verified items; live `audit.lastSuccessful` shows the transient run (protected `api/pulse.js`; proposal in §8.3).
**P1** `api/unlocks.js` single-flight: patch + equivalence proof ready (§10); needs an approved baseline update.
**P1** Radar shared quota endpoint not deployed (worker redeploy); until then the per-process ledger is the only bound (`instances × cap`).
**P1** Search: verification-grade is 54 % (presence 87 %); Ethereum/Robinhood liquidity+activity single-source; Mechanics ≈50 % on every chain; Arc holders missing for 4/9 tokens.
**P2** ARGUS/ONDO/IO.NET/PLUME/MANTRA exact contracts not located. **P2** `api/supply.js` has no server cache layer.

Unsupported / never invented: holder counts for unscanned tokens, unlock volumes without issuer proof, market cap when only FDV exists, Pons curve-phase USD price.
