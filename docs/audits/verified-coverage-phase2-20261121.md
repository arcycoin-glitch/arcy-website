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

## Measured results

See the PR description for the final interleaved A/B tables. They come from the same CI environment, main vs branch, the same 40 tokens at the same moments.

## Remaining blockers (honest)

- **24h volume:** needs swap-log aggregation per pool; it stays single-source.
- **Liquidity:** the provider sums up to 30 pools. Most include V4 pools, whose per-pool TVL needs tick accounting, so on-chain verification succeeds only when every pool is V2/V3 and within budget (1/40 today).
- **Unsupported quote assets:** USDS (SKY), USDG (Robinhood stable), NVDA tokens. No Chainlink USD feed is wired for them, and none was added without a verified address.
- **V4 pools without a PositionManager registration:** oBrain, FOBO. The full-range Initialize-log query exceeds the public RPC limits.
- **Mechanics, unverified or unreviewed source:** taxes, mint and owner stay NOT VERIFIED. Simulated 0% transfers are not accepted as proof of no tax (the existing producer policy is "positive only").
- **Ethereum holders:** a full census of large tokens needs an indexer; candidates stay `RECONCILED_CANDIDATES`.
- **Production deployment:**
  - `SEARCH_MARKET_ONCHAIN_CHECK=on` (Vercel) and `ARC_HOLDER_CHAINS=5042,4663` (Railway) are opt-in flags and need owner authorization.
  - Merging and deploying also need authorization.
