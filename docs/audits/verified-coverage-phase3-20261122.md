# ARCY Data Engine — Phase 3 (PR #317, draft; not merged, not deployed, no flag changed)

## Final measurement — fixed cohort 40 tokens × 12 metrics, real chains (run on ea57aee)

- **A** = current `main` (Phase 2) with `SEARCH_MARKET_ONCHAIN_CHECK=on`.
- **B** = this branch with the same flag plus `SEARCH_MARKET_ONCHAIN_VOLUME=on`.
- Each token is requested from both engines, in alternating order, after one unrecorded warm-up pass for both.
- Both engines read the same chain-4663 census publications, so the census progress made here counts on both sides.

| | Verified | Current evidence |
|---|---|---|
| Pre-#316 baseline (frozen) | 18.75% | 75.0% |
| A: Phase 2 main | 40.42% | 88.54% |
| B: Phase 3 | **40.83%** | **88.54%** |

| Network | A | B |
|---|---|---|
| Arc | 28.33% | 28.33% |
| Ethereum | 27.50% | 27.50% |
| Robinhood | 53.33% | 54.17% |
| Pons | 52.50% | 53.33% |

| Metric | A | B |
|---|---|---|
| priceUsd | 62.5% | 67.5% |
| liquidityUsd | 2.5% | 2.5% |
| volume24h | 0% | 0% |
| totalSupply | 100% | 100% |
| holders (4 metrics) | 47.5% each | 47.5% each |
| tradingTaxes | 2.5% | 2.5% |
| mintCapability | 12.5% | 12.5% |
| ownerAdmin | 15% | 15% |
| contractArchitecture | 100% | 100% |

Holder coverage rose from 45% to 47.5% on both sides: AI finished from its checkpoint.

Report latency was median 6.0 s on B and 6.3 s on A, measured during the warm-up-loaded run. Earlier runs: B 1.1–1.4 s, A 1.1 s.

**Evidence drops in the final run** (repeated twice from both engines):
- KAIRO holders: A and B both SOURCE_BACKED on the repeats, so this is provider drift.
- COFR price: B VERIFIED 2/2 vs A SOURCE_BACKED 2/2, so B is better.
- No mechanics drop.

## P0 — production reliability

**Disk:**
- Every holder file now goes through `holder-disk.atomicWrite`: fsync before rename, directory fsync, temp file removed on any failure.
- A free-space reserve guard (64 MB plus 2× the write, `ARC_HOLDER_DISK_RESERVE_MB`) refuses a write with `STORAGE_LOW_DISK` and keeps the previous file.
- An orphan-temp sweep runs at worker start.
- Before this, an ENOSPC left `*.tmp` files behind indefinitely.
- `/holder/rpc-diagnostics` (Bearer) now reports, separately:
  - the volume's statfs capacity and free space;
  - the bytes per category: candidate checkpoints, ledger checkpoints, queue, publications, orphan temp files;
  - the largest files.
- Chain-4663 ledgers keep only non-zero balances.
- Measured in CI with all 20 chain-4663 tokens: 20 ledger checkpoints = 27.6 MB (largest 1.35 MB), 19 publications = 95 KB, RSS 171 MB, heap 18 MB.
- The Railway 500 MB volume and its container disk metric could not be read from this session (no Railway access). The diagnostics route now exposes the volume figures there.

**Resume:**
- In CI, checkpoints persist across runs (same role as the Railway volume). The last run resumed 20/20 tokens from their stored cursors; none restarted from block 0.
- AI completed: 59,107 holders, resumed from block 65,942,364, reconciled exactly to `totalSupply`.
- PONS has a complete ledger but stops at `BALANCE_RECONCILIATION_BUDGET_EXCEEDED`: more than 100,000 positive holders, which is the worker's read bound. Nothing is published, as designed.

**429 / pacing:**
- AIMD pacing is shared by all calls of a chain client.
- The first version (×2 per 429, max 4 s) collapsed throughput: 5,039 calls in 76 min.
- Current rule: ×1.5 per 429, −20% every 10 successes, max 1 s. Final census: 16,364 calls, 223 × HTTP 429 (1.4%, down from 4.9% in Phase 2), 19/20 complete.
- Arc 5042 defaults are untouched; the Arc scope never creates this client.

**Stale data:** signed snapshots older than 1 h stay `LAST_VERIFIED`, never counted as current (Phase 2 rule, unchanged).

## P1 — the six regressions from the Phase 2 A/B

| Field | Cause | Decision |
|---|---|---|
| Ethereum taxes / mint / owner (CVX, API3) | Repeats are SOURCE_BACKED on both engines: provider drift. | Evidence kept; no code change. |
| Robinhood taxes / mint (TAO) | **Real, caused by Phase 3's first volume engine:** in-request Swap-log reads competed with Mechanics on the same public RPC (2/2 repeats; main kept the evidence). | Volume removed from the request path. Final run: no mechanics drop. |
| Pons price (HALBROOK) | **Real disagreement:** same V4 pool, DEX Screener 0.00003386 USD vs chain 0.0000359765 USD (5.9% > 3% tolerance). | Kept CONFLICTING, never promoted. |
| ORBIO holders (Phase 3 run) | Measurement bias: main was always asked first, so rate-limited Blockscout answered the branch 403 (2/2). | A/B order now alternates per token. |

## P2 — 24h volume engine (`market-volume.js`)

What the engine does:
- Uses Swap logs of V2, V3 and V4 pools. V4 logs come from the PoolManager with topic1 = poolId, and the PoolKey is hash-proven.
- The window ends at a pinned block and starts at the first block whose timestamp is ≥ end − 86,400 s.
- Both window anchors are re-read; a reorg fails closed.
- Logs are de-duplicated by (blockHash, logIndex), removed logs are rejected, and windows split on RPC limits.
- USD value = quote-side amounts × the current Chainlink quote USD (not historical per-swap prices).
- A pool with zero swaps counts as exactly 0. Swaps against an unsupported quote fail closed.

Real-chain probe:
- COFR (Pons): 276 swaps, AGREE with DEX Screener at a 3.05% difference.
- The other tokens are blocked for these reasons:
  - Provider pool scope above 12 pools (18 tokens).
  - Swaps against an unsupported quote such as USDG or another memecoin (13 tokens).
  - Arc: 24 h ≈ 172,800 blocks against public-RPC log ranges of a few thousand blocks → `VOLUME_WINDOW_EXCEEDS_RPC_BUDGET` (10 tokens).

To protect Mechanics, volume now runs only in an opt-in, paced (300 ms), sequential background queue per chain with a 5-minute cache. In the final A/B no volume value reached a report (0%).

## P3 — liquidity

- USDS (Ethereum) is now a supported quote. The Chainlink feed is resolved on-chain from ENS `usds-usd.data.eth`, and `description()` must equal "USDS / USD"; no address is hard-coded.
- USDG stays unsupported. No Chainlink USDG/USD feed was found, and the Paxos primary documentation did not show the Robinhood contract address. Treating USDG as $1 would be an assumption, not a verified price.
- V4 per-pool TVL (tick accounting) was not implemented; liquidity stays 2.5%.

## P4 — mechanics

- No new mechanics inference was added.
- Mechanics benchmark: green on every Phase 3 commit.
- The benchmark now also triggers on shared transport and scope files (`lib/core.js`, `lib/search-request.js`, `lib/holder-chains.js`). A `core.batch` change had regressed CRA in #316 without touching any mechanics file.
- The browser regression now also triggers on the market engines.

## Tests

- `npm test` 1618/1618.
- Green: Mechanics before/after benchmark, browser regression (render), Docker smoke, public API smoke, ARCY Search Regression, real-chain probe and A/B.

## Production steps (need authorization; none done)

1. Railway: `ARC_HOLDER_CHAINS=5042,4663`.
2. Vercel: `SEARCH_MARKET_ONCHAIN_CHECK=on`; optionally `SEARCH_MARKET_ONCHAIN_VOLUME=on`.
3. Merge #317, then deploy.
