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
