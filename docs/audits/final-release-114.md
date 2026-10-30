# PR 114 release validation

Scope: release only; ten protected UI hashes and five report-card schemas plus the separate Unlock calendar are unchanged. No baseline changes. Railway baseline: fb8cac8, live build b1f7319f-5f4a-42aa-965b-52136a5d258a, rollback supported by Railway.

## Engineering review
- Preserve fb8cac8 chunked balance fallback, pruned history cache, quota-aware requeue, checkpoint reserve and bounded growing windows. Worker entry script and Dockerfile remain identical to fb8cac8. Default window remains 1000; hard ceiling 2000. No budget increase.
- Fix release blocker: shared Radar quota previously reset on this production worker (local volume, no Redis). Use an atomic fsync+rename ledger under existing ARC_INDEX_CACHE_DIR, separate from all holder checkpoints. Lock concurrent calls, fail closed on corruption, write failure or lock timeout. Redis remains supported. A process killed while holding the volume lock fails closed until operator recovery; never silently reset accounting. Single volume/single replica deployment required.
- Preserve the longest concurrent Retry-After cooldown, never shorten it.
- Fix false cross verification: comparable values must have identical explicit pool sets and independent providers; otherwise POOL_SCOPE_MISMATCH remains single source. Additional secondary source remains opt-in, avoiding extra paid calls.
- Holder reports resolve immutable pinned block timestamps separately from completion time. Standalone publication endpoint performs no RPC and explicitly reports unknown block age when not cached. No guessed ages.
- Coverage probe now retains raw rows, counts absent expected fields, covers all five schema cards plus separate global Unlock calendar, reports Pons separately as a Robinhood subset, fails nonzero on unavailable samples. Missing evidence is never fabricated to improve percentages.

## Credit evidence
Official CoinGecko documentation checked 2026-10-30: https://support.coingecko.com/articles/1864417806-how-does-coingecko-api-count-the-api-usage-credit states each successful request costs one monthly credit, while unsuccessful requests also count against the minute rate. The code conservatively reserves four credits before a Demo refresh, including failed requests, and refunds unused calls only. The ledger covers this engine, not unrelated uses of the same provider key or earlier consumption before adoption.

## Release gates
Final commit must pass regression CI, actual Docker build/startup/restart smoke and real Redis Lua tests. Source probes are inspected individually: optional steps are not converted into a live-data guarantee. Local environment has no Docker or redis-server; those gates run in GitHub CI. Production acceptance includes version readback, unchanged /data mount, Radar indexer disabled, worker startup and consecutive progress logs, signed publication preservation and API smoke responses. Rollback uses b1f7319f on the unchanged volume if a critical regression occurs.

## Known limits
Historical holder backlog is asynchronous; a successful deploy does not make every token current. Unknown LP custody, owner/mint/tax controls remain unknown without proof. Cross-source Search is disabled by default; no new source permissions or budgets are enabled. Pulse immutable weekly archive behavior and the separate proposed Unlock fallback cache are outside this release. Public-site access may be restricted from the operator environment; report actual probe failures rather than treating a READY deployment as API proof.
