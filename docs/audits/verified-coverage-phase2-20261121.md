# ARCY Data Engine — Phase 2: real coverage improvement (2026-11-21)

PR #316, branch `feat/data-engine-holder-mechanics-coverage`. Draft; not merged, not deployed, no environment flag changed.

## What changed (data engine, not presentation)

| Area | Change | Evidence it is real |
|---|---|---|
| Market | `market-onchain.js`: the provider's own pool(s) are re-read on-chain at one pinned block. V2 `getReserves`; V3 `slot0` plus pool balances; V4 `StateView.getSlot0` with a PoolKey proven by `keccak256(abi.encode(PoolKey)) == poolId`. The PoolKey comes from `PositionManager.poolKeys(bytes25)`, with the Initialize log as fallback. Quote USD comes only from Chainlink feeds whose `description()` and freshness are checked at read time. Wired into `market-cross` as the secondary when GeckoTerminal is not approved, and bridged onto Arc's legacy field only when it is the identical DEX Screener observation (≤0.5%). | Fixed cohort, public RPC: price AGREE on 32/40 tokens (Δ 0.01–0.5%). 0 DISAGREE. Avg 10.2 RPC calls, median 0.94 s, p90 1.3 s. |
| Holders | Chain 4663 (Robinhood + Pons, one index per contract) runs the existing durable architecture: storage, leases, queue, `holder-index.advance` Transfer ledger, `balance-reader`, Ed25519 publication. A chain scope (`holder-chains.js`) adds a throttled RPC client, measured RPC limits, adaptive windows, a confirmation depth and reorg rebuild. Ledger balances must equal the pinned `balanceOf` reads, and their sum must equal `totalSupply()`. Search uses a CURRENT signed 4663 publication before explorer data. | First CI run: 8/20 tokens COMPLETE and published (e.g. TORCH 4,086 holders, FLOCK 3,827, FOBO 1,618), each reconciled exactly. |
| Holders, Arc | Signed snapshots completed ≤1 h ago are now `FRESH` (current); older ones stay `LAST_VERIFIED` (historical). Before, every signed snapshot was labelled historical. | Rule is unit-tested. Production effect depends on worker freshness. |
| Mechanics | Exact Solady LibClone 44-byte immutable forwarder recognised. This was the root cause of `ARCHITECTURE_TARGET_UNRESOLVED` for STATICS and AI. | Real bytecode from the chain-4663 probe. |
| Audit corrections | (1) evidence coverage = current evidence only; historical and stale are reported separately. (2) `top20Pct` leaves the denominator only with a complete, current census count. (3) Role proofs have a strict budget (36 calls / 2.5 s) and a profile. (4) `compare()` gives fixed-cohort per chain × per metric deltas. (5) A/B requests are interleaved per token. | Unit tests COV-1/COV-4/HI-5. |

## Measured results — fixed cohort (40 tokens × 12 metrics), interleaved A/B, same CI environment

Run 44913901690 (head f53cb0d). Main and the branch were served from the same runner. Each token was requested from both within ~1 s, 0 report failures on either side.

| Network | Verified before | Verified after | Current evidence before → after |
|---|---|---|---|
| arc | 20.00% | 28.33% | 70.00% → 68.33% |
| ethereum | 21.67% | 27.50% | 94.17% → 94.17% |
| robinhood | 15.83% | 53.33% | 66.67% → 88.33% |
| pons | 17.50% | 55.00% | 70.00% → 91.67% |
| **All** | **18.75%** | **41.04%** | **75.21% → 85.63%** |

| Metric | Before | After |
|---|---|---|
| priceUsd | 0% | 80% (32/40; on-chain pool price agrees with DEX Screener on the same pool) |
| liquidityUsd | 0% | 2.5% |
| volume24h | 0% | 0% |
| totalSupply | 100% | 100% |
| holderCount | 0% | 45% (18/40; complete 4663 census) |
| largestWalletPct | 0% | 45% |
| top10Pct | 0% | 45% |
| top20Pct | 0% | 45% |
| tradingTaxes | 2.5% | 2.5% |
| mintCapability | 12.5% | 12.5% |
| ownerAdmin | 15% | 15% |
| contractArchitecture | 95% | 100% |

Evidence drops between A and B: two Arc holder fields of one token (signed-publication source unavailable in that moment). No other field lost evidence.

**Production baselines:**
- Production at freeze: 18.75% (run 44895687878).
- The CI main engine matches it at 18.75%.
- Production cannot show the gain until the opt-in flags are enabled and deployed.

### Cost and latency (real chain)

| Item | Calls | Time | Failures and throttling |
|---|---|---|---|
| Market on-chain check | 10.2 per report (≤24 budget) | median 0.94 s, p90 1.3 s; cached 30 s | isolated: a failure only adds a reasonCode |
| Chain-4663 first full build (20 tokens) | 22,178 | 90 min | 1,091 HTTP 429 (4.9%), retried with backoff (733 s total); 757 range-limited windows split |
| Chain-4663 refresh | about 1–2 log windows + ⌈holders/200⌉ Multicall reads per token | — | — |
| Report latency | — | median 1.10 s branch vs 1.12 s main; p90 3.5 s vs 3.8 s | — |

The first full build covered 18 tokens COMPLETE and 2 still building: AI and PONS, which have the heaviest histories, up to 4.2M Transfers. 18/18 completed tokens reconciled exactly. The largest, STONKBROKER, has 44,158 holders.

**Arc span proofs (read-only):**
- CRA: 7,233 calls, 94 min. 3,819 candidates reconciled exactly.
- ARCANUS: 7,267 calls, 94 min. 5,897 candidates reconciled exactly.
- Both were FAILED in production with `HOLDER_RPC_DISCOVERY_SPAN_EXCEEDED`. Identity-bound `BENCHMARKED_SPANS` entries were added, following the #187/#262 procedure.

## Remaining blockers (honest)

- **24h volume:** needs swap-log aggregation per pool; it stays single-source.
- **Liquidity:** the provider sums up to 30 pools. Most include V4 pools, whose per-pool TVL needs tick accounting, so on-chain verification succeeds only when every pool is V2/V3 and within budget (1/40 today).
- **Unsupported quote assets:** USDS (SKY), USDG (Robinhood stable), NVDA tokens. No Chainlink USD feed is wired for them, and none was added without a verified address.
- **V4 pools without a PositionManager registration:** oBrain, FOBO. The full-range Initialize-log query exceeds the public RPC limits.
- **Mechanics, unverified or unreviewed source:** taxes, mint and owner stay NOT VERIFIED. Simulated 0% transfers are not accepted as proof of no tax (the existing producer policy is "positive only").
- **Chain-4663 heaviest histories (AI, PONS):** not finished inside the 90-min CI budget; the continuous worker resumes from checkpoints.
- **Ethereum holders:** a full census of large tokens needs an indexer; candidates stay `RECONCILED_CANDIDATES`.
- **Production deployment:**
  - `SEARCH_MARKET_ONCHAIN_CHECK=on` (Vercel) and `ARC_HOLDER_CHAINS=5042,4663` (Railway) are opt-in flags and need owner authorization.
  - Merging and deploying also need authorization.

## Mechanics benchmark regression (CRA) — root cause and fix (commits a131542, 40dbcb8)

- **Symptom:** In the paired replay, CRA (`0x7085…f6f4`) `tradingTaxes` moved from "Buy 1% · Sell 1% · Transfer 0%" (`ON_CHAIN_VERIFIED_UNITS`) to "Transfer 0% · DEX/hook fees NOT VERIFIED".
- **Before/after evidence:**
  - main replay: 36 RPC requests, 0 replay misses.
  - branch replay: 62 RPC requests, **18 replay misses**.
- **Root cause:** a Phase-2 change made `core.batch` split every JSON-RPC batch into single calls whenever a scoped RPC existed. The Arc legacy mechanics path runs inside `search-request.withRpc`, so its batches changed shape and volume. The pinned storage reads of the reviewed tax formula were lost, and the engine fell back to the weaker template conclusion. The same change would have multiplied Arc RPC volume in production.
- **Old evidence is valid:**
  - The branch's live run reproduces "Buy 1% · Sell 1%" with `ON_CHAIN_VERIFIED_UNITS`.
  - The value depends on live provider answers: main's own live run on 40dbcb8 returned the weaker form.
  - Nothing was restored from stored data.
- **Fix:** batches are re-routed only inside a non-Arc holder-chain scope (`holder-chains.client()`), where the Arc transport would answer from the wrong chain. Arc search scopes keep the original batch transport (test HC-9). After the fix, CRA replay shows 37 requests, 0 misses, identical to main.
- **Second gate failure:** the gate flagged STATICS for "proxy-binding reads on a contract not newly bound". Main had `ARCHITECTURE_TARGET_UNRESOLVED`; the branch binds STATICS through the exact Solady 44-byte forwarder. That transition is now recognised as newly bound. The 8-read budget, pinning, the "previously verified field" correctness gate and all other request checks are unchanged; gate tests cover acceptance, budget overflow, non-forwarder text and already-resolved targets.

## Re-run on the latest commit 40dbcb8 (run 44925113539, interleaved A/B, real chains)

**Verified coverage: 17.71% → 39.38%. Current evidence: 76.04% → 85.63%.** Each side had one HTTP 502 report, on different Ethereum tokens.

| Network | Before | After |
|---|---|---|
| arc | 20.00% | 26.67% |
| ethereum | 17.50% | 25.00% |
| robinhood | 15.83% | 53.33% |
| pons | 17.50% | 52.50% |

| Metric | Before | After |
|---|---|---|
| priceUsd | 0% | 67.5% (standalone probe on the same commit: 31/40 AGREE, 0 DISAGREE) |
| liquidityUsd | 0% | 0% |
| volume24h | 0% | 0% |
| totalSupply | 97.5% | 97.5% |
| holderCount / largestWalletPct / top10Pct / top20Pct | 0% | 45% each (18/20 chain-4663 censuses) |
| tradingTaxes | 2.5% | 2.5% |
| mintCapability | 10% | 12.5% |
| ownerAdmin | 12.5% | 15% |
| contractArchitecture | 90% | 97.5% |

**Census:** 18/20 COMPLETE and published; 21,783 calls, 826 HTTP 429 retried.

**Evidence drops (B below A):**
- 14 come from the single HTTP 502 report on one Ethereum token.
- 5 are provider drift on Arc: one token's signed publication, one token's Sourcify source.
- 2 are on a Robinhood implementation-unresolved token.
- None is a value change on verified data.
