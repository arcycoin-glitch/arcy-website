# Unlock source policy

The existing table, date windows, search and pagination consume the same API fields.
CoinBell's soonest, impact and value calendars are fetched concurrently. The observed
60-row response limit means this union improves coverage but is not a complete calendar.
Published calendar records carry `verification: source-published`; this means a reliable
calendar published the event, not that ARCY independently proved every vesting contract.
No recurrence, chart interpolation, emission formula or market-price conversion is used.

## Supplemental project evidence

`lib/unlock-evidence.js` contains the reviewed supplemental registry. It is intentionally
empty until an explicit current event date AND exact amount can be established. Coverage
reviews explain why IO, PLUME and legacy OM/native MANTRA are withheld. These symbols
cannot bypass their review merely by appearing in a calendar response later.

To add an event, a maintainer must review a project-controlled official source and add:

- `projectId`, `tokenVersion`, `name`, `symbol`, `allocation`.
- `date` as an explicit UTC ISO day and `amountTokens` as an exact decimal string.
- `sourceUrl`, `allowedHost` identifying the reviewed official HTTPS source.
- `publishedDateText`, `publishedAmountText`, and the complete `evidenceText` sentence
  containing both the date and amount, with allocation/token context.
- `reviewedAt` and `reviewExpiresAt` as ISO timestamps, no more than 30 days apart.

The amount quotation is a number (commas allowed), not an approximation such as 10M.
This registry is a human review boundary: a literal match does not establish source
ownership or interpret context. Never add a speculative/proposed quote, an inferred
recurrence or a legacy-token event under a current-token identity.

Every API refresh fetches the evidence again. Expired reviews, changed text, unavailable
pages, invalid amounts/dates or redirects to another host are rejected. Failed evidence
is never replaced by guessed or saved stale events. Renew a review only after rechecking
the current official publication. If a source is available only as a chart/PDF/onchain
vesting account, add and test a dedicated evidence adapter before registering events;
the HTML adapter deliberately does not infer its contents.

## Reconciliation and availability

Calendar duplicates use name, ticker, UTC day and allocation. Different allocations or
projects sharing a ticker are kept separate. Conflicting amounts suppress the entire
group; percentage disagreements leave percentage blank. Market values never produce
token amounts. Supplemental entries have no derived circulating-supply percentage.

`coverage.complete` is always false. `coverage.sources`, `coverage.reviews`,
`coverage.conflicts` and `coverage.rejectedSupplements` expose limitations. One failed
source permits healthy sources to continue and sets `partial`; all unavailable sources
produce 503. Partial/error responses are not CDN cached. Normal cache expires no later
than UTC midnight so events cannot remain in yesterday's window.

Run `node --test tests/data-flows.test.mjs` and `node --check api/unlocks.js` after changes.

## October 2026 source-integrity review

Three CoinBell calendar sorts improve *discovery coverage*, but they are three views of a **single publisher**, not three independent attestations. Even a record present in all three sorts remains `source-published`, never `project-confirmed` or on-chain verified.

**Arbitrum (ARB), 15 October 2026, 92.65M ARB / Team:** the source row conflicts with independent Tokenomist's 16 October next unlock and Arbitrum DAO's documented monthly team/investor releases beginning on the 16th. This one dated **Arbitrum** row is quarantined; ARB dates on other days and unrelated projects sharing the ticker are not automatically suppressed. A different date/amount is **not** invented to replace it. Relevant reviews:
- https://api.coinbell.in/token-unlocks?sort=soonest&window=30
- https://tokenomist.ai/arbitrum
- https://docs.arbitrum.foundation/token-supply

**Capricorn (APR), 23 October 2026:** CoinBell reports **56.33M APR / 20.28% of circulating float**, while DefiLlama's dated calendar says approximately **33.6% of float**. Preserve the published date and token amount as source-reported, but suppress the unsupported exact circulating-percentage cell until denominator/source timing is reconciled. Sources: https://api.coinbell.in/token-unlocks?sort=impact&window=30 and https://defillama.com/calendar. This is a percentage disagreement, not proof that the unlock itself is false.

A cryptographically signed worker edition attests the publisher, not that its time windows remain current. The public endpoint accepts signed releases only if their generation date is **today in UTC**, they are no more than **8 hours old** (6h cadence plus 2h grace), and their refresh timestamp follows generation within 7h. Older snapshots are rejected and a fresh collection is attempted; all-source failure returns 503 rather than a falsely current calendar. Both accepted worker snapshots and live fallback are re-windowed for the request's current UTC date, with disputed source records quarantined.

Daily labels are schedule dates, **not evidence that an intra-day unlock has already executed or that the recipient sold tokens**. The percentages and USD values remain source-reported estimates and can drift with float/price. CoinBell's 60-row-per-sort result cap means the 30-day union is not a complete universe of unlocks.

## October 2026 review expansion

See `docs/unlock-source-audit-20261029.md`. Review records may scope exact `names` and multiple `dates`, with `official-cap-review` / `maxTokensPerEvent` plus optional `capAllocationPattern`. Over-limit matched rows are withheld; under-limit rows retain their `source-published` status. The API and worker enforce the same review policy even on signed stored editions. Every public event identifies evidence tier, date/source freshness, scheduled-versus-executed status, and unknown network identity. Three CoinBell rankings are **one** publisher.
