# #337 coverage audit — fixed 40-token cohort, all Search card fields (27 Nov 2026)

Measured, not estimated. Source of truth: `production-baseline-20261127.json` (743 rows) produced by
`scripts/coverage-matrix.cjs` against **production** (`www.arcyusdc.xyz`, main `8b25d75`) at 2026-11-27T13:35:29Z, CI run on PR #338.
Tiers use the existing `verified-coverage.tierOf` taxonomy: VERIFIED = on-chain or cross-verified; SOURCE_BACKED = single
fresh source; NOT_VERIFIED = no admissible evidence. **No denominator exclusions** are applied in this matrix.

## Denominators
- Fixed cohort: 40 tokens (Arc 10, Ethereum 10, Robinhood 10, Pons 10 on chain 4663), 5 data cards × 4 fields = **20 fields/token**
  (`activity`, `holders`, `liquidity`, `mechanics`, `supply`; the sixth card “Claim vs Reality” has no field-level metrics).
- Reports returned: **37/40** (CVX HTTP 502, CORBEL / HALBROOK HTTP 429 from production rate limiting at 1.5 s pacing). A later
  2.2 s-paced read via the site origin returned **40/40 HTTP 200**, so the 3 failures were transient, not engine defects.
- Rows: 37 × 20 + 3 failed-report rows = 743.

## Baseline (production)
**Overall: 371 VERIFIED / 743 (49.9 %), 331 SOURCE_BACKED, 41 NOT_VERIFIED. Any evidence: 702 / 743 (94.5 %).**

| Section | VERIFIED | SOURCE_BACKED | NOT_VERIFIED | Rows |
|---|---|---|---|---|
| arc | 107 (53.5%) | 77 | 16 | 200 |
| ethereum | 71 (39.2%) | 103 | 7 | 181 |
| robinhood | 108 (54.0%) | 85 | 7 | 200 |
| pons | 85 (52.5%) | 66 | 11 | 162 |

| Field | VERIFIED | SOURCE_BACKED | NOT_VERIFIED | Reports |
|---|---|---|---|---|
| `activity.change24h` | 0 | 36 | 1 | 37 |
| `activity.priceUsd` | 28 | 8 | 1 | 37 |
| `activity.valuation` | 0 | 36 | 1 | 37 |
| `activity.volume24h` | 0 | 36 | 1 | 37 |
| `holders.holderCount` | 27 | 10 | 0 | 37 |
| `holders.largestWalletPct` | 27 | 9 | 1 | 37 |
| `holders.top10Pct` | 27 | 9 | 1 | 37 |
| `holders.top20Pct` | 27 | 8 | 2 | 37 |
| `liquidity.dexPairCount` | 0 | 36 | 1 | 37 |
| `liquidity.liquidityTurnover24h` | 0 | 30 | 7 | 37 |
| `liquidity.liquidityUsd` | 1 | 35 | 1 | 37 |
| `liquidity.volume24h` | 0 | 36 | 1 | 37 |
| `mechanics.contractArchitecture` | 37 | 0 | 0 | 37 |
| `mechanics.mintCapability` | 11 | 18 | 8 | 37 |
| `mechanics.ownerAdmin` | 12 | 20 | 5 | 37 |
| `mechanics.tradingTaxes` | 26 | 4 | 7 | 37 |
| `supply.burnAddressBalance` | 37 | 0 | 0 | 37 |
| `supply.burnAddressPct` | 37 | 0 | 0 | 37 |
| `supply.nonBurnSupply` | 37 | 0 | 0 | 37 |
| `supply.totalSupply` | 37 | 0 | 0 | 37 |

## Why rows are not VERIFIED (production, per field)

### Holders (VERIFIED 27/37 count, 27/37 top10)
- Arc 10/10, Robinhood 10/10, Pons 7/7 returned: **signed COMPLETE census**.
- Ethereum 9/9 returned: Blockscout explorer counts (SOURCE_BACKED); no Ethereum census exists on main. LDO ranked fields
  `RANKED_SOURCE_API_FAILED`.
- PONS `4663:0x39dbed…`: Blockscout PRO count 106,511 (SOURCE_BACKED); census NOT_VERIFIED because 105,7xx positive wallets > 100,000 budget.

### Liquidity / activity (single-source DEX Screener, on-chain cross-check per token)
`liquidityUsd` on-chain check result for all 40 (production, 2.2 s paced, 40/40 HTTP 200):
| Reason | Tokens |
|---|---|
| `LIQUIDITY_SCOPE_EXCEEDS_BUDGET` (provider sums 7–30 pools, check budget 6) | 25 |
| `POOL_TVL_UNSUPPORTED_V4` | 6 |
| `QUOTE_ASSET_UNSUPPORTED` / `TOKEN_USD_UNVERIFIED` | 5 |
| `ONCHAIN_BUDGET_EXHAUSTED` | 1 |
| verified / agree | 3 |

`priceUsd` failures: `QUOTE_ASSET_UNSUPPORTED` (SKY quote WBTC; FLOCK quote USDG; AI quote tokenized NVDA; STATICS, ORBIO),
`POOL_KIND_UNSUPPORTED` (CVX, YFI: Curve), `V4_POOL_KEY_UNAVAILABLE` (oBrain, FOBO), `GETTER_REVERTED` (MORPHO).
`volume24h`, `change24h`, `valuation`, `dexPairCount` are provider aggregates with no on-chain equivalent at report time → SOURCE_BACKED by design.

### Mechanics
Unchanged from V9 (see PR #341 for the per-contract evidence probe): 6 no-source contracts (Sourcify 404, explorers 403/522),
TENDIES Yul, MSS2 unreviewed, LDO/AAVE governance-upgradeable, ARGUS/CRA/ARCANUS pool/hook-scoped fees.

### Supply
`totalSupply`, `nonBurnSupply`, `burnAddressBalance`, `burnAddressPct`: **37/37 VERIFIED** (pinned RPC). Circulating Supply and
Next Unlock are not displayed card fields since PR #79 (product decision); their backend status is below.

## Circulating Supply / Next Unlock on the fixed 40 (Phase 3)
- Circulating: **0/40**. None of the 40 is an issuer-published stablecoin (Circle/Tether mappings: PR #336, 4 exact contracts,
  none in the cohort). No issuer/publisher circulation feed with exact chainId:contract identity and established licence was found
  for the 10 Ethereum governance tokens or the Arc/Robinhood launch tokens. `totalSupply − burn` is never used as circulation.
- Next Unlock: **0/40**. `search/server/data/eth-unlocks.json` is empty; no reviewed primary-source schedule or verified vesting
  contract with exact token identity was established in this session (primary documentation pages could not be fetched from the
  engineering environment). Unknown schedule is not reported as zero unlock.

## Ranked remaining levers (evidence × utility × bounded cost)
1. Holders Ethereum (9 rows × 4 fields): full census engine for chain 1 — PR #339 (real-chain proof in progress).
2. Holders PONS (4 fields): exact reconciliation proven at 105,765 (PR #343); needs a release decision on `ARC_HOLDER_MAX_WALLETS`.
3. `liquidityUsd` (36 rows): needs a background, budgeted multi-pool verifier and V4 TVL support; not a request-path change.
4. `priceUsd` quote assets (5 rows): WBTC via Chainlink ENS feeds; USDG/NVDA have no permitted USD reference.
5. Mechanics no-source (18 rows): requires a licensed explorer source or publisher-verified sources.
