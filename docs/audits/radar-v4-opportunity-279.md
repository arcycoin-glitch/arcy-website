# Radar V4 — ARCY Opportunity Intelligence (issue #279)

Date: 2026-11-18. Branch `claude/radar-v4-opportunity-engine`, Draft PR #287 (base: main `1b69c1a`, which contains #286).
Status: **IMPLEMENTED · TESTED · SHADOW VERIFIED (CI dry run)**. Not merged, not deployed, release gate OFF, preview not verified.

## Integration

Cherry-picked onto current main: #277 (pre-catalyst + 24h 8x veto), #280 (intelligence engine, 5 commits) and #285 (ten watch candidates). The #278 commits were **not** re-applied: #286 on main already carries the Pons/Robinhood separation, plus the newer major-ticker identity flag. #271 was not touched.

## What V4 adds

| Component | File |
|---|---|
| Exact chain + contract asset categories (stable, wrapped, commodity-backed, tokenized equity, blue chip, legacy meme, measured ≥$1B large-cap, ≥365-day ≥$1M mature legacy) | `lib/radar-v2/intel/category.js` |
| Opportunity Intelligence Score V4 (product 30 / team 20 / adoption 15 / catalyst 15 / divergence 10 / market 10). Unknown dimension = `null`, contributes 0. Risk and identity are separate gates. | `lib/radar-v2/intel/opportunity.js` |
| Fundamentals–price divergence from ARCY's own on-chain daily samples: 7d/30d change, sustained-peak drawdown, liquidity change, ETH benchmark. Safeguards: abandoned dev → 0, liquidity −50 % → collapse, concentrated/wash demand → 0, unknown fundamentals → `null`. | same |
| Team rhythm: 7/30/90-day commits, distinct authors, active weeks, single-day burst cap, issue upkeep | `intel/github.js` |
| Discovery beyond ranked volume: contracts held back only by the volume floor, diversity-capped contracts, Arc low-volume movers, on-chain pool creations; each with provenance. On-chain budget prioritised by liquidity, never by volume. | `intel/engine.js` |
| Ten-candidate display. Tiers: 1 ELIGIBLE · 2 product+team verified · 3 organic adoption · 4 others. Suspected concentration is demoted and labelled. Never padded; shortfall diagnosed. | `intel/engine.js` `selectDisplay` |
| Snapshot contract, validation, per-section carry-forward, cached public read, release gate | `lib/radar-v2/v4-snapshot.js` |
| Out-of-request builder + scheduled workflow publishing to data-only branch `radar-v4-snapshots` | `scripts/radar-v4-snapshot.cjs`, `.github/workflows/radar-v4-snapshot.yml` |

Public path: one additive line in `search/server/api/radar.js`. With `RADAR_V4_OPPORTUNITY_ENABLED=true`, `tokens` comes from the V4 snapshot in the identical DTO (≤10 rows, rank, address, symbol, name, fields, `discovery` with `arcy-discovery-2` score). The Info text is the V4 evidence sentence. An additive `opportunity` block is attached. Gate OFF (default) → byte-identical legacy response, no extra request. If the snapshot is missing, invalid, tampered or >24 h old, the legacy list is served and `opportunity.status` says why. One snapshot read per 10 minutes per instance (1.5 s timeout, 600 KB cap, no redirects, fixed host/path).

Additive DTO fields: `excluded[]` rows now carry `pool`, `quote`, `priceUsd`, `fdvUsd`, `marketCapUsd`; `categories.newPools.items[]` carry `pool`, `quote`. No ranking or gate reads them. `vercel.json` disables deployments for the `radar-v4-snapshots` branch only.

Discovery Score: unchanged meaning. Ranked rows keep their score. Newly surfaced rows get the same `arcy-discovery-2` formula applied to the provider values the Radar already returned (`discovery.basis` records which).

## Measured results — CI dry run 44274665033 (2026-11-18 09:28 UTC), same candidate windows as the live Radar

| Section | Candidates (sources) | Non-early removed | Shown (target 10) | ELIGIBLE | Legacy top kept | Shortfall cause |
|---|---|---|---|---|---|---|
| Arc | 8 (6 ranked, 2 quiet volume-floor) | 0 | 5 | 0 | 5/6 | 1 excluded (verified thin exit), 2 without observed market price |
| Ethereum | 12 (10 ranked, 2 diversity-capped) | 8: XAUt, PAXG (commodity); PEPE, SPX6900 (legacy meme); AAVE, ENA, ONDO (blue chip); 1 mature legacy | 3 (WPRL, NEAR, GDLR) | 0 | 3/10 | only 4 early-stage contracts exist in the window |
| Robinhood | 11 (10 ranked, 1 diversity-capped) | 3 tokenized equities | 8 | 0 | 8/10 | tokenized equities removed |
| Pons Launch | 10 | 0 | 10 | 0 | 10/10 | — |

- First-party identity coverage: **0 %**. The registry has 0 approved projects, so product, team and catalyst dimensions are `null` for every live candidate. All shown rows are `WATCHLIST_NOT_VERIFIED`, and their Info text says "Ürün/geliştirme kanıtı yok (kayıtlı resmi kaynak yok)".
- Real product evidence: 0. Verified development activity: 0. Dated official catalysts: 0.
- Historical runup: 2 pools cleared 30d/7d (one Arc, one Pons); confirmed 8x exclusions 0; 24h 8x 0; the rest `RUNUP_NOT_VERIFIED`.
- Critical-risk exclusions: 1 (Arc AF, verified exit cost >5 % at $1k). Heuristic demand concentration: 4 Robinhood rows demoted to tier 4 (TORCH, TIBBIR, AI, HOOKR).
- Pons/Robinhood duplicates: 0. Snapshot validation rejects any duplicate; the serving path filters again.
- Cost per refresh (cold): 23 Blockscout calls; RPC Arc 206 / Ethereum 65 / Robinhood 458; 0 GitHub (nothing registered); 0 CoinGecko credits; 149 s engine, 158 s total. At every 4 h that is ~180 runs/month. GitHub Actions minutes come from the existing free allowance; no paid service.
- Precision, hit rate, lead time: **NOT MEASURED**, and not invented.

Interpretation: V4 removes the legacy/volume dominance (Ethereum keeps only 3 of 10 old entries). But with an empty registry and unavailable price history on many venues, the ranking is driven mostly by market depth and on-chain adoption. Ranking on fundamentals only becomes real once projects are registered.

## Tests

- 20 V4 tests (`test/radar-v4.test.js`) and 47 intelligence tests (`test/radar-intel.test.js`, including a V4 end-to-end case). They cover every scenario in §12, including the two mandatory regressions: an evidenced underperformer outranks a PEPE-like volume leader, and a proven honeypot stays excluded at any score.
- Full Node 22 + Redis `npm test`: **1400/1400** locally; CI "ARCY Search Regression" green.
- One CI rerun was needed because the keyless GeckoTerminal 24h probe flaked on the provider (an existing step, unrelated).

Layout: no HTML, CSS or presentation JavaScript changed (`git diff origin/main` over `*.html`, `*.css`, `search/market-radar.js` is empty), so the 320/390/800/1024/1440 px skeleton is unchanged. With the gate ON, rows use the same DTO checked by `validOverview`. Rendering of the V4 rows on a preview was **not** verified, because this session has no access to set Vercel environment variables.

## Remaining limitations / blockers

1. Owner registry review (0 approved). Without it no project can be ELIGIBLE or get product/team/catalyst scores.
2. Ethereum public RPC returns 403 for history logs. Robinhood Blockscout returns 403 (needs the existing optional `BLOCKSCOUT_API_KEY`). Arc has no source-code explorer.
3. Unreviewed venues (Ramses, Aero Slipstream, Peach/Faze/Argus forks) have no history and no exit model.
4. Production rows will only carry `pool`/`quote`/`priceUsd` for quiet candidates after this PR is deployed; until then those candidates are "market not observed".
5. Activation steps (owner):
   - merge;
   - let the scheduled workflow create `radar-v4-snapshots` (or run it manually);
   - set `RADAR_V4_OPPORTUNITY_ENABLED=true` on a Preview, verify 320–1440 px, then decide on Production.
6. 90-day price window is not measured (30-day sampler). Usage growth over time is not measured (no stored buyer history).
