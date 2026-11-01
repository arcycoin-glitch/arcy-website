# Unlocks: coverage, grouped events and mobile readability

Base: `0006daadb2f59613537b1d4ae3b875e128c8894d` (main).
Scope: the homepage Unlocks section and its presentation only.

## Problem and resulting behavior

Five alphabetically ordered event rows previously looked like a fixed token
watchlist. Users could not distinguish the number of calendar identities from
the number of events, inspect provenance in the table, or read the amount and
percentage together on narrow screens without horizontal scrolling.

- The summary counts distinct calendar token entries and de-duplicated events
  across the three existing UTC windows. These are **entries in this feed**,
  not the universe of monitored market assets or verified contract identities.
- Each selected window groups events using project/name, ticker, asset version,
  network and contract when supplied. Different allocations and dates remain
  available under an accessible expandable row. No amounts are summed.
- Default ordering is the largest known single event in USD. Alternative orders
  are largest source-published circulating percentage and soonest. The displayed
  amount/date/value all come from the same representative event. Missing metrics
  sort behind known metrics. Rounded-zero percentages are not measured zero.
- Expanded rows retain the original dates, amounts, allocation, source values,
  evidence tier, source check timestamp and an allowlisted HTTPS source link.
  Scheduled releases are explicitly distinguished from verified execution.
- Multiple dates are labelled as multiple dates, **not** inferred daily or linear
  vesting. Schedule types remain unavailable unless an explicit matching source
  evidence item supports the type. The current provider does not supply that
  field, so this change does not claim to classify existing events.
- The existing Unlocks owl image is extracted byte-for-byte from its inline
  data URI into `assets/unlocks-owl.webp`; the image is unchanged and independently
  fingerprinted. This also permits small, reviewable source publication requests.
- At widths of 560px and below, the existing table presents as compact cards,
  retaining token, date, amount, USD value and percentage. Desktop keeps the table.
  Search, three date windows, five-token pagination, source outage behavior and
  background refresh hooks remain functional.
- Failure clears visible counts and rows to unavailable, including malformed
  successful responses and failure to load the presentation asset. A successful
  empty feed remains distinguishable from a failed request.

## Source expansion and operational limits

No new provider, paid product, cron, Railway setting or checkpoint is introduced.
The existing API, worker collector, signatures, evidence rules, review quarantine
and original events are unchanged. The collector still uses three views of one
CoinBell publisher, with an observed 60-row-per-view ceiling.

The historical 28 October measurement recorded 65 **events**, not 65 distinct
tokens. Production `/api/unlocks` could not be retrieved from this execution
environment: requests returned a proxy timeout or non-JSON unavailable page.
This is not evidence that the public site is down. The subsequent GitHub Actions
read below succeeded; market coverage is not claimed to have increased.

`node scripts/probe-unlock-coverage.cjs` makes one read-only GET to the public
endpoint and reports token identities, event counts, separate window counts,
repeated-date counts, source status and evidence tiers. Non-JSON/failed/malformed
responses fail visibly. The scoped PR workflow retains the result as an artifact;
it does not schedule recurring work. `ARCY_BASE` can select a known preview for
the same check. Fixture counts are never reported as live measurements.

Further calendar expansion needs documented provider pagination or reviewed
first-party dates and amounts. Adding names, extrapolating estimated schedules,
or removing integrity quarantines would not establish additional valid coverage.

## Actual production snapshot

The read-only GitHub run [41348957468](https://github.com/arcycoin-glitch/arcy-website/actions/runs/41348957468)
succeeded at `2026-11-01T20:51:11.186Z`, reading an edition checked at
`2026-11-01T20:34:12.012Z`. The exact result is stored in
`docs/audits/unlocks-coverage-20261101.json`.

| Metric | Observed |
| --- | ---: |
| Distinct calendar token entries | 65 |
| De-duplicated events | 65 |
| Today | 10 |
| Next 1–7 days | 9 |
| Days 8–30 | 46 |
| Third-party calendar events | 65 |
| Project-confirmed events | 0 |
| Events with unavailable schedule type | 65 |
| Quarantined records reported by the API | 3 |

All three source views were available, each containing 60 rows; the API still
reports one publisher and partial coverage. Every token had one published event
in this snapshot. Grouping therefore prepares for multiple allocations/dates;
it does not establish that the present feed contains repeated events or that
recurring appearances across days are verified linear vesting. The five visible
rows are only the first page, ordered alphabetically within the same date by
the previous UI. The updated UI makes the ten Today entries and other windows
visible through counts, ranking and pagination. No independent event-date or
amount attestation is implied by this successful API availability check.

## Verification

- Unchanged baseline: 857 tests, 855 passed, 2 skipped, 0 failures.
- Updated suite: 873 tests, 871 passed, 2 skipped, 0 failures. The 16 new tests
  cover presentation, the one-request probe and preservation of unrelated UI.
- GitHub regression run [41348957444](https://github.com/arcycoin-glitch/arcy-website/actions/runs/41348957444) passed all **873/873** tests, including the real Redis checks skipped locally. Vercel reported a successful Preview build.
- The separate broad production API smoke run [41348957362](https://github.com/arcycoin-glitch/arcy-website/actions/runs/41348957362) failed because Pons Radar returned `503 RADAR_SOURCE_UNAVAILABLE`. Unlocks itself returned HTTP 200 with 65 events; health, holders, Pulse, Arc Radar, Ethereum Radar and Robinhood Radar returned HTTP 200. This PR changes none of the Radar/backend code. Keep this operational failure visible; do not claim the whole site passed release acceptance.
- New tests exercise duplicate source views, namesake tickers, version/network
  identity, repeated dates, representative-event sorting, missing metrics,
  locale percentages, unverified schedule types, source URL validation,
  pagination, malformed feeds, recovery and stale-counter clearing.
- Browser checks use a local static copy of the actual homepage and explicitly
  synthetic data. They verify grouped expansion/source links, three windows,
  search, sorting, pagination, empty results, outage and recovery. The calendar
  has no horizontal overflow at 320px and 390px iframe viewport widths.
- The native dev command does not honor the managed preview port arguments;
  visual QA therefore uses the supported static preview mode on the disposable
  copy. Production code/configuration is not altered to accommodate preview.
- The whole-homepage fingerprint is intentionally refreshed for the requested
  Unlocks UI change. `test/unlock-scope.test.js` additionally pins every homepage
  byte outside the Unlocks markup/client and the two asset tags. All previously
  protected Search, Radar, Pulse, worker and shared stylesheet hashes remain
  unchanged. Test protection is retained, not bypassed.

## Release

Review the diff and CI result; verify `/unlock-view.js` and `/unlocks.css` load
on the real deployment and run the one-request coverage probe. Live source
validation remains separate from fixture-based layout checks. This PR does not
claim a production deployment or increased market coverage.
