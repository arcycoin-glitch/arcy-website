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
