# ARCY Missing Data Closure — evidence-based P0/P1 plan (2026-10-30)

**Scope:** GitHub Issue #112, Draft PR #113, branch `audit/data-engine-end-to-end-20261030`. **No Production deployment, no Railway config change, no UI/skeleton changes.** Focus on genuine missing/old/unverified data, not visual redesign, marketing or artificially inflating coverage.

## Fresh read-only Railway evidence (30 October 2026, production service, NOT a deployment)

Railway project `arcy-holder-worker`, service `arcy-holder-durable`, one healthy replica, active deployed revision `b1f7319f-5f4a-42aa-965b-52136a5d258a`; the separately listed `arcy-holder-worker` service is offline and has no latest deployment. We did not restart or change either service.

From the latest `deploy` log stream read-only sample: **501** `HOLDER_WORKER_BATCH` events between approximately **12:20–18:14 UTC**. Entries are **attempts, not unique contracts/snapshots**. Across **42 distinct contracts**:

| Batch-result class | Count | Interpretation |
|---|---:|---|
| `HOLDER_PINNED_RECONCILIATION_IN_PROGRESS` | **1,736** | resumable pinned-block reconciliation still incomplete |
| `HOLDER_WORKER_BUDGET_EXHAUSTED` | **730** | slice/yield budget reached |
| `COMPLETE` | **1** | one completed batch result in the sampled period |
| **Total outcomes** | **2,467** | not token coverage / not independent successes |

**ARCY exact contract** `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b`: **59** appearances in this sample; **44** reconciliation-in-progress, **15** budget-yield, **0** COMPLETE events. This does *not* prove no historical COMPLETE exists. Claude's earlier public endpoint observation reported a signed snapshot approximately 19h old and a possibly separate 3.78M-block backlog. Do not conflate a TAIL cursor gap with a different CATCHUP cursor gap; verify exact token/phase/block.

Of **125 provider attempts explicitly attached to failed batch outcomes**, **102** had HTTP 429: `primary` **51/51**, `fallback1` **51/51**, `fallback2` **0/23**. **Selection-biased diagnostic sample**: only failures with `rpcAttempts` metadata, **not** the actual global provider-wide 429 rates. Do not report 102/125 as a general 429 ratio.

### P0: Holder & Whale — unblock verified COMPLETE (first priority)

1. Determine the real phase/cursor and before→after advancement for ARCY plus 10 representative incomplete token jobs by *read-only* job status and Railway logs if possible. Report pinned block, `previousBlock`, `tailCursor`, `catchupCursor`, `balanceCursor`, `addresses.length`, effective width and last COMPLETE block/time **separately**.
2. Explain why the worker handles ~42 contracts repeatedly with only one sampled COMPLETE. Diagnose cooldown pressure, provider selection, repeated `eth_getLogs` scanning, persistent checkpoint saves and 12s per-job / 40s batch budgets. Study `lib/holder-rpc.js`, `holder-budget.js`, `holder-candidates.js`, `holder-refresh.js`, `holder-storage.js`, `holder-log-range.js`, `scripts/holder-worker.cjs`. Prioritize *less wasted work per existing budget*; do not raise RPC/spend limits, create services or widen ranges without chain proof.
3. Ensure an interrupted/cooldown job resumes exactly from persisted cursor, does not lose progress, never publishes unbalanced supply as COMPLETE, never silently resets from CATCHUP to DISCOVER, and is not starved by recurrent retries. Use deterministic RPC 429/fallback/cooldown tests and a bounded simulation of at least **3 sequential batches**.
4. Show a measurable rise in COMPLETE snapshots and decrease in repeated budget-yield attempts on a controlled sample *only if actually observed*. No fake holder concentration. Distinguish fresh count vs signed snapshot age; retain full provenance `asOf`.
5. Avoid Production deployments; worker changes must stay in Draft PR and require explicit operator release after green CI.

### P1: Search missing fields — exact root causes, not blanket “93%”

Source: the audit reported `186/200` data points but also described “10 tokens × 3 networks × 6 fields” (which implies 180 token-card slots, **not 200**). Require machine-readable **per-card/per-field** denominator definition and a matrix with the contract address, network, card, exact field key, `DATA_FOUND / NOT_VERIFIED / SOURCE_API_FAILED`, reasonCode, source, evidence block/age. Do not advertise “site-wide 93%” until denominator explained and weighted across the real site.

Prioritized gaps found in the audit:
- **Robinhood Chain unknown-contract Mechanics:** `tradingTaxes`, `mintCapability`, `ownerAdmin`, `contractArchitecture` from `search/server/lib/robinhood-adapter.js`. Determine whether GoPlus licensing/availability, owner() getter, EIP-1967/EIP-1167, Sourcify/source verified code, custom ABI/admin mechanism or RPC timeout explains each missing value. Lack of getter is **not** evidence of no owner or zero taxes. Avoid unsupported `0%`, `renounced`, `cannot mint` claims.
- **ASTOCK / Robinhood holder ranking:** check issuer registry exact contract, `robinhood-holder-count`, `robinhood-holder-rank` Blockscout completeness, `goplus-evidence`, pinned-block balance reconciliation. Missing holder census cannot be inferred from top-wallet sample or market cap. Distinguish count from whale-concentration evidence.
- **Arc circulating supply:** current `arc-adapter.supply` explicitly says no permitted exact-contract circulating source; it must remain `NOT VERIFIED` until verifiable positive supply appears. Do not derive circulating as total-minus-burn or claim locked/unlocked without schedule.
- **Radar Arc 7–8/10:** investigate real identity/volume/liquidity requirements and provider candidate windows; do not weaken gates solely to achieve ten.

### P1: Real refresh and operational continuity

- Confirm worker successfully generates new signed COMPLETE snapshots, not just live `BUILDING` traffic. Compare oldest/freshest snapshot dates and queue backlog.
- Verify Pulse edition #5 `updated` in live overlay vs `quiet_week` in archive is honestly distinguished by API consumers; handle inconsistent status data-only, preserving signed archives.
- Unlocks CoinBell single-flight patch remains **proposal only**; do not edit hash-pinned `api/unlocks.js` without explicit scope approval and protected-baseline review.
- Global Redis Radar quota endpoint is **not deployed**. Fix potential cap overshoot before activation: reserve max credible credits *before* provider calls; refund unused via atomic bounded settle; concurrency/instance and failed-call tests. The existing `reserve 4` then unrestricted `settle(actual-4)` can exceed monthly cap; never claim an enforceable 7,500 global limit based on memory fallback.

## Acceptance criteria for closing missing-data issue

1. Evidence table for **all 3 networks × 6 cards** with field-level gaps, verifiable sources and exact reasons; separate measured presence, cross-verification and freshness percentages.
2. At least one reproducible **before/after** correction of actual missing/old data with verified contract+block and tests, without inventing values.
3. Progress/429/cooldown/snapshot reports for Holder using live read-only evidence; no time-slice or provider limit increase.
4. Current-head `npm test` + GitHub CI green, safety comparison shows the **10 UI skeleton files byte identical** to main.
5. Report `PRODUCTION: NOT DEPLOYED / MERGE: NOT DONE`. All work confined to Draft PR #113. If a data source is truly absent, retain explicit NOT VERIFIED with reason rather than “fill to 100%”.
