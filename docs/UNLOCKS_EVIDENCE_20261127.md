# Token Unlocks evidence engineering — 2026-11-27 (#83, #77, #337, #326)

## Scope
Evidence-first hardening of the homepage Token Unlocks calendar and the Search `Next Unlock` path. No visual/DOM change; no merge/deploy.

## What changed
- `lib/unlock-core.cjs` — shared pure logic used by the Vercel route (`api/unlocks.js`) and the worker (`lib/unlock-calendar.js`): feed parsing with markup-drift detection, locale-safe amounts, host-allowlisted `sourceUrl`/logo, same-provider view dedupe (soonest/impact/value are ONE publisher, not independent), conflict quarantine (namesakes / contract versions never merged), `scheduleBasis` (cliff / linear / estimated) and canonical `executionVerification` (ONCHAIN_VERIFIED only with chainId+txHash+block).
- Per-source failure `reason` / `retryAfterSeconds` (403/429/HTML/JSON shift/partial) so outage is never shown as zero and stale is never shown as current.
- `search/server/lib/supply-insights.js` — `Next Unlock` blocker taxonomy: NO_REVIEWED_CONTRACT_SCHEDULE, NO_CURRENT_FUTURE_EVENT, NO_CONTRACT_LINKED_SOURCE, SOURCE_LOOKUP_FAILED, NO_SOURCE_ADAPTER_FOR_CHAIN (`doesNotImplyNoUnlock: true`).
- Tooling: `scripts/unlock-bench.cjs`, `scripts/probe-next-unlock-cohort.cjs`, `test/unlock-browser.cjs`, workflow `.github/workflows/unlocks-evidence.yml` (production baseline, paired before/after, cohort probe, browser 320/390/1440).
- `test/fixtures/approved-baseline.json` refreshed for the intentional protected-file change (`api/unlocks.js`), recorded in `approvedChanges`.

## Coverage statement (truthful)
- Next Unlock verified on the fixed 40-contract cohort: **0/40 expected**. Audit found no exact, contract-bound, dated official schedules (docs give shapes, third parties conflict, no vesting contract addresses). Nothing is fabricated; ONCHAIN_VERIFIED requires tx/event proof, otherwise SOURCE_REPORTED.
- CoinBell and DefiLlama lineage are not independent; no project-confirmed events are claimed.
- Local shell has no external network: live baseline/cohort classification comes from CI workflow output.

## Limitations
- No execution proofs yet (schedule ≠ execution kept separate).
- #336 (Circle supply) and #330 (Holder) keep separate review gates.
