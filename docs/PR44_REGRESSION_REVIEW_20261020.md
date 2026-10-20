# PR #44 regression review — 2026-10-20

## Exact comparison

Production was verified twice as READY deployment `dpl_4iVxRtvZNbCsF2KgdrFbHhxgTEqr`, commit `d0249734f21d92d43249f4aab0b7fce792eae8eb`, branch `fix/hero-motion-mobile-section-transitions-20261019`. PR #44 started at `7cac095032d599dcda1221716fedf889b4a048ca`, based on that production commit. The older `main` is not the production source and must not be used as an implicit deployment baseline.

Untouched production baseline: 479 tests, 466 passed, 13 failed. Initial PR #44: 489 tests, 476 passed, the same 13 failed. Thus these were inherited failures, not new Mechanics regressions.

## Classification of every inherited failure

| Failing regression | Classification and correction |
|---|---|
| Normal Pulse never publishes; stale saved headlines remain archival | Test called live sources and shared transient cache. Deterministic failed source generation; retained authenticated-only publication assertions. Also exposed the real lost-audit bug below. |
| Three distinct Pulse panels and ARCY Take never present archival headlines as current | Outdated copy regex did not match “verified”. Assert semantic source-status/quiet-week wording instead. |
| Stale signed Pulse is not relabeled current | Shared module cache/live source contamination plus genuine lost last-success audit. Isolate API module/generator; preserve signed audit through transient fallback. |
| Provider failure yields three truthful slots, never empty 503 | Previous test's cached transient response masked injected failure. Fresh module and deterministic failure fixture preserve three-slot assertions. |
| Playing owl video is visible without doubled still/matte | Outdated listener-array regex. Production uses separate pause/ended and guarded stalled listeners. Assert actual listeners, unchanged CSS, and execute playback/buffering/error/reduced-motion behavior in a new VM test. No Hero code changed. |
| Approved DOM/CSS and unrelated sections identical to production | Old baseline SHA. Compare exact current production; independently freeze Hero assets and unaffected sections; permit exactly the Mechanics policy loader, not arbitrary DOM changes. Pulse formatter/auth/cron publication prefix remains byte-identical. |
| Burn share avoids scientific notation/misleading zero | Old precision expectation. Current approved display is `<0.0001%`. Assert exact boundary and invalid inputs; Burn application code unchanged. |
| Pulse builds dated current-cycle cards | Old five-source fixture omitted two now-required research sources; supply valid dated metadata for all seven configured sources. |
| Pulse saves quiet edition after successful source checks | Same fixture omission; explicitly require all seven checks to succeed. Empty/malformed research HTML is not successful source verification. |
| Pulse fills only missing categories | Same fixture omission; preserve actual/quiet slot assertions. |
| Pulse records partial source failure | Same fixture omission; explicitly assert five healthy checks and two genuine injected Circle failures. |
| Pulse rejects stale/future/unrelated/duplicate candidates | Same fixture omission; move unrelated fixture into the real candidate-selection path; assert exclusion and counters, including two dated historical research fixtures. |
| Pulse caps news and preserves identities across rollover | Same fixture omission and a Tuesday article tested on Monday. Use a valid Monday-published fixture; retain rollover assertions. |

## Genuine production defects fixed

- Preserve last successful signed edition/failure audit when stale saved data triggers transient source checks.
- Separate transient promises and caches by weekly cycle, preventing an in-flight previous week from contaminating the next week; retain at most two cycles.
- Abort actual provider fetches at the existing 8.5-second transient deadline and clear deadline timers after success.
- Do not silently discard linked-article HTTP/parse failures or mixed-success Arc blog failures and misclassify incomplete source coverage as a quiet week.
- Reject future-dated articles even when they fall inside the current calendar week.
- Report the upcoming Monday 06:00 UTC run correctly before 06:00 on Monday.

No new provider, license flag, publication permission, edition schema, UI, Hero, Burn, Unlocks, Swap or Holder implementation changes. Public requests may still perform the approved nonpersistent transient check; only authenticated publication paths persist editions.

## Validation

- First full suite: **496/496 passed**, zero failed/skipped/cancelled; 76.08 seconds.
- Final repeated full suite, including the added behavioral Hero regression: **497/497 passed**, zero failed/skipped/cancelled; 72.92 seconds. Remaining automated failures: **zero**.
- Browser: 48 Mechanics scenarios across three chains at desktop/mobile; eight progressive scenarios (ten scans); Search E2E at 320/390/768/1440; homepage navigation, exact-chain selection, error/429 and five-card/twenty-field scenarios all passed. These rendering/failure fixtures are mocked, not coverage evidence.
- Separate unmocked real-source browser runs: ARCY 8.501s, ARGUS 7.182s, Arc USDT 3.288s, TOLLY 3.665s, cirBTC 5.244s, Ethereum USDT 10.547s, ONDO 4.282s, Robinhood TSLA 6.352s and LINK 2.231s. All nine completed and matched the Mechanics evidence policy at 1440 and 390×844, including evidence disclosure and no horizontal overflow. Times are full report times, not individual API latency.
- Arc USDT retains insufficient Mechanics evidence (architecture only); Robinhood LINK retains unknown tax/mint; transfer-only evidence does not establish buy/sell or hook fees. Passing rendering does not turn these into verified metrics.
- Read-only live production Pulse GET: HTTP 200, 737ms, three cards and ARCY Take, seven checked source families; production remained on the exact baseline. No cron, manual publication or production mutation was invoked.

## Release preparation

Review the branch diff against the exact production SHA, not old `main`. Keep current deployment as rollback. This review does not merge or promote production. A preview/production build and post-deployment smoke remain deployment-stage checks, not claimed completed by local/browser results.
