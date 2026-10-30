# Persistent holder worker

Host: a separate Railway Hobby service ($5 minimum monthly usage; additional resource usage may cost more). Vercel remains the web/API host. No public worker domain or HTTP port is needed.

Deployment settings, after approval: repository root, Dockerfile path `Dockerfile.holder-worker`, one replica, restart policy ALWAYS, application sleeping disabled, termination grace period at least 45 seconds. The worker command is `npm run worker:holders`. Supply existing private Redis variables through host secret settings: ARC_INDEX_REDIS_URL/ARC_INDEX_REDIS_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Never commit credentials. Startup refuses ephemeral local storage. The Docker image copies only worker application files, excluding audit artifacts, website files and environment files.

Search reads the existing non-expiring COMPLETE Redis document and queues the exact chain-5042 contract. It never invokes holder discovery/reconciliation. The existing authenticated holderrefresh route only inspects due queue work; no Vercel holder cron remains. Start the external worker before releasing the snapshot-only API.

The worker polls the durable sorted-set queue, takes existing token-fenced leases, and runs bounded checkpointed discovery/Transfer-tail/reconciliation slices. Incomplete work is rescheduled after five seconds; provider failures back off at least one minute. COMPLETE snapshots refresh after ten minutes. An idle worker polls every thirty seconds. Existing queue capacity remains 1,000 contracts and per-contract candidate capacity 100,000; rejected queue additions are reported, never treated as verified data.

Snapshots publish atomically only after every candidate balance reconciles to total supply at one block with a matching canonical anchor. The existing checkpoint, complete index, chain/contract, block, timestamp and evidence metadata remain in the same Redis document. Partial/failing refreshes retain COMPLETE evidence. Redis leases fence overlapping/restarted processes. SIGINT/SIGTERM stop polling and let the current bounded batch finish; interrupted work resumes from its durable cursor. `node scripts/holder-worker.cjs --once` is available for bounded acceptance runs, still requiring Redis. Optional exact contract arguments enqueue work before processing.

The worker has no web request deadline, but each batch retains the existing 40-second budget. Redis/provider outages produce sanitized status logs, never URLs, credentials or raw errors. Cost and completion time depend on queue size, Redis operations, RPC availability, indexer pagination and token holder count; first-ever indexing is asynchronous and has no guaranteed completion deadline.

## Image contents and startup smoke test (issue #96 / PR #94)

Railway builds `Dockerfile.holder-worker` with the **repository root** as context. The image contains only
`package.json`, `lib/`, `scripts/holder-worker.cjs` and `scripts/export-holder-snapshots.cjs` — **never `search/`, `api/` or `test/`**.
Rules that keep it bootable:

- No file in `lib/` may statically `require` anything outside `lib/` (`lib/radar-support.js` holds the Radar copies of the chain
  config / `abiString`; `test/radar-support-parity.test.js` fails if `search/server/lib` drifts).
- Radar is optional: `lib/holder-worker-http.js` loads it lazily inside try/catch and starts the indexer loop **only** when
  `ARC_RADAR_INDEXER_ENABLED=true`. A Radar load failure can never stop the Holder.
- `test/docker-image-closure.test.js` resolves every relative require reachable from the entry scripts against the Dockerfile's COPY
  list, and boots the Holder HTTP server from a temp directory that contains only those files.
- `node scripts/docker-smoke.cjs [--require-docker]` builds the exact Railway image and starts the container (Radar off); CI runs it in
  `.github/workflows/holder-worker-docker-smoke.yml`. Exit 77 = no Docker daemon (skipped locally).

Rollback is unchanged: redeploy the previous Railway deployment; no data volume is touched by this change.

## Provider health semantics (Holder RPC)

A well-formed JSON-RPC error *answer* (HTTP 200) is a call-level outcome, not a provider outage: it no longer starts a cooldown, halves
concurrency or doubles pacing. Only HTTP/transport/timeout/malformed/rate-limit faults quarantine a provider. A provider that keeps
answering errors for calls another provider serves is deprioritised (+250 ms per consecutive miss, max 20) and rehabilitated on success.
`/holder/rpc-diagnostics` now also reports `historical_getBalance_10k_blocks_back` and `batch_of_5` per provider.

## Completion behaviour and tunables (issue #96 follow-up)

- **Log window recovery.** `holder-log-range.read()` doubles the next window after a fully fetched, validated window with fewer than
  250 logs, up to `ARC_HOLDER_LOG_WINDOW_MAX` (default 1000, hard ceiling 2000). It shrinks only on genuine range/result-cap
  errors and never grows after any error in the same read; 429, pruned history, timeouts and validation failures throw without
  changing the persisted width. A checkpoint stuck at `width=1` therefore recovers 1→2→4→…→1000 in ten sparse windows while the cursor
  stays strictly contiguous.
- **Pruned history (JSON-RPC 4444 etc.).** Remembered per provider + method + block (`ARC_HOLDER_HISTORY_GAP_TTL_MS`, default 10 min,
  30 s–1 h); three consecutive pruned answers mark the provider history-incapable for that method until expiry, then one request
  re-probes. Latest-state reads, other methods and other providers are unaffected; if no provider is capable the cache is ignored.
- **Quota (429).** Retry-After/cooldown is kept across slices (providers are process-wide). A slice that would only wait now yields
  with `eligibleInMs`; the scheduler requeues the token for that moment (+0–20 % stagger) instead of burning the 12 s slice.
- **Budgets** (clamped; operator env wins over the worker's arguments): `ARC_HOLDER_INVOCATION_BUDGET_MS` 10 000–120 000 (40 000),
  `ARC_HOLDER_TOKEN_SLICE_MS` 3 000–60 000 (12 000), `ARC_HOLDER_BATCH_LIMIT` 1–20 (5), `ARC_HOLDER_INCOMPLETE_DELAY_MS`
  1 000–300 000 (5 000), `ARC_HOLDER_CHECKPOINT_RESERVE_MS` 500–10 000 (2 000), `ARC_HOLDER_MAX_REQUEUE_DELAY_MS`,
  `ARC_HOLDER_RPC_INTERVAL_MS` 50–5 000 (500), `ARC_HOLDER_FALLBACK_CHUNK` 1–50 (5).
- **Balance fallback** reads individual `balanceOf` calls in chunks of 5, each only if it fits in the slice minus the checkpoint
  reserve, and checkpoints the contiguous prefix; budget cancellation never starts the long sequence.
- `/holder/rpc-diagnostics` health rows carry sanitized per-provider `calls`, `http429`, `answeredErrors`, `historyUnavailable`, `historyGaps`.

## Throughput bottleneck: pacing ratchet and fair scheduling (PR #94 follow-up)

**Root cause (reproduced with `test/helpers/holder-sim.cjs`, virtual clock, 2 % random 429s over 40 worker runs):**
every provider fault doubled that provider's pacing interval (up to 8 s) and cut concurrency to 1, but the only way back was
20 consecutive *successes* — which an 8 s interval makes almost impossible inside a 12 s slice. Intervals stayed at 8 s / 6.5 s, slices
shrank to 1–2 requests, `pacing delay >= remaining` raised `HOLDER_WORKER_BUDGET_EXHAUSTED`, and cursors crawled
(measured: 676 requests, 91 budget yields + 33 cooldown yields, progress 111k → 9k blocks per run). Strict FIFO made it worse for tokens
close to COMPLETE: a token needing two more slices waited as long as one needing fifty.

**Smallest safe fix (no higher RPC limits or cost):**
1. Penalties now also decay with quiet time: every `ARC_HOLDER_RPC_RELAX_MS` (default 15 s) without a fault halves the interval and
   restores concurrency, never below the configured base interval. Steady-state rate and cooldown/Retry-After handling are unchanged.
   Same scenario after the fix: 4 271 requests, 3 budget yields, ~100k blocks per run, intervals back at base.
2. Scheduler: pool of up to 50 due tokens; 40 % of each run's slots (`ARC_HOLDER_FIFO_SHARE_PCT`) go to the longest-waiting tokens
   (aging; bounded idle time), the rest to the least remaining work (blocks/ranges or balance batches, taken from the checkpoint
   builder's own saves; one checkpoint read per token per process start).

**Diagnostics** (`GET /holder/rpc-diagnostics`, Bearer token; add `?probe=0` to skip live provider probes and spend no RPC):
`worker.rpc` (metrics: requests, successful, http429, errors, fallbacks, backoffMs, pacingMs, cooldownWaitMs; per-provider interval,
baseInterval, limit, cooldownMs, calls, http429, historyUnavailable), `worker.limits`, `worker.scheduler.totals` (slices, complete,
yielded, cooldownYields, starvation/oldest/smallest picks) and `worker.tokens[]` (phase, cursor, target, remaining blocks/balances/calls,
width, advancedTotal, slices, yields, lastState/lastReason/lastAdvanced/lastSliceMs, idleMs). Counters are in-process (reset on restart);
durable truth remains the signed checkpoints.
