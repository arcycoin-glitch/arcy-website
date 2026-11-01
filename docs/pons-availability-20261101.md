# Pons Radar availability and truthful source states

Base main: `0006daadb2f59613537b1d4ae3b875e128c8894d`.
This branch is independent of Unlocks PR #125.

## Observed production failure

The user's screenshot displayed an unavailable-source state alongside a claim
that no factory-confirmed Pons launches were found. The renderer used the same
empty-list text for failed requests and successful empty responses.

Read-only diagnosis run:
https://github.com/arcycoin-glitch/arcy-website/actions/runs/41349458305

At `2026-11-01T20:57:21Z`, the public Pons endpoint returned HTTP 503 in 330ms:

```json
{"ok":false,"error":"RADAR_SOURCE_UNAVAILABLE","reasonCode":"RADAR_PROVIDER_RATE_LIMITED","network":"pons"}
```

No Retry-After header was returned. A single bounded public Robinhood RPC batch
then returned HTTP 200, the correct chain ID `0x1237` (4663), a head block, and
readable responses from all three configured Pons factories. This confirms a
rate-limited ranking response at that time, not an absence of launches. It does
not prove all RPC operations or every source were healthy.

## Reproduced defects and changes

1. Radar adapters pass the `now` clock callback to the HTTP helper, which treated
   it as an epoch. A date-based Retry-After then produced NaN, making the wait
   non-finite and preventing a usable API Retry-After header. A direct fixture
   reproduced `retryInMs: NaN` before the fix. The helper now samples clock
   callbacks and supports numeric epochs; invalid clocks fail before any request.
   Seconds-based and date-based cooldowns prevent upstream calls until expiry.
2. Pons and Robinhood use the same provider pool pages but on concurrent cold
   loads only completed reads were cached. Their pending identical reads now
   coalesce. A deterministic test observes three shared page requests instead
   of six, plus the two legitimate section-specific token lookups. Failed pending
   reads are evicted. The existing source gates, credit reservation, TTLs,
   monthly/minute caps, shared quota and stale-data limits remain unchanged.
3. The overview distinguishes loading, unavailable, verified empty and verified
   populated states. Failure no longer claims that no Pons launches exist. The
   unavailable card offers manual retry for that network alone. Concurrent clicks
   coalesce; explicit Retry-After is honored. The expiry timer enables the button
   only and never automatically queries a provider.
4. A response must match the requested network, chain, version and ranked-token
   shape before it can be displayed. Failed/malformed data clears its prior
   overview entry. Selecting an unavailable network preserves its retry label
   rather than replacing it with the expansion action.

The clock/cold-load defects are demonstrated independently by tests; the public
503 establishes that rate limiting occurred. This evidence does not establish
that these two defects were the only possible production failure causes.

## Verification

- Main baseline from the preceding work: 857 tests, 855 passed, 2 skipped locally.
- Updated full local suite: 869 tests, 867 passed, 2 skipped, zero failures.
- New behavioral coverage: failed-vs-empty Pons state, wrong-network/malformed
  responses, selected-network retry, recovery, duplicate-click coalescing,
  Retry-After without automatic requests, clock callbacks, numeric epochs,
  API Retry-After propagation, cold parallel page reuse and failed-page eviction.
- A final browser-detected retry-label regression was fixed and the 14 directly
  affected UI/cooldown/preservation checks were rerun successfully.
- Browser QA uses the existing Radar page/styles and explicitly synthetic data
  in a 390px frame. Pons fails once, correctly shows source unavailability and a
  retry button, then recovers to a verified ranking on click. The frame has no
  horizontal document overflow. Fixture recovery is not a live recovery claim.
- No layout, stylesheet, network logo, token research card, Unlocks, Pulse,
  factory registry, source-verification rule or infrastructure setting changed.
- The exact Radar JS preservation fingerprint is refreshed for this specifically
  requested availability behavior. All other protected file hashes remain pinned.

## Release boundary

No production merge/deployment has occurred. A passing fixture test or a
successful preview build does not establish that a live provider is no longer
rate-limited. After release, inspect the real Pons response, Retry-After and
factory membership before claiming restored availability. Do not remove the
quota gate or publish unverified candidates to make the card appear populated.
