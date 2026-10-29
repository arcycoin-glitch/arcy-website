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
