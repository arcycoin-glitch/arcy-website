# Radar near-match discovery — issue #279 (2026-11-18)

Branch `claude/radar-near-match`, Draft PR #288, base main `4f6d5e6` (V4 #287 merged, Production flag ON).

## Root cause of the empty Ethereum Radar (Production, snapshot 13:28 UTC)
1. **Candidate loss (bug).** V4 only received the contracts that the legacy V3 response listed: 10 ranked rows plus 2 diversity-capped rows. All 12 are established, commodity or wrapped assets, so all 12 were correctly removed. V3 dropped every other inspected contract with `list=false`: pool-level floors, the 30-shortlist, the 20/30 finalists and the top-10 cap. On Ethereum that was 33 of the 45 inspected contracts in that window, so they never reached V4.
2. **Circular input (bug).** With `RADAR_V4_OPPORTUNITY_ENABLED=true`, the snapshot builder's "legacy" read of `/api/search?action=radar` receives the V4-served list. Every future run would therefore be built from the previous snapshot.
3. **Narrow universe, not too strict thresholds.** Ethereum's provider window is dominated by large assets. Lowering scores would not fix this.
4. **Coverage counters.** The API reported `discovery.uniqueCandidates` (45) next to `coverage.ranked` (0). Both values were correct, but the 45 → 12 loss between them was not explained anywhere. The served `opportunity.funnel` now accounts for every stage.
5. **Side effect.** The Final release smoke (`search-coverage-matrix`, `NO_RADAR_SAMPLE`) fails against Production since the empty Ethereum V4 section went live. The last green run was main 13:26 UTC, before the first Production snapshot.

## Fixes
- V3 (additive, ranking unchanged): `nearMiss[]` lists non-critically dropped contracts with stage, gates, values and verification status. `excluded[]` INELIGIBLE_AFTER_VERIFICATION rows carry `verification`.
- API: `source=legacy-v3` returns the legacy window even when V4 is ON, under the same site-origin and publication policy. The builder uses it and refuses V4-served input (`CIRCULAR_V4_INPUT_REFUSED`); that section is carried forward instead.
- Builder-side cross-check: one batched DEX Screener call per network (≤30 contracts) through the same verifier V3 uses, for contracts V3 dropped before its own cross-check. Disagreement → CONFLICT.
- `intel/near-match.js` classes, applied under V4's hard gates (category, critical risk, persistent risk holds, contradictions):
  - **QUALIFIED:** passed every V3 ranking gate (ranked, diversity cap, or top-10 / capacity cut with cross-check).
  - **NEAR_MATCH:** verified stage; only non-critical numeric misses (volume, liquidity, trade count) at ≥50 % of the threshold; price and liquidity evidence; pool ≥24 h.
  - **MONITOR_ONLY:** insufficient evidence or farther from thresholds. At most 3 per section, always last, with missing proofs named.
  - **HARD / CONFLICT / NOT_SHOWN:** never displayed.
- A row whose ticker is shared by several contracts in the same section never fills a near-match or monitor slot.
- Display order: QUALIFIED (V4 order unchanged) → NEAR_MATCH by distance, evidence, liquidity, activity → MONITOR_ONLY. The Info prefix states the class and either the missed threshold ("YAKIN EŞLEŞME — … likidite eşiğin %73’i") or the missing evidence ("SADECE İZLEME — onaylı veya düşük riskli değildir, eksik: …"). Passing the available checks is never described as "safe".
- Snapshot: `discoveryClass` and compact `nearMatch` per row; validation of class order and the monitor cap; funnel counters; served `opportunity.funnel` and `shownByClass`.

## Measured — CI run 44325506049, the same real V3 sections, before vs after intake
Sections were built in CI with the keyless tier (allowed outside Vercel), measurement only, nothing published. Pons was rate-limited by the keyless provider in this run, so it was not measured.

| Network | V3 inspected | V4 candidates before → after | Shown before → after | After: shown by class | Main reasons not shown |
|---|---|---|---|---|---|
| Ethereum | 46 | 11 → 36 | **0 → 5** | NEAR_MATCH 2 (BAWSAQ liquidity 73 %, GTA6 69 %), MONITOR_ONLY 3 | 12 non-early categories, 8 duplicate tickers, 1 source conflict, 9 over the monitor cap |
| Robinhood | 48 | 11 → 33 | 8 → **10** | QUALIFIED 10 (incl. 4 that were cut only by the top-10 cap) | 3 tokenized equities, 1 persistent risk hold |
| Arc | 36 | 5 → 31 | 4 → 7 | QUALIFIED 4, MONITOR_ONLY 3 | AF persistent hold, 6 duplicate tickers, 1 conflict |

- Critical exclusions unchanged: the AF hold survives on Arc and Robinhood; source conflicts are detected and hidden.
- Cost (after intake): +1 builder DEX Screener call per network, Blockscout 13 calls, RPC Arc 65 / Ethereum 62 / Robinhood 248; engine 47 s (before intake: 61 s; RPC differs with which contracts get on-chain budget).
- Production API latency (V4 ON, before this change), 12 requests per network from the browser: p50 74–103 ms, p95 194–329 ms. The near-match layer adds no request-time work: classification happens in the out-of-request builder, and serving still makes one cached snapshot read.

## Tests
- `test/radar-near-match.test.js` — 17 tests: the 12 required cases, plus the monitor cap, look-alike tickers, builder cross-check with conflict, the circular-input guard and the `legacy-v3` bypass policy.
- Full `npm test`: 1434/1434 (Node 22 + Redis).

## Not verified / open
- **Research Profiles and LIVE:** no such engines exist on `main` (searched `lib/`, `api/`, `search/server/`, `scripts/`), so nothing was linked. Radar keeps its own provenance.
- **Preview with the flag ON:** not available (no Vercel env access). Near-match rows use the same validated DTO and render path that was browser-verified for V4.
- **Real near-match rows in Production:** require this PR to be deployed (V3 `nearMiss` + `legacy-v3` bypass), then one snapshot run.
- **Until merge:** the 4-hourly runs on `main` still read V4-served input (circular). Ethereum stays at 0 rows and the universe cannot grow.
