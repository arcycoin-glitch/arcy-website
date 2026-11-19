# Radar V5 — Quality Discovery Engine (#279, PR #295, 2026-11-19/20)

## Design
- **Filter A — Early Discovery:** the existing V3/V4 engine, unchanged in order and gates (QUALIFIED → NEAR_MATCH → MONITOR_ONLY; SCORE column `arcy-discovery-2`). V5 changes only these selection rules:
  - Extreme-move rule on every network: a 24h move of +70 % or more, or −50 % or less, is not shown. Before V5 this applied on Arc and Ethereum only.
  - A MONITOR_ONLY row needs sourced exact-contract artwork on every network.
  - Cross-tab look-alike guard: a Robinhood near-match or monitor row may not carry the ticker of a different, factory-verified Pons launch on the same chain.
  - "GameStop" added to the unverified-issuer-brand list.
- **Filter B — Quality Expansion:** fills only slots Filter A left empty, after every Filter A row; it never displaces one. It does not run on Pons.
  - **Sources:** only rows V4 removed solely as `NOT_EARLY_STAGE_CATEGORY` in ESTABLISHED_BLUE_CHIP, ESTABLISHED_LARGE_CAP or MATURE_LEGACY_MARKET.
  - **Segments:** ESTABLISHED_PROJECT, GROWING_PROJECT (pool 30–365 days, measured category) or EMERGING_MOMENTUM (volume accelerating while price has not run).
  - **Gates:**
    - no persistent risk hold or critical risk; no contradiction, conflict or engine error;
    - V3 class QUALIFIED or NEAR_MATCH;
    - liquidity ≥ network floor; volume ≥ 50 % of floor; turnover ≤ 5×; ≥ 10 trades;
    - 24h change between −30 % and +40 %; pool age verified;
    - measured large caps also need an independent cross-check, a ≥ 30-day pool and a unique ticker;
    - sourced artwork; Quality Ranking ≥ 40.
  - **Never used:** stablecoins, wrapped, bridged, commodity-backed, tokenized equity, legacy memes, identity-blocked contracts.
- **Quality Ranking `arcy-quality-rank-1`:** separate and versioned. Weights: liquidity/exit 25, organic growth 20, identity/development 20, source consistency 15, momentum before price 15, upcoming events 5.
  - Missing data earns 0 and is listed.
  - A 24h move of +30 % or more earns no momentum.
  - Shown in Info on every row; it orders Filter B only.
  - The 40 minimum was chosen against the real Ethereum candidates below; it rejected 3 of 7 otherwise-eligible established rows.
- **Discovery expansion (builder only):** `source=legacy-v3&discovery=v5-expanded`.
  - Ethereum reads top 1–2 and trending 1–2; Arc Demo reads top 1–3.
  - Credits are reserved before the call: Ethereum 6, Arc 5, previously 4. Expansion pages are optional.
  - Visitor requests are unchanged.
- **Logos:** the builder cross-check adopts DEX Screener artwork only for the exact base-token contract.

## Measured (CI run on PR #295, commit 0faefaf, same Production legacy-V3 input for both engines)
| Network | V4 now (main code) | V5 Filter A | V5 Filter B | Total | Main exclusions |
|---|---:|---:|---:|---:|---|
| Arc | 6 | 6 | 0 | 6 | 23 already-spiked, 7 duplicate tickers, 4 no market, 3 too far, 1 AF risk hold, 1 identity |
| Ethereum | 3 | 3 | 2 (AAVE, SKY) | 5 | 11 non-early categories (B: 2 legacy meme, 1 commodity, 1 wrapped, 3 below Q40, 2 V3 gates), 9 thin liquidity, 3 source conflicts, 4 risk/identity |
| Robinhood | 10 | 9–10 | 0 | 9–10 | 4 tokenized equities, risk hold (MOW) via the production ledger, anonymous monitor row (BSWQ) |
| Pons | 10 | 10 | — | 10 | — |

- **Live Production (V4, main `8782b47`, browser, 2026-11-19 20:4x UTC):** Arc 4, Ethereum 3, Robinhood 10, Pons 10.
- **Expanded discovery on keyless CI sources (Arc and Ethereum only):**
  - Arc: 47 → 65 unique candidates, but still 4 shown: 21 already spiked and 14 duplicate tickers.
  - Ethereum (expanded input): 7 shown = 3 A + 4 B (SKY, AAVE, ENA as Established/Emerging, ADI as Growing).
  - The keyless CI tier rate-limited Ethereum's trending page 2 and its new-pools page, so that run is a lower bound.
- **Cost:**
  - Engine 34 s (V5) against 63 s (V4) on the same input.
  - RPC: Arc 47, Ethereum 34, Robinhood 69. Blockscout 8, GitHub 13, 2 batched DEX Screener cross-checks.
  - Expansion: +2 GeckoTerminal credits per Ethereum builder read, +1 per Arc builder read (every 4 h).
- **Serving path:** unchanged — one cached snapshot read with no provider call. Production p50 is about 175–195 ms and p95 about 190–440 ms (browser, 6 requests per network).
- **Real-data defects found and fixed during Preview:**
  - Robinhood WOOD at −71 % was in the list.
  - Robinhood GATO 0x0ebf… was a look-alike of the verified Pons GATO 0xd36a….
  - Robinhood BSWQ was a monitor row without a logo.
  - Ethereum "GameStop" GME was a monitor row.

## Verification
- `npm test`: 1471/1471.
- `test/radar-v5-quality.test.js`: 15 tests covering SHARK/Gamooor/Louie/WASTED, the AF hold, categories, liquidity and churn, look-alikes, ranking semantics, snapshot order and labels, carry-forward, an end-to-end run, artwork provenance, Pons, the cross-tab guard and GameStop.
- Preview data branch `radar-v4-snapshots-preview` @ `947ab7d…`: validated by the serving code after publish.
- Production `/radar` page rendering the Preview served responses (fetch interception, no deployment change), at 390 and 320 px:
  - no horizontal overflow (scrollWidth equals the viewport);
  - the Filter B Info popup fits and reads "KALİTE GENİŞLEMESİ (Filtre B) — YERLEŞİK PROJE, erken aşama keşfi DEĞİLDİR …".

## Limitations
- Ten rows per network is a target, not a promise. Arc's provider window is dominated by already-spiked and duplicate-ticker contracts.
- Holder concentration, mint/pause/admin and exit simulation are still read on-chain only for a few early-stage contracts per run. Filter B rows say this in "Eksik kanıt".
- No 7-day volume history is stored. Momentum before price uses the provider's 1h/6h/24h windows only.
- Official website/X logos are not fetched; no new source was added.

## Rollback
Revert the merge commit and dispatch `radar-v4-snapshot.yml`. Pre-V5 snapshots stay valid under the V5 validator. A V5 snapshot read by pre-V5 serving code fails validation; that code then keeps its last valid in-memory snapshot or falls back to the marked legacy list.


---

# V5 final — three-tier discovery and a separate established universe (2026-11-20)

## Architecture
- **Tiers.** All three compete for the same ten slots; none is reserved.
  - **EARLY:** a Filter A row whose pool is under 90 days old or of unknown age.
  - **GROWTH:** a Filter A row with a pool of 90 days or more, or a measured-size established row (large cap / mature market) that passed the quality-expansion gates.
  - **ESTABLISHED (A-class):** a maintainer-listed exact contract whose identity is corroborated in this run.
- **Established universe** (`intel/universe.js`, `established-universe.json`). Runs in the snapshot builder only, never in a visitor request.
  - **Sources:** the registry of 28 Ethereum governance/protocol contracts (exact addresses) plus the network explorer's token index.
  - **Market data:** one complete DEX Screener pool listing per listed contract (`/token-pairs/v1`). Batched requests for other contracts.
  - **Identity:** the explorer token record and DEX Screener must report the same symbol for the exact contract, and the registry's symbol for listed rows.
  - **Price corroboration:** explorer rate against DEX price, MATCHED within 10 %, CONFLICT at 25 % or more.
  - **Sums:** liquidity and volume are lower-bound sums over the contract's own base pools.
  - **Scope:** no Arc or Robinhood listing exists, so nothing crosses chains. Pons is excluded. A Robinhood row never re-lists a Pons launch.
- **Combined order `arcy-research-rank-1`:**
  1. class (QUALIFIED > NEAR_MATCH > MONITOR_ONLY);
  2. for near/monitor rows, distance to the real thresholds;
  3. V4 verified-evidence tier;
  4. `arcy-quality-rank-1`;
  5. the previous V4 keys.

  A corroborated A-class project therefore outranks a weak monitor row, but never a row with verified on-chain evidence. The SCORE column (`arcy-discovery-2`) is unchanged.
- **The four PR #295 weaknesses, fixed with tests:**
  1. Filter B accepts only a reviewed list of non-blocking "not yet verified" reasons. Any other code blocks.
  2. Artwork is never a gate or a score input. Monitor rows need corroborated exact-contract identity instead. A missing logo uses the existing placeholder.
  3. Organic growth separates reviewed on-chain buyers, provider unique wallets, and transaction-count proxies (capped at 30 % of the component).
  4. Carried-forward expansion rows are re-checked against every gate they publish: category, tier, reviewed reasons, class, price, liquidity, volume, turnover, trades, price move, pool age, conflict, identity and quality.
- **Fixed during real-data runs:**
  - The Arc explorer had shared the Blockscout provider id, so an Arc outage blocked Ethereum reads. It now has its own id.
  - The batched DEX Screener list under-counted large tokens (AAVE, LINK and UNI read as "below $200k").
  - A single pool without a volume figure voided the whole sum.
  - The deepest pool sometimes had no creation time; pool age now falls back to the oldest known pool.
  - Robinhood "GME" ("Greatest Meme Ever") used a stock ticker on the tokenized-equity chain.

## Real data (Preview snapshot builder on Production legacy-V3 input, CI, 2026-11-19 23:30–23:45 UTC)
| Network | Early | Growth | A-class Established | Total | Missing slots | Shortage cause |
|---|---:|---:|---:|---:|---:|---|
| Arc | 4 | 0 | 0 | 4 | 6 | ~20 of 47 window contracts already spiked, 8 look-alike tickers, 6 too far from floors, 4 no market, AF hold. Universe: Arc explorer answers HTTP 403 to CI; no verified Arc registry |
| Ethereum | 2 | 1 | 4–6 (CVX, UNI, MKR, LINK, AAVE, CRV) | 7–9 | 1–3 | Of 28 listed: 1 never matched, 15 below DEX activity floors (COMP, ENS, GRT, BAL, YFI, SUSHI, RPL, SNX, SAFE, GNO, LPT, IMX, ZRX), 11–12 below Quality 40 (LDO, ENA, SKY, ONDO, PENDLE, ETHFI, 1INCH, EIGEN, MORPHO; no unique-participant or development evidence) |
| Robinhood | 5 | 4 | 0 | 9 | 1 | 4 tokenized equities (never used), MOW risk hold, identity-uncorroborated monitors, 9 look-alike tickers. Robinhood explorer index answers HTTP 403 to CI |
| Pons | 2 | 0 | n/a | 2 | 8 | Factory reports 730 launches in the last 500k blocks, but only 2 of the 40 checked provider tokens are factory launches with a market above the Pons floors (others: ~$3k liquidity, under $300 volume) |

- Every listed Ethereum contract matched on price (0.0–4.4 % gap between the explorer and DEX Screener). No identity mismatch was observed.
- **Cost per build:** about 57 explorer requests (Ethereum identity lookups), 28 DEX Screener per-token requests plus one batch, 2 builder cross-checks. RPC is unchanged. Engine time 145–175 s, out of request.

## What would raise coverage (not done)
- **Arc / Robinhood:** an explorer token index reachable from the builder, or a verified registry of Arc-native and Robinhood-native projects with official contract evidence.
- **Ethereum Quality:** unique-participant data (on-chain buyer review for listed contracts) and official repository/development evidence for registry projects. Today these score 0 instead of being assumed.
- **Pons:** this is a market fact, not a filter defect. More factory launches need real DEX markets.
