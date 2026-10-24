# Pulse and Unlocks — October 19 freshness review

## Findings
- Current homepage Pulse fallback content is generic source guidance, not a
  dated weekly Arc development. When the signed current-week publication is
  absent or invalid, the API uses source guidance.
- Weekly news cannot be inferred from a generic Arc blog landing page, an Arc
  Explorer link, or a token unlock listing.
- Unlock event discovery uses three sort orders of the **same** CoinBell
  publisher. These are not independent confirmations or exact on-chain vesting
  proofs. Percentage columns originate from that calendar.

## Safe fixes in this PR
1. Make the three Pulse fallback titles and descriptions explicitly state that
   a current-week event was **not verified**. They remain research links only.
2. Add `isCurrentWeekResearch` and `contentNotice` API metadata for
   clients to distinguish researched developments from source guides.
3. Withhold displayed calendar percentages rounded to zero such as
   `0,00%` or `0.00%`; do not interpret rounded source values as an exact
   zero. Original amount and project/day evidence remain unchanged.
4. Preserve the stored signed editions, immutable Pulse #003 archive, source
   restrictions, existing module layout, API event identifiers, unlock dates,
   and 6-hour scheduled refresh. No invented Arc news, vesting dates or
   percentages are inserted.

## Open operational work
- Inspect deployed Pulse publisher audit, source status and weekly cron run,
  including whether failures originate at fetch, parse, signature, storage or
  scheduling. No credentials are changed in this review.
- Before a dated three-card Pulse can be published, independently confirm
  primary-source links and dates during the current UTC week. A fallback is not
  a substitute for new reporting.
- Confirm each unlock event against the applicable issuer schedule or contract
  before calling it on-chain verified. The provider list is discovery only.
- Run full Node and browser regressions, compare API snapshots and review
  accessibility before promotion; these tests are **not yet confirmed**.

## Release boundary
Draft review branch only. Do not merge or deploy without validation.
