# ARCY Radar — Verified Data Coverage Evaluation (2026-11-21)

**Result: 98% verified coverage is NOT reached. Measured verified coverage = 18.75%; evidence coverage (any real source) = 77.5%.**
Nothing was fabricated, no unavailable field was turned into zero, and no estimate is labelled verified to raise these numbers.

## Definition (reproducible)

- Cohort: `data/verified-coverage/radar-cohort-20261121.json` — the 40 tokens Production Radar showed (Top 10 × arc / ethereum / robinhood / pons) in data-branch snapshot `2026-11-21T08:19:39.870Z`.
- 12 core fields per token (`search/server/lib/verified-coverage.js`, `arcy-verified-coverage-1`):
  - MARKET: price, liquidity, volume 24h
  - SUPPLY: total supply
  - HOLDERS: holder count, largest wallet %, top 10 %, top 20 %
  - MECHANICS: trading taxes, mint capability, owner/admin, contract architecture
- Only inapplicable field: `top20Pct` when the verified holder count is below 20.
- **Verified** means the evidence class is `ON_CHAIN_VERIFIED` or `CROSS_VERIFIED` (two independent providers agree within tolerance), using the existing `evidence-class.js` taxonomy.
- **Evidence coverage** means verified, single-source or historical (a real value from a named source).
- Reproduce: `ARCY_BASE=https://<host> node scripts/radar-verified-coverage.cjs` (read-only, paced 2.7 s, below the 24/min limiter). In CI: workflow `Radar verified data coverage (read-only)`.

## A. Network table (Production, run 44895687878, 40/40 reports, 0 failed)

| Network | Discovered (v4 candidates) | Evaluated (deduplicated) | Eligible (QUALIFIED) | Shown | Holder count coverage | Indexing completeness | Whale coverage | Mechanics coverage | Verified / evidence % | Snapshot section time |
|---|---|---|---|---|---|---|---|---|---|---|
| arc | 86 | 86 | 3 | 10 | 8/10 (historical) | 8 HISTORICAL_SNAPSHOT (complete census, older block), 2 UNAVAILABLE | 8/10 historical | see field table | 20% / 55% | 2.8 s |
| ethereum | 90 | 84 | 3 | 10 | 10/10 single-source | 10 RECONCILED_CANDIDATES (top-21 reconciled against RPC, not a full census) | 10/10 candidate-based | see field table | 21.67% / 86.67% | 2.4 s |
| robinhood | 77 | 77 | 5 | 10 | 10/10 | 9 RECONCILED_CANDIDATES, 1 COUNT_ONLY | 9/10 | see field table | 15.83% / 79.17% | 13.3 s |
| pons | 28 | 28 | 11 | 10 | 10/10 | 10 RECONCILED_CANDIDATES | 10/10 | see field table | 17.5% / 89.17% | 0.1 s |
| **All** | 281 | 275 | 22 | 40 | | | | | **18.75% / 77.5%** | |

"Before" and "after" are equal by design. This PR adds census transparency, infrastructure role proofs (behind a flag, off by default) and measurement. It does not change any value or evidence class, so it cannot honestly move the percentage.

The Preview measurement for this branch could not run: every request to the Vercel Preview returned **HTTP 401** (deployment protection). The repo's CI policy forbids storing bypass tokens. See blocker B6.

### By family / field (verified / evidence)

| Family | Verified | Evidence |
|---|---|---|
| MARKET | 0% | 100% |
| SUPPLY | 100% | 100% |
| HOLDERS | 0% | 66.9% |
| MECHANICS | 31.3% | 65.6% |

| Field | Verified | Evidence |
|---|---|---|
| holderCount | 0% | 75% |
| largestWalletPct | 0% | 72.5% |
| top10Pct | 0% | 72.5% |
| top20Pct | 0% | 47.5% |
| tradingTaxes | 2.5% | 52.5% |
| mintCapability | 12.5% | 52.5% |
| ownerAdmin | 15% | 62.5% |
| contractArchitecture | 95% | 95% |

Real-chain role probe (Ethereum block `0x193caf7`, ranked holder candidates):

| Role | Count |
|---|---|
| Externally owned address (EOA) | 72 |
| Unknown contract | 45 |
| Liquidity pool (SKY, Uniswap V2, proven by factory round-trip) | 1 |
| Uniswap v4 PoolManager | 1 |
| Burn | 1 |

## B. Blockers per field (root cause → remediation)

| # | Field(s) | Root cause | Remediation | Needs |
|---|---|---|---|---|
| B1 | price, liquidity, volume 24h (0% verified) | The two-provider cross-check (`market-cross.js`, DEX Screener + GeckoTerminal, tolerance 3% / 10% / 30%) already exists. It is fail-closed behind `SEARCH_MARKET_CROSSCHECK_APPROVED=true` because GeckoTerminal's terms for this use have not been reviewed, so every market field is single-source. | Owner reviews GeckoTerminal terms and sets the flag. Expected effect: liquidity and price become CROSS_VERIFIED wherever both providers index the same pools. Volume will remain partly single-source because the providers' 24h windows differ. | **Owner authorization** (third-party terms; one extra request per report) |
| B2 | holder count, largest wallet, top 10/20 on Ethereum, Robinhood and Pons (0% verified) | Values come from an explorer (Blockscout), with balances re-read over RPC at a pinned block: SOURCE_REPORTED_RPC_RECONCILED, which is single-source. A full census needs the complete Transfer history. For large Ethereum tokens that is infeasible without an indexer. | Robinhood/Pons (chain 4663): extend the existing Railway Arc holder worker (signed COMPLETE census) to chain 4663. That makes them ON_CHAIN_VERIFIED. Large Ethereum tokens: keep them honestly labelled RECONCILED_CANDIDATES; a full census would require a paid indexer. | Worker deploy (production change → authorization); an Ethereum indexer would be a cost → authorization |
| B3 | Arc holders (8 historical) | The worker's signed census is complete but from an older block, so it is not current. | Schedule worker refreshes for the Radar cohort, at least for shown tokens. | Railway production change → authorization |
| B4 | Arc holders (2 unavailable) | No worker snapshot exists for those tokens. | Same as B3: enqueue on Radar display. | As B3 |
| B5 | taxes, mint, owner/admin | Contracts whose source is not verified, and non-standard contracts. The engine refuses to infer behaviour from bytecode beyond proven patterns, which is correct. | Extend proven bytecode/state checks (owner() / getOwner / AccessControl role-member reads at a pinned block) for unverified contracts. Taxes stay NOT_VERIFIED unless the source or a sell simulation proves them. | Engineering; no cost |
| B6 | Preview measurement | Vercel Deployment Protection returns 401 on Preview. CI may not hold bypass tokens. | Owner runs the workflow with a bypass locally, or temporarily allows `/api/search` on Preview. | Owner |
| B7 | top 20 % for tokens with fewer than 20 holders | Not a gap: marked inapplicable, never zero. | — | — |

Realistic ceiling with B1–B4 authorized and done, estimated from the field table and not measured: roughly 55–65% verified. MECHANICS on unverified contracts and Ethereum full census cap it well below 98% without a paid indexer.

## C. Source changes (PR #316)

- `search/server/lib/holder-intelligence.js` (new):
  - census state;
  - raw concentration plus infrastructure-adjusted concentration, computed only when infrastructure is proven;
  - on-chain role proofs: eth_getCode, EIP-7702, exact v4 PoolManager, V2/V3 factory round-trip;
  - unproven roles are recorded as UNKNOWN.
- `search/server/lib/large-holders.js`: role classification behind `ARCY_HOLDER_ROLE_ONCHAIN=true` (default off), wrapped in try/catch.
- `search/server/lib/data-engine.js`:
  - holder candidates accept proven roles only when the evidence block equals the row block; otherwise the list is rejected;
  - adds an additive `holderIntelligence` on the holders card;
  - the four holder fields and the response contract are unchanged.
- `search/server/lib/verified-coverage.js`, `scripts/radar-verified-coverage.cjs`, `scripts/holder-role-probe.cjs`, `.github/workflows/radar-verified-coverage.yml`, `data/verified-coverage/radar-cohort-20261121.json`: measurement (read-only).
- `test/holder-intelligence-coverage.test.js`.

UI lock hashes were not touched, and no Top 40 / Top 10 logic changed.

## E. Rollback

Revert the PR. Production behaviour does not change while `ARCY_HOLDER_ROLE_ONCHAIN` is unset, and `holderIntelligence` is an additive key.
