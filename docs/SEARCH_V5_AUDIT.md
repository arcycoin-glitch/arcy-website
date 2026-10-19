# ARCY SEARCH V5 validation audit

Validated 2026-10-19. Baseline: `4f78998472a8d93a3c190c892381efb35e1a02cc`. Final branch: `codex/search-v5-final`.

## Scope and preserved work

The original uncommitted work was retained. Prior V5 commit `3e84ced0aaf9c963e4e76f82808b73902db7e723` remains on preserved branches. The final branch starts at the verified production source. Remote main is a later pre-Beta restoration that removes unrelated functionality; the draft PR targets existing `fix/search-v4-five-card-visibility`, which points to the verified baseline. This keeps review limited to V5. No merge or production deployment is authorized.

## Final implementation

- Added a separate no-store NDJSON progressive transport. Essential validated identity appears first, then evidence-validated cards as each completes. Every frame retains the five-card/twenty-field schema. The established JSON report endpoint is unchanged.
- One analysis uses one chain/contract/block anchor. Wrong-chain or changed-anchor frames are rejected. Search version and abort guards prevent old responses replacing newer searches; partial failures retain verified data without claiming completion. Pending fields explicitly say ANALYSIS_PENDING.
- Exact network/endpoint/method/parameter reads are shared only within an analysis, with RPC concurrency capped at eight. Concurrent reports coalesce only for the same exact chain/contract/provider policy; completed current reports are not replayed as fresh. Late subscribers receive the current verified frame.
- Independent supply, market, holder and Mechanics work overlaps. Existing reviewed V4 Mechanics evidence checks remain in place. Search-only legacy Mechanics uses the pinned RPC context; ordinary website callers retain their original behavior.
- Search optional Arc explorer requests have 1800ms provider deadlines, a 6000ms aggregate census wait, and bounded 15-second candidate cache/coalescing. Cached candidates still require fresh pinned balance reads and exact full-supply reconciliation. Partial or stale holder lists never become current concentration. Live explorer count outranks historical count when verified.
- Optional discovery foreground waits are bounded at 1000ms and artwork enrichment at 350ms. Only exact-contract local or already validated artwork survives degradation. Required Ethereum RPC transport gets at most one transient retry within the original total deadline; Retry-After is honored only within remaining budget. Evidence/identity errors are not retried into success.
- All five existing cards show available source-backed fields directly. NOT VERIFIED fields retain their reasons in closed disclosures; completely empty cards remain in the existing closed research-category group. Historical evidence stays visibly historical, and true zeros stay visible. No CSS, mascot, navigation, typography, chart preset or unrelated section redesign.
- Twenty metric identifiers and current dead/burn-address custody semantics are unchanged. Burn balance is not called total historical burned.

## Measured performance

Same immutable baseline versus candidate, same approved production source profile, same ten exact contracts, three rounds. Existing 24/minute API limit retained; both sides use the same pacing (at least six seconds per scan/discovery pair and 1.5 seconds idle). Measurements are real-source observations, not estimates. Live blocks differ over time; every individual report retains its own consistent anchor.

Baseline completed 29/30 attempts (one WETH HTTP 502); candidate completed 30/30. Timing comparison uses only the 29 matched successful pairs. Percentiles use nearest rank.

| API measurement | Before p50 / p95 | After p50 / p95 |
|---|---:|---:|
| Autocomplete | 573 / 903 ms | 475 / 894 ms |
| Identity available on wire | 4359 / 17569 ms | 1223 / 2274 ms |
| Market available on wire | 4359 / 17569 ms | 1667 / 2628 ms |
| Full deep analysis | 4359 / 17569 ms | 3025 / 6560 ms |

Full analysis improved 30.6% at p50 and 62.7% at p95. Cold candidate deep analysis reached 8186ms; external-source checks were retained rather than hidden to meet an artificial deadline.

Actual rendered DOM observations are a separate ten-contract browser run per version (MutationObserver records), not API latency substituted for visible data:

| DOM measurement | Before p50 / p95 | After p50 / p95 |
|---|---:|---:|
| First useful identity | 3778 / 18536 ms | 787 / 1819 ms |
| First useful market | 3778 / 18536 ms | 1674 / 2402 ms |

## Final coverage and identity acceptance

| Chain | Token | Available / 20 | First useful DOM | Market DOM |
|---|---|---:|---:|---:|
| arc (5042) | ARCY | 18/20 | 1252 ms | 2402 ms |
| arc (5042) | ARGUS | 18/20 | 703 ms | 1872 ms |
| ethereum (1) | USDC | 18/20 | 1019 ms | 1107 ms |
| ethereum (1) | WETH | 18/20 | 519 ms | 596 ms |
| ethereum (1) | LINK | 18/20 | 534 ms | 628 ms |
| ethereum (1) | ONDO | 18/20 | 514 ms | 707 ms |
| arc (5042) | LINK | 12/20 | 787 ms | 1907 ms |
| robinhood (4663) | AAPL | 14/20 | 1632 ms | 1715 ms |
| robinhood (4663) | TSLA | 14/20 | 1819 ms | 2021 ms |
| robinhood (4663) | LINK | 12/20 | 1403 ms | 1674 ms |

ARCY and ARGUS each include four explicitly historical holder fields. Availability is not a claim that every field is current on-chain data. Missing circulating supply, unsupported Mechanics behavior and incomplete holder concentration remain withheld. Exact addresses, all 200 field values/statuses/reasons/evidence and block anchors are recorded in [SEARCH_V5_RESULTS.json](SEARCH_V5_RESULTS.json). No value was fabricated to fill a card.

## Validation

- Complete Node regression: **438 passed, 0 failed, 0 skipped**. One unchanged scheduler timing assertion failed in an earlier run; isolated and full authorized Windows-file-operation reruns passed. No scheduler production code was changed.
- Existing homepage browser regression: passed at 320/390/1440 widths, all three networks, 429 handling, failed-report clearing, and 404 progressive-endpoint fallback to the established JSON endpoint.
- Existing Search browser E2E: passed across 320/390/768/1440 widths, three networks, discovery/re-search, identity/logo and chart presets.
- Progressive browser: **8 scenarios passed, 0 failed**, ten navigations: early identity/market, true zeros, disclosure preservation, stale-response race even without AbortSignal, changed block, truncated stream and partial-error behavior.
- Compact Mechanics/all-category fixtures: **40 passed, 0 failed**.
- Real-source browser: **10 contracts passed, 0 failed**, thirty responsive states at desktop1440/mobile390/mobile320; no page errors or overflow. Available values visible; missing rows and empty cards collapsed; all reasons accessible.
- Provider failure/deadline/retry, chain isolation, cache expiry, pinned reconciliation, subscriber disconnect and evidence mismatch cases are covered by the Node tests.
- Primary web links: **13 HTTP 200, 12 HTTP 403**, all 25 unique URLs checked with bounded HEAD/GET. The twelve DEX web pages block automated clients; this is not reported as a successful page fetch. Live JSON source evidence and exact contract matching were independently exercised.

## Source permissions and limitations

Production already authorizes DEX display. Only a different existing preview branch has that approval; the new final branch does not. GoPlus remains disabled. Both benchmark sides used the same existing production permissions without enabling any new provider. Default Vercel preview coverage may therefore be lower than these licensed-profile results. No credentials or environment settings were changed.

Local raw timing/browser/link artifacts remain excluded from Git. Reproducible harnesses are included under scripts/ and test/. Preview build status and remote SHA will be verified after the single final push and recorded in the PR; production is not deployed.
