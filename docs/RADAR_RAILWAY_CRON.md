# ARCY Radar — independent Railway Cron dispatcher

Problem: GitHub Actions scheduled events for the ARCY repository are delivered irregularly (~6–12 hours apart). See issue #232. The Radar workflow already builds and publishes verified snapshots. This PR supplies a reliable external trigger, **not another Radar engine**.

## Deployment contract

Use a **separate** Railway service named arcy-radar-scheduler in the existing arcy-holder-worker Railway project, production environment.

- Source: arcycoin-glitch/arcy-website, main
- Builder: RAILPACK; no additional npm dependencies
- Start command: node scripts/radar-railway-dispatch.cjs
- Native Railway Cron: 17 */2 * * * (UTC, every two hours, staggered)
- No HTTP port, public domain, database, persistent worker or volume
- Do not alter arcy-holder-durable, its /data, signing keys or queue
- Secret only in new service: RADAR_GITHUB_DISPATCH_TOKEN

**Credential:** a short-lived, rotated, least-privilege GitHub App installation token (if rotation is supported) or fine-grained GitHub PAT restricted to **only** arcycoin-glitch/arcy-website with Actions: read and write. Enter it in the **new Railway service's private Variables UI**. Never paste it into a chat, repository file, issue, logs, CI artifact or shared environment.

GitHub cannot accept anonymous workflow_dispatch requests. If token absent, the process returns CONFIGURATION_REQUIRED and exits nonzero rather than creating an insecure public dispatch endpoint. The workflow-local GitHub Actions GITHUB_TOKEN is not a permanent Railway credential.

### Observed failure on 27 November 2026

The scheduler deployment `53c9e59a` built and started successfully on Node
22.23.5. Its structured runtime record at `2026-11-27T06:19:05.211445714Z`
reported `BLOCKED`, `DISPATCH_HTTP_403`, a readable snapshot aged 101 minutes,
and then a nonzero exit. This establishes that startup, the snapshot read and
the workflow-run read completed; GitHub refused the dispatch POST. Railway's
`CRASHED` label alone did not identify a startup bug.

A successful workflow-run GET proves read access, not dispatch permission.
The current credential's exact restriction is not established by this 403:
repository Actions write permission, token/repository approval, organization
policy or SSO authorization must be checked in the credential owner's private
settings. Do not retrieve or paste the credential to diagnose it. A fine-grained
token must cover this repository with Actions read/write; an installation token
must come from an installed, approved application with that permission.

The dispatcher now records this refusal as `CONFIGURATION_REQUIRED` with
`stage: dispatch`, HTTP status and allowlisted diagnostic flags, and still exits
nonzero. Start/outcome records include a nonempty `message` field so Railway
does not display an empty message with only structured attributes. This changes
diagnosis and observability; it does not grant the missing permission or make a
failed dispatch successful.

### Repository-side causes ruled out (27 November 2026, 10:45–11:30 TRT)

Checked through the GitHub REST API without the scheduler credential:
`radar-v4-snapshot.yml` is `active` with a `workflow_dispatch` trigger and a
`target` choice input on `main`; Actions executes (native schedule run
45940762414 succeeded); `main` has no branch protection; and the repository is
**public and owned by a personal account**, so organization approval, SSO
authorization and organization PAT policy cannot apply. No `workflow_dispatch`
run of this workflow has ever existed. The remaining cause is the credential
itself: authenticated and readable, but without Actions **write** on this
repository (fine-grained token with Actions read-only or this repository not
selected; classic token without `repo`; or a token owned by an account
without write access).

The dispatcher now also records non-secret credential metadata returned by
GitHub on the successful run-state read: `credentialKind`
(`classic` / `fine-grained-or-app`), allowlisted classic scope names,
`classicRepoScope`, `credentialExpiresAt`/`credentialExpired`, and on a
dispatch 403 a `remediation` code:

| `remediation` | Owner action |
| --- | --- |
| `FINE_GRAINED_TOKEN_NEEDS_ACTIONS_WRITE_ON_REPOSITORY` | Edit the fine-grained token: Repository access → only `arcycoin-glitch/arcy-website`; Repository permissions → Actions: **Read and write** |
| `CLASSIC_TOKEN_MISSING_REPO_SCOPE` | Replace with a fine-grained token as above (preferred) or a classic token with `repo` |
| `TOKEN_OWNER_OR_TOKEN_LACKS_ACTIONS_WRITE` | Create the token from the `arcycoin-glitch` account itself |

After updating the token, paste the new value only into Railway →
`arcy-radar-scheduler` → Variables → `RADAR_GITHUB_DISPATCH_TOKEN`.

## Runtime safeguards

At every Railway Cron invocation the one-shot process:

1. Reads the Production data branch snapshot generatedAt from a fixed, non-user-controlled GitHub raw URL.
2. Applies the shared radar-snapshot-freshness.cjs 100-minute global publication threshold. Younger publications never trigger another run. Section source ages, carried-forward status and degraded sections remain explicit in the same outcome; a stale carried section cannot masquerade as fresh, but does not force a build every 15 minutes after another recent attempt.
3. Reads the ten latest runs of the exact radar-v4-snapshot.yml workflow using the dedicated token. Skips when another run is active or any schedule/workflow_dispatch/push run started within 45 minutes.
4. When due, requests GitHub workflow_dispatch only for the fixed repository, ref main, target production, with `only_if_due: true`.
5. Logs only bounded status, age, reason and safe error codes. No token or auth headers in output.
6. If GitHub run-state API fails, **does not dispatch**. If the snapshot is temporarily unreadable, bounded recovery is allowed only after the GitHub running/recent check.

Each request has a real 15-second deadline covering headers and streamed body,
including a fetcher or body that ignores cancellation. The whole invocation has
a 45-second budget and each JSON body is limited to 3 MB while streaming. GET
429/500/502/503/504 responses and read-only transport/timeouts permit at most one retry; Retry-After is honored
only if it fits the remaining budget and is no more than three seconds. Long
cooldowns stop the check. Authentication/authorization failures are never
retried. A 403 explicitly reporting a rate limit is `BLOCKED`, rather than
misdiagnosed as a permission change.

The dispatch POST is sent at most once. Its transport or 5xx outcome may be
ambiguous, so it is never retried automatically. Concurrent checks in the same
process share one operation, and another same-process check within 45 minutes
of any POST attempt skips. Across fresh Cron processes, GitHub's run-state
check and workflow concurrency remain the gates; there is no new shared
database or Holder dependency. Native Railway Cron must remain a separate
one-shot service with restart policy NEVER.

| Outcome | Exit | Meaning |
| --- | ---: | --- |
| `SKIPPED` | 0 | Snapshot fresh, workflow busy/recent, or this process already attempted dispatch |
| `DISPATCHED` | 0 | GitHub returned 204 for the fixed main/production dispatch |
| `CONFIGURATION_REQUIRED` | 2 | Credential missing/invalid, HTTP 401/403 permission refusal, inaccessible workflow/repository, or HTTP 422 |
| `BLOCKED` | 1 | Rate limit, unavailable/invalid run-state data, bounded timeout, or unconfirmed dispatch |

Nonzero outcomes intentionally remain nonzero in Railway. Avoid an automatic
restart loop; resolve the diagnosed configuration before relying on the Cron.

The GitHub workflow remains responsible for all tests, validated Top 10, identity checks, rate limits, immutable read-back and data-only branch publication. The existing serialized GitHub workflow concurrency group is unchanged.

The regular manual workflow_dispatch path keeps its force-build behavior by
default. Scheduler calls set `only_if_due: true`, so the workflow checks
freshness again after waiting for its concurrency slot. This server-side check
prevents two independent schedulers from performing duplicate provider work
when both observed the same old snapshot before one of them published. The
external 100-minute pre-gate still avoids unnecessary dispatches.

## Release and verification

- Test: node --test test/radar-railway-dispatch.test.js test/radar-railway-dispatch-reliability.test.js.
- Run full repository regression plus smoke on the exact PR HEAD.
- Before enabling: verify the dedicated secret exists by **variable name only**, the environment/project/source are correct, and no other service has staged changes.
- After enabling: observe at least one Railway Cron run, verify SKIPPED or DISPATCHED, verify any GitHub run targets production on main, correct source timestamps, and confirm no Vercel deployment comes from the data-only branch.
- Monitor 24 hours: scheduled vs delivered runs, published snapshot age, provider requests, 429/503, terminal alert status.
- Railway Cron every 2h is a target, not a guarantee of publication; successful provider and GitHub runs are still required.
- If the credential is not available, leave the new Railway service **unconnected/inactive** rather than knowingly running failing jobs.

This script makes no change to Search UI, six-card layout, existing Radar engine/snapshot schema, Holder signed state, Railway /data, Vercel production flags or production market data.
