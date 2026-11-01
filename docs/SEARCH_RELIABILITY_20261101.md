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
5. `scripts/scheduled-health.cjs` + `.github/workflows/scheduled-health.yml`: read-only check every 6 h (6 requests): health, per-chain discovery isolation, official ARCY identity.

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
