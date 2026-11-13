# Risk Engine V4 — shadow-mode acceptance

The Risk Engine stays invisible to public Search reports until **every** gate below is met and recorded here with evidence. An AI self-review does not count as the independent security review.

## Flags (all default OFF)

| Flag | Where | Effect |
|---|---|---|
| `ARC_AUTONOMY_RISK_WORKER_ENABLED=1` | Railway worker | runs reviewed producers in the background (`lib/risk-engine/worker.js`) |
| `ARC_AUTONOMY_RISK_ENGINE_ENABLED=1` | Search API | enqueues the searched token and reads its latest snapshot (≤ 300 ms, no producer, no RPC) |
| `ARC_AUTONOMY_RISK_PUBLIC_ENABLED=1` | Search API | attaches `riskFindings` (requires the engine flag) |

Prerequisite: the worker and the Search API must use the **same** risk store. The holder worker runs with `ARC_HOLDER_STORAGE=local` on the `/data` volume. Unless it also has `ARC_INDEX_REDIS_URL`/`TOKEN` (or the Upstash pair) configured, risk snapshots stay on that volume and Search cannot read them.

`status.worker.risk.storeMode` must read `redis` before the engine flag is enabled.

Enabling order: worker → engine (shadow) → public. Each step can be reverted by unsetting its flag; nothing else changes.

## Gates

| # | Gate | How it is measured | Threshold | Status |
|---|---|---|---|---|
| 1 | Flag OFF: no producer runs and no extra RPC | `test/risk-authority-producer.test.js` (OFF ⇒ zero requests), `test/risk-worker.test.js` (worker OFF ⇒ no store, no fetch) | zero calls | **met in CI** |
| 2 | Engine ON: Search response schema unchanged | probe `risk-search-path-*` (top-level and card keys identical to flag OFF) and unit test (only `riskFindings` may ever be written, only behind the public flag) | identical keys; no `riskFindings` | **met in CI probe** (AAVE, ARCY, TSLA) |
| 3 | No user-facing slowdown | Request path is enqueue + snapshot read in parallel, bounded by `LIMITS.requestPathMs = 300`; probe counts producer RPC in the request path | 0 producer calls; added time ≤ 300 ms | **met in CI** (0 producer calls); production p95 added latency not yet measured |
| 4 | No invented safe / negative verdicts | Gate: only `low-pool-liquidity` may be NOT_CONFIRMED (measured pool fact); the probe fails on any other NOT_CONFIRMED | 0 | **met** (live probe: 0 NOT_CONFIRMED) |
| 5 | No confirmation from unreviewed routes | Reviewed-code registry + probe hard failure on any authority confirmation without the same registry review id on both operators | 0 | **met** (live probe) |
| 6 | Same-block independent operator agreement | Every verdict needs `VERIFIED_ONCHAIN`: ≥ 2 registered operators, one block hash, identical value and execution identity | 100% of verdicts | **met** (probe hard check) |
| 7 | Recovery after 429 / 503 / restart | Unit tests (watchdog cooldown, backoff, restart keeps the durable schedule); CI probe restarts the worker and checks that no job re-runs early | pass | **met in CI**; production observation pending |
| 8 | STALE and UNKNOWN handling | Snapshots keep full records; readers re-evaluate with the current clock (`present`), so old evidence becomes STALE; every UNKNOWN carries an evidence-gap code | pass | **met in tests** |
| 9 | Ledger integrity and restart durability | Evidence Ledger atomic writes; store re-open after restart returns the snapshot (CI probe `risk-worker.durable`) | pass | **met in CI** (local volume); Railway `/data` + Redis not yet observed |
| 10 | Bounded worker memory, CPU and RPC | 1 job per tick, ≥ 90 s between ticks, 150 ms between calls per operator, per-network budget 2,400 calls/h, producers' own call caps (authority 34, pool 96, concentration 60 per operator) | within caps for 7 days | **not yet observed in production** |
| 11 | Shadow period on production data | Worker ON, engine ON, public OFF for ≥ 7 days; daily review of `status.worker.risk` (UNKNOWN causes, CONFLICTING, failed jobs) | no false confirmation; failed-job rate < 5% | **not started** |
| 12 | Independent qualified security review | A human reviewer, not the author, signs off on: the producers, the reviewed-code artifacts, the gate, and the public wording | written sign-off linked here | **not started** |

The public flag may be enabled only when gates 1–12 are all met. Until then `ARC_AUTONOMY_RISK_PUBLIC_ENABLED` must stay unset in every environment.

## Measurements to record during the shadow period

- p50 / p95 time per verification job and RPC calls per job, by network (`status.worker.risk.jobMs`, `rpcLastHour`).
- Daily scan cost = jobs per day × calls per job (public endpoints: no money cost; the binding limit is the provider rate limit).
- Coverage: CONFIRMED / NOT_CONFIRMED / UNKNOWN / CONFLICTING / STALE counts and the top UNKNOWN causes.
