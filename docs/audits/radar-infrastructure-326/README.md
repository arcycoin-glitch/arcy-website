# Radar infrastructure completion — issue #326

PR: [#334](https://github.com/arcycoin-glitch/arcy-website/pull/334). Baseline main:
`bf3372654ebc9949f30b8fb81e8bbf5b514b93c7`. This is a point-in-time engineering
audit on 27 November 2026, not a continuous production health claim. Exact final
HEAD and latest CI results are retained in the PR and issue #326.

## Implemented

- Scheduler startup/outcome logs now have a readable `message`. GitHub
  401/403/404/422 expose safe, stage-specific configuration diagnoses, with
  nonzero exit codes. Error bodies, credentials and authorization headers are
  never logged. Requests cover headers/body with a 15 s watchdog, a 3 MB stream
  limit and 45 s total budget. Read-only transient GETs retry at most once;
  authorization failures and non-idempotent dispatch POSTs never retry.
- Concurrent same-process checks coalesce and a POST attempt suppresses further
  same-process attempts for 45 min. Existing native Cron single-replica behavior,
  GitHub active/recent-run checks and workflow serialization remain. Automated
  requests opt into `only_if_due`, rechecking freshness after their workflow
  concurrency slot. This reduces duplicate provider builds; it is not a new
  distributed dispatch lock or a claim of exactly-once HTTP delivery.
- Section observation time uses the oldest actual market input, never the new
  build clock. All networks have the same 6 h stale / 24 h expiry handling.
  Healthy sections remain publishable while failed sections retain their true
  last-known-good clocks and build-failure diagnostics. Structural, identity,
  engine-version, hard-risk, shortfall and overlap gates remain in force.
- Intake has bounded retries/backoff and Retry-After handling. Two independent
  lanes avoid one chain blocking the others, while Robinhood/Pons remain
  sequential to avoid duplicate scans. A hung body is bounded. Transient
  snapshot-read failures retry the existing valid edition sooner, without
  making its evidence fresh.
- Pons negatives require complete valid factory answers. A per-call error no
  longer becomes a cached nonmember. The captured same-answer replay preserves
  healthy membership and RPC cost; the injected failure preserves ten STALE
  rows instead of replacing them with a false-complete fresh nine.

## Production evidence, separate from this candidate

The native GitHub **schedule** run
[45940762414](https://github.com/arcycoin-glitch/arcy-website/actions/runs/45940762414)
generated, published and immutably read back data revision
`db6a95a531889c733673c8c0ea3de9d78deb0888` at
`2026-11-27T04:37:54.673Z`. Engine main was `bf33726`. It recovered the earlier
39/40 Pons shortfall before this PR. Attributable coverage gain is **zero**.

| Section | Published rows | Source observation (UTC) | Duplicate identities |
|---|---:|---|---:|
| Arc / 5042 | 10 | 04:35:11.505 | 0 |
| Ethereum / 1 | 10 | 04:35:15.136 | 0 |
| Robinhood / 4663 | 10 | 04:35:17.695 | 0 |
| Pons subset / 4663 | 10 | 04:35:18.591 | 0 |

All four public APIs returned 10 rows, FRESH, and the same exact addresses as the
published snapshot. The audit confirmed code for all 40 on the expected three
chains at explicit blocks. All ten Pons contracts also matched official factory
records in 30 calls pinned to Robinhood block `0x7653761`.

DEX Screener returned exact-chain base-token market pairs for all 40 addresses;
31 matched the snapshot's selected pool exactly. Nine had token-level pairs but
not the identical selected pool in this separate observation. This does not
establish a new paired price/volume agreement for those nine. Source times
differ, so changing market values are not treated as simultaneous conflicts.

The 40 are research rows under the existing policy, not 40 safety-certified or
verified-organic investments: 16 official profiles, 13 self-published
exact-contract sites, 11 listed-channel profiles; nine low-confidence watch
rows. Four are below research liquidity references; historical price-event
flags and two missing current 24 h values remain disclosed. No displayed
contract intersects the current critical-risk/hold ledger. See the exact
[quality and discovery audit](pons-discovery.md).

## Scheduler production blocker

Railway build and startup succeeded. Five actual invocations from 22:21 UTC on
26 November through 06:19 UTC on 27 November recorded
`BLOCKED / DISPATCH_HTTP_403` in structured log attributes. The previously blank
message was a rendering/observability gap. A denied POST explains the nonzero
exit and CRASHED state; it is not evidence of a missing token or broken startup.

The credential exists by name on the scheduler. Its value was never retrieved.
GitHub requires [repository Actions write permission for workflow dispatch](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).
The old log cannot distinguish missing write scope, unapproved repository/app
access, SSO or another GitHub policy. The new safe diagnostics retain request
IDs and allowlisted permission/SSO/rate-limit indications for the next run.

No successful **Railway** dispatch or complete Railway → GitHub → publication
chain is proven. Existing native GitHub schedule success is reported separately.
No merge, deployment, credential rotation/removal or production setting was
performed. The concrete operator sequence is in [the scheduler runbook](../../RADAR_RAILWAY_CRON.md)
and the separate [secret-removal review](secret-removal-review.md).

## Validation and retained artifacts

- 166 combined targeted tests passed; final freshness/scheduler checks 30/30.
- Local complete suite: 1,745 tests, 1,741 pass, two existing Windows platform
  failures, two Redis skips. The failures are the unchanged Linux durable-volume
  path requirement and POSIX path comparison in Risk bundle tests. Ubuntu
  Node 22 with real Redis is the complete-regression release gate, recorded on
  the final PR HEAD; local limitations are not waived as a passing release.
- Real production browser: 20 network/width views at 320/390/800/1024/1440,
  existing expand control displays all 40 API contracts; zero overflow/page
  errors. All UI source/layout files are unchanged.
- Real factory capture and replay: [fixture](../../../test/fixtures/radar/pons-factory-shapes-20261127.json).
- [Name-only Railway/runtime evidence](evidence/railway-before.json).
- [Production API, chain, market and all-ten Pons audit](evidence/production-audit.json).
- [Browser observations](evidence/browser-results.json), [mobile screenshot](evidence/pons-390.png),
  [desktop screenshot](evidence/pons-1440.png).

Reproduce public reads (no secret needed):

```powershell
node scripts/audit-radar-release.cjs --snapshot SNAPSHOT.json --out audit.json --onchain
node test/radar-release-326-browser.cjs
npm test
```

The existing PR snapshot workflow writes only its preview data branch, never
Production. Production rollout and credential operations require separate
explicit owner authorization under the user's release constraint. Review-ready
code does not mean the external credential blocker is resolved.
