# Token Unlocks — source coverage and verification audit
Date: 2026-10-29 UTC | Scope: homepage Token Unlocks calendar only | Review: Issue #83

## Provenance and limits
This is an adaptation of Claude's `unlocks-rebase-09e26cd.patch` audit. The original audit reviewed 12 projects but found **zero** rows satisfying the strict project-confirmed bar (official explicit date **and** exact amount). Accordingly the `VERIFIED_EVENTS` list remains empty. Issuer-published schedule rules, estimated charts, third-party calendar entries and executed transfers must never be conflated.

Recorded baseline in Issue #83 (2026-10-28): HTTP 200; 65 events in the rolling 30-day window, 65 `source-published`, 0 `project-confirmed`. Three `soonest/impact/value` routes are views of one CoinBell / DefiLlama-derived calendar, not independent sources. All 65 API logo fields were empty but the separate 60-entry exact-name/token logo registry could render images in the browser. Network filter does not identify an asset's chain from its ticker.

## 12 projects examined
| Project | Key result | Action |
|---|---|---|
| Starknet STRK | Official monthly 15th schedule specifies **up to** 127M, not a confirmed exact amount | Keep third-party, no fabricated amount |
| Arbitrum ARB | Issuer monthly cadence from 16th; 15 November 2026 conflicts with issuer | Withhold exact 15 Nov row |
| ZKsync ZK | 21B supply × 0.8% investor/team monthly maximum = 168M ZK | Withhold matching investor/team amounts above 168M |
| Sui SUI | Official token-schedule chart explicitly described as an estimate; November dates/amounts disagree | Withhold Sui calendar schedules; name scope protects namesake tickers |
| Ethena ENA | 1/2/5 November 2026 dates and amounts conflict across third parties | Withhold those dated claims |
| Aptos APT | Insider four-year cycle stated to end October 2026; subsequent community tranches not exactly verified | Third-party-only, no new supplement |
| Sei SEI | Ecosystem reserve details do not provide exact dated quantities | Third-party-only |
| Optimism OP | Governance-driven timing, no exact event in window established | Insufficient |
| EigenLayer EIGEN | 4% monthly rule is not confirmation of exact cliff amount/date | Third-party-only |
| Avalanche AVAX | Genesis supply documentation is not a dated unlock schedule | Third-party-only |
| Ondo ONDO | Official 12-month cadence; next source-reported release January 2027, outside review window | No in-window supplement |
| Worldcoin WLD | Continuous daily linear emissions, estimated magnitude, not an exact daily cliff | Do not forge one-off events |

Primary evidence / source cross-checks include:
- https://sui.io/token-schedule
- https://docs.zknation.io/zk-token/zk-token
- https://docs.ethena.fi/ena/tokenomics
- https://docs.arbitrum.foundation/token-supply
- https://docs.starknet.io/architecture/strk
- https://docs.eigenfoundation.org/
- https://world.org/blog
- https://docs.mantrachain.io/mantra-chain-tokenomics
- https://tokenomist.ai/arbitrum

## Data rights — no provider purchased or silently added
CoinBell derives its data from DefiLlama. The audit found no unambiguous grant of independent commercial display/redistribution rights; this remains a licensing risk for project ownership to resolve. Tokenomist documentation describes commercial redistribution as Enterprise-level; DefiLlama paid API would not be independent of the CoinBell lineage; CoinGlass commercial API rights require contract/redistribution review. Existing source use is unchanged. CoinMarketCap Pro logo API requests are skipped unless the server has a key. The browser's historical CoinGecko hotlinked logo-image rights remain separately unverified.

## Implemented rules
- Four additions to the existing five review records: Sui, ZKsync, Ethena and 15 Nov Arbitrum.
- `reviewApplies` uses exact names and dates when supplied; ticker-only legacy review compatibility is retained.
- `amountExceeds` uses exact BigInt decimal arithmetic; an unparseable amount fails closed if applicable.
- API and worker both use `suppressingReview`; signed editions get request-time revalidation.
- Every output event carries `eventId`, `identityStatus`, `evidenceTier`, `scheduleStatus`, `executionStatus`, `sourceAsOf`, and `network:null`.
- `networkScope:'CROSS_ECOSYSTEM'` and `chainFilterApplied:false` disclose that `?chain=` is not a genuine filter.
- `independentPublishers:1` and publisher note disclose that three ranking views are one provider.
- No unauthenticated CoinMarketCap Pro logo query. Inactive search/server unlock implementations re-export the canonical registry and collector.

## Verification / release checklist
Compare Preview and Production `/api/unlocks` simultaneously: row count, date windows, unique eventId, quarantines by status, third-party vs confirmed tiers, and exact-name logo matches; inspect one row per reviewed project. Check at UTC midnight for rebasing. Run the whole regression suite and browser layout on mobile/desktop before merge. Missing data never becomes zero or imaginary project-confirmed evidence.
