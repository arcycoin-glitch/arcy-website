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

## Runtime safeguards

At every Railway Cron invocation the one-shot process:

1. Reads the Production data branch snapshot generatedAt from a fixed, non-user-controlled GitHub raw URL.
2. Applies the existing radar-snapshot-freshness.cjs 100-minute threshold. Younger snapshots never trigger another run.
3. Reads the ten latest runs of the exact radar-v4-snapshot.yml workflow using the dedicated token. Skips when another run is active or any schedule/workflow_dispatch/push run started within 45 minutes.
4. When due, requests GitHub workflow_dispatch only for the fixed repository, ref main, target production.
5. Logs only bounded status, age, reason and safe error codes. No token or auth headers in output.
6. If GitHub run-state API fails, **does not dispatch**. If the snapshot is temporarily unreadable, bounded recovery is allowed only after the GitHub running/recent check.

The GitHub workflow remains responsible for all tests, validated Top 10, identity checks, rate limits, immutable read-back and data-only branch publication. The existing serialized GitHub workflow concurrency group is unchanged.

IMPORTANT: The GitHub manual workflow_dispatch path forces a build, so the external script's 100-minute pre-gate is required to prevent wasteful provider calls.

## Release and verification

- Test: node --test test/radar-railway-dispatch.test.js.
- Run full repository regression plus smoke on the exact PR HEAD.
- Before enabling: verify the dedicated secret exists by **variable name only**, the environment/project/source are correct, and no other service has staged changes.
- After enabling: observe at least one Railway Cron run, verify SKIPPED or DISPATCHED, verify any GitHub run targets production on main, correct source timestamps, and confirm no Vercel deployment comes from the data-only branch.
- Monitor 24 hours: scheduled vs delivered runs, published snapshot age, provider requests, 429/503, terminal alert status.
- Railway Cron every 2h is a target, not a guarantee of publication; successful provider and GitHub runs are still required.
- If the credential is not available, leave the new Railway service **unconnected/inactive** rather than knowingly running failing jobs.

This script makes no change to Search UI, six-card layout, existing Radar engine/snapshot schema, Holder signed state, Railway /data, Vercel production flags or production market data.
