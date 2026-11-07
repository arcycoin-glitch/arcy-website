# Token Unlocks — source diversity and change discovery (2026-11-07)

## Independent publisher count: still 1 (honest)
The three CoinBell requests (soonest / impact / value) are three sorts of one publisher, whose data is DefiLlama-derived.
Re-checked 2026-11-07 before integrating anything:

| Candidate | Independent of CoinBell? | Access / rights | Decision |
|---|---|---|---|
| DefiLlama unlocks/emissions | **No** (CoinBell's upstream) | Paid "API" tier only; Pro plan has no API access (docs.llama.fi/pro-api). Redistribution terms not stated there. | Not integrated |
| Tokenomist | Yes | Commercial redistribution documented as Enterprise-level (prior audit 2026-10-29) | Blocked on licence |
| CoinGlass | Yes | Commercial API rights need contract / redistribution review | Blocked on licence |
| Issuer-confirmed schedules (`project-confirmed`) | Yes | Public issuer documents, per token | Existing path; extend per reviewed token |

No source was added without confirmed commercial-use permission. Calendar coverage is unchanged and remains labelled `independentPublishers: 1`.

## Change discovery (this PR)
`lib/unlock-changes.js` diffs each new **signature-verified** edition against the previous verified edition and embeds
`changes` inside the signed payload (and `changeCounts` in the audit):
- identity = projectId (else normalized name) + ticker + allocation — never ticker alone; duplicate identities are counted as ambiguous, not guessed;
- `added`, `removed`, `rescheduled` (both dates), `amountChanged` (>1 %, both published amounts);
- rolling-window drift is separated: `expired` (date passed) and `enteredWindow` (horizon moved) are counts, not news;
- REMOVED / RESCHEDULED describe the publisher's listing, not an issuer decision.

The table UI is unchanged; the API passes `changes` through (`safeCurrentEdition` spreads the edition).
**Activation:** generation runs in the Railway worker, so this takes effect after the next operator-approved worker deploy.
The first refresh after that deploy diffs against the existing signed latest edition already on the volume.
