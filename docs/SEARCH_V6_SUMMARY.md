# ARCY SEARCH V6 final summary

Development baseline: `67e8880b8bfd3aa9a709a94e56fc12497ae6ec2c` (V5 PR32). Separate branch: `codex/search-v6-engineering`; stacked draft base: `codex/search-v5-final`. Existing V6 work and benchmarks were preserved. No merge, production deployment, credential change or provider activation.

## Completed work

Preserved V5 compact cards, progressive transport, five cards/twenty identifiers, reviewed V4 Mechanics and burn-address custody semantics. Reviewed PR31 holder candidate evidence was reconciled with V5 and validated. Ethereum reports now retain twenty exact-address, same-block candidate balances, with UNKNOWN role by default and deterministic zero/dead custody only. Candidate rank never claims global completeness or beneficial ownership.

Source requests now revalidate cache/coalesced results per consumer, enforce size/deadline compatibility, bound concurrency, honor HTTP-date429 Retry-After, and apply bounded transient-outage circuit breaking without replaying expired evidence as current. Arc/Robinhood independent basic getters run concurrently after their chain/code/block validation. Completed Ethereum holder/Mechanics snapshots can arrive before unrelated sources finish.

Evidence boundaries reject contradictory primary token or current-block proof while retaining explicit historical COMPLETE evidence. Privacy-safe health diagnostics expose fixed aggregate labels, cache outcomes, latency buckets and network coverage; worker liveness is explicitly UNKNOWN. Public field failures no longer echo arbitrary upstream messages. The resumed review additionally fixed missing HTTP status metadata in Arc/Robinhood RPC errors so403/429 can be categorized correctly.

No approved design, CSS, spacing, layout, brand, chart presentation or unrelated site section changed. New context and holder addresses appear only in the existing evidence disclosures.

## Real measurements

Same existing source-permission profile: production-style runtime, existing DEX approval true, GoPlus false. Ten exact contracts, three rounds, same pacing,30 successful reports/version. These are application service timings, not DOM measurements. Percentiles use nearest rank.

| Pipeline | V5 p50 / p95 | V6 p50 / p95 |
|---|---:|---:|
| First verified identity | 814 / 1761 ms | 901 / 1274 ms |
| First source-backed market card | 1525 / 1996 ms | 1182 / 2067 ms |
| Full report | 2456 / 5307 ms | 2472 / 6560 ms |

First-useful p95 improved27.7%; full p95 regressed23.6%. Full median is essentially flat (2456→2472ms). Arc Mechanics completion dominates the slow tail; its existing source validation was not removed to manufacture a faster complete result. The first verified identity/basic data and other cards remain independently visible.

### Actual rendered desktop/mobile acceptance

V5 baseline:9 PASS/1 FAIL (ARCY browser wait timed out after30000ms); V6:10 PASS/0 FAIL,30 responsive states at1440/390/320px, no page errors or overflow. Missing fields and empty cards remain collapsed, and all available fields remain directly visible. All twenty checks/reasons remain accessible. Baseline failure is retained, not counted as a timing success.

| Rendered, nine matched successful contracts | V5 p50 / p95 | V6 p50 / p95 |
|---|---:|---:|
| First useful DOM | 1022 / 11599 ms | 1051 / 1649 ms |
| First market DOM | 1680 / 12736 ms | 1832 / 2460 ms |
| Complete streamed response | 2433 / 15112 ms | 2611 / 4576 ms |

Across all ten V6 browser cases, first-useful DOM p50/p95 was1051/1649ms. These live-source runs observe changing blocks/provider load; they do not establish a universal latency SLA.

## Coverage before and after

| Network | Token | V5 /20 | V6 /20 | V6 holder candidate rows |
|---|---|---:|---:|---:|
| arc | ARCY | 18 | 18 | 0 |
| arc | ARGUS | 18 | 18 | 0 |
| ethereum | USDC | 18 | 18 | 20 |
| ethereum | WETH | 18 | 18 | 20 |
| ethereum | LINK | 18 | 18 | 20 |
| ethereum | ONDO | 18 | 18 | 20 |
| arc | LINK | 12 | 12 | 0 |
| robinhood | AAPL | 14 | 14 | 0 |
| robinhood | TSLA | 14 | 14 | 0 |
| robinhood | LINK | 12 | 12 | 0 |

Metric availability is unchanged. ARCY/ARGUS each include four explicitly historical holder fields; availability is not a claim of current concentration. The new candidate disclosure improves evidence access, not the number of core metrics. All200 final field observations, reasons, freshness and primary proof are in SEARCH_V6_RESULTS.json.

## Source timing and failure review

Provider timing measures fetch response headers; full report includes body parsing and proof processing. HTTP403/404 are included in source error counts even when an expected fallback made the report succeed.

| Provider group | Requests V5/V6 | p95 V5/V6 ms | HTTP/transport failures V5/V6 | Timeouts V5/V6 |
|---|---:|---:|---:|---:|
| arc_rpc | 279/282 | 234/233 | 0/1 | 0/0 |
| explorer | 57/56 | 1808/1804 | 33/32 | 6/5 |
| dex | 43/43 | 332/291 | 0/0 | 0/0 |
| source | 32/32 | 450/300 | 18/18 | 0/0 |
| market | 5/6 | 475/451 | 0/0 | 0/0 |
| ethereum_rpc | 459/459 | 276/282 | 0/0 | 0/0 |
| robinhood | 189/189 | 381/398 | 0/0 | 0/0 |

Total upstream failures:51/1064 (4.79%) V5 versus51/1067 (4.78%) V6. Timeouts:6/1064 (0.56%) versus5/1067 (0.47%). Both versions still completed30/30 reports. Source403/404 results remain unavailable evidence; recovered429 is not hidden from diagnostic counts. The bounded process counters record100 reused pinned RPC reads and32 source-cache hits in this V6 benchmark; these are observations from this process, not durable fleet statistics.

## Tests and security

- Final Node regression: **463 PASS,0 FAIL,0 SKIP**.
- Targeted final affected-path tests: **36 PASS,0 FAIL**.
- Existing homepage and Search browser suites: PASS; holder candidate disclosure tested on desktop/mobile.
- Compact-card fixtures:40 PASS/0 FAIL; progressive fixture scenarios:8 PASS/0 FAIL.
- Real source acceptance:10/10 V6 contracts;30 desktop/mobile states.
- Failure tests cover403,429,Retry-After,circuit recovery,expired cache,schema/size validation,deadline isolation,capacity release,wrong chain/contract/block,historical evidence,forged holder roles and safe error payloads.

Read-only RPC allowlists, source-profile/runtime checks, provider gates, source escaping and logo security remain unchanged. No named roles, new market values or risk ratings were fabricated. No new dependencies or paid infrastructure. Worker liveness and unsupported permissions remain unverified. Build/test success does not alone establish production readiness. Architecture, source restrictions and rollback details: SEARCH_V6_ARCHITECTURE.md.

## Exact files changed

- `docs/SEARCH_HOLDER_ATTRIBUTION_FOUNDATION.md`
- `docs/SEARCH_V6_ARCHITECTURE.md`
- `docs/SEARCH_V6_RESULTS.json`
- `docs/SEARCH_V6_SUMMARY.md`
- `scripts/search-v6-acceptance.cjs`
- `scripts/search-v6-benchmark.cjs`
- `search/index.html`
- `search/server/api/health.js`
- `search/server/lib/analysis-scope.js`
- `search/server/lib/arc-rpc.js`
- `search/server/lib/data-engine.js`
- `search/server/lib/diagnostics.js`
- `search/server/lib/evidence.js`
- `search/server/lib/holder-attribution.js`
- `search/server/lib/holders.js`
- `search/server/lib/large-holders.js`
- `search/server/lib/multichain-service.js`
- `search/server/lib/progress.js`
- `search/server/lib/report.js`
- `search/server/lib/research-notes.js`
- `search/server/lib/robinhood-rpc.js`
- `search/server/lib/source-request.js`
- `test/search-browser-e2e.cjs`
- `test/search-holder-attribution.test.js`
- `test/search-v6-reliability.test.js`

## Delivery

One final commit and one separate-branch push; draft PR stacked on validated V5. Remote SHA and exact-commit Vercel preview status are checked after push and recorded in the PR. Production stays unchanged.
