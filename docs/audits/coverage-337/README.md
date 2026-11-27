# #337 coverage audit — fixed 40-token cohort, all Search card fields (27 Nov 2026)

Measured, not estimated. Source of truth: `production-baseline-20261127.json` (743 rows) produced by
`scripts/coverage-matrix.cjs` against **production** (`www.arcyusdc.xyz`, main `8b25d75`) at 2026-11-27T15:49:05Z (2.5 s pacing), CI run on PR #338. A first run at 13:35Z (1.5 s pacing) lost 3 reports to production HTTP 502/429 and gave 371/743 VERIFIED; it is superseded.
Tiers use the existing `verified-coverage.tierOf` taxonomy: VERIFIED = on-chain or cross-verified; SOURCE_BACKED = single
fresh source; NOT_VERIFIED = no admissible evidence. **No denominator exclusions** are applied in this matrix.

## Denominators
- Fixed cohort: 40 tokens (Arc 10, Ethereum 10, Robinhood 10, Pons 10 on chain 4663), 5 data cards × 4 fields = **20 fields/token**
  (`activity`, `holders`, `liquidity`, `mechanics`, `supply`; the sixth card “Claim vs Reality” has no field-level metrics).
- Reports returned: **40/40 HTTP 200**. Rows: 40 × 20 = **800**.

## Baseline (production)
**Overall: 401 VERIFIED / 800 (50.1 %), 366 SOURCE_BACKED, 32 NOT_VERIFIED, 1 CONFLICTING.**

| Section | VERIFIED | SOURCE_BACKED | NOT_VERIFIED | Rows |
|---|---|---|---|---|
| arc | 107 (53.5%) | 77 | 16 | 200 |
| ethereum | 79 (39.5%) | 114 | 7 | 200 |
| robinhood | 108 (54.0%) | 85 | 7 | 200 |
| pons | 107 (53.5%) | 90 | 2 | 200 |

| Field | VERIFIED | SOURCE_BACKED | NOT_VERIFIED | other | Rows |
|---|---|---|---|---|---|
| `activity.change24h` | 0 | 40 | 0 | 0 | 40 |
| `activity.priceUsd` | 30 | 9 | 0 | 1 | 40 |
| `activity.valuation` | 0 | 40 | 0 | 0 | 40 |
| `activity.volume24h` | 0 | 40 | 0 | 0 | 40 |
| `holders.holderCount` | 29 | 10 | 1 | 0 | 40 |
| `holders.largestWalletPct` | 29 | 10 | 1 | 0 | 40 |
| `holders.top10Pct` | 29 | 10 | 1 | 0 | 40 |
| `holders.top20Pct` | 29 | 9 | 2 | 0 | 40 |
| `liquidity.dexPairCount` | 0 | 40 | 0 | 0 | 40 |
| `liquidity.liquidityTurnover24h` | 0 | 33 | 7 | 0 | 40 |
| `liquidity.liquidityUsd` | 1 | 39 | 0 | 0 | 40 |
| `liquidity.volume24h` | 0 | 40 | 0 | 0 | 40 |
| `mechanics.contractArchitecture` | 40 | 0 | 0 | 0 | 40 |
| `mechanics.mintCapability` | 12 | 20 | 8 | 0 | 40 |
| `mechanics.ownerAdmin` | 13 | 22 | 5 | 0 | 40 |
| `mechanics.tradingTaxes` | 29 | 4 | 7 | 0 | 40 |
| `supply.burnAddressBalance` | 40 | 0 | 0 | 0 | 40 |
| `supply.burnAddressPct` | 40 | 0 | 0 | 0 | 40 |
| `supply.nonBurnSupply` | 40 | 0 | 0 | 0 | 40 |
| `supply.totalSupply` | 40 | 0 | 0 | 0 | 40 |

## Why rows are not VERIFIED (production, per field)

### Holders (holderCount VERIFIED 29/40)
- Arc 10/10, Robinhood 10/10, Pons 9/10: **signed COMPLETE census** (VERIFIED).
- Ethereum 0/10: no Ethereum census on main; 9 explorer counts (Blockscout, SOURCE_BACKED), LINK NOT_VERIFIED in this run.
- PONS `4663:0x39dbed…`: Blockscout PRO count (SOURCE_BACKED); census NOT_VERIFIED because its positive ledger (~105.7k) exceeds
  the 100,000 budget. PR #343 measured an exact reconciliation at 105,765 (no publication).

### Liquidity / activity (single-source DEX Screener, on-chain cross-check per token)
`liquidityUsd` on-chain cross-check result for all 40 (same production run):

| On-chain cross-check result | Tokens |
|---|---|
| `LIQUIDITY_SCOPE_EXCEEDS_BUDGET` | 23 |
| `POOL_TVL_UNSUPPORTED_V4` | 7 |
| `QUOTE_ASSET_UNSUPPORTED` | 4 |
| `no cross-check recorded` | 2 |
| `TOKEN_USD_UNVERIFIED` | 2 |
| `AGREE` | 1 |
| `ONCHAIN_BUDGET_EXHAUSTED` | 1 |

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
