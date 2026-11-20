# ARCY Radar — dual-score SHADOW audit (`arcy-dual-score-1`)

Status: shadow only, behind `RADAR_DUAL_SCORE_SHADOW` (default OFF; set only for pull_request preview runs). Not served, not used for selection.

## 1. How the current (production) scoring works
- **Stage 1, hard eligibility** (`custom-filter.js` `veto`): failed exit or honeypot; mint/admin danger; risk hold; impersonation or identity conflict; pegged, stable or wrapped asset; no real market observation; unproven Pons launch; Pons launch in Robinhood; token identity without a project profile.
- **Stage 2, one ARCY opportunity score** (`arcy-custom-filter-3`): organic volume 15 · weakness with stabilisation 14 · compression 14 · liquidity/exit 12 · buyer participation 10 · project/identity 12 · manipulation cleanliness 8 · upside asymmetry 15.
  - Order is strictly by score. The top 10 per network are published.
- **Publication:**
  - `S.publishable` must pass: this commit, fresh current-engine sections, 10 rows or a real recorded shortfall, unique contracts, zero Pons/Robinhood overlap.
  - Serving keeps Pons/Robinhood de-duplication and risk holds.

## 2. Where a new score could affect the current system
- **Selection:** replacing `CUSTOM.compare` would change every list.
- **Validation:** `customOrderOk` requires the score order, and `validSection` checks the row schema.
- **Publication:** the gate requires every row to carry `arcy-custom-filter-3`.
- **Display:** `infoV4` is built from `researchRank`.

## 3. What would break backward compatibility
- Changing `researchRank.version`, `researchScore` or the row order.
- Adding fields the validator rejects.
- Changing the snapshot schema read by the site.
- Changing the shortfall semantics used by the gate.

None of these are touched.

## 4. Isolation
- Fully possible.
- The only engine change is a non-enumerable `rankedPool` on the production result. It is not serialised and not spreadable. Its behaviour hash is identical to main on 240 synthetic rows across 4 networks.
- The shadow reads that pool, re-applies the production veto, and writes a separate `dual-score-shadow.json` that the site never reads.

## 5. Is the data sufficient? (real preview run, 93 eligible rows)
| Criterion | Source | Status |
|---|---|---|
| Team | none | UNMEASURED for every row (93/93) |
| Development | official-site-linked GitHub | measured only for dossier/registry projects (69/93 unmeasured) |
| Product usage | on-chain distinct buyers | rarely available (87/93 unmeasured) |
| Community activity & growth | none | UNMEASURED (93/93) |
| Unique wallet growth | no baseline window | UNMEASURED (93/93) |
| Upcoming developments | dated official events | only registry/dossier projects (45/93 have no source) |
| Volume compression | ≥21 daily candles | 60/93 below 21 days |
| Volume / trade acceleration | intraday 6h vs 24h windows | mostly available (17 and 8 rows missing) |
| Liquidity health, security checks, early discovery | existing pipeline | available |

Mean coverage: Project Quality about 44–55%, Opportunity about 45–70% per network. **Project Quality is not decision-grade until team, community and usage sources exist.** Opportunity is usable as a research signal.

## arc — eligible pool 30, overlap with production 8/10, mean coverage Q 45.5% / O 56.3%
PROD: 1.ARGUS 2.ARCOON 3.TOLLY 4.LONG 5.FAZE 6.KAIRO 7.CRA 8.oBrain 9.MURMUR 10.MSS2
DUAL: 1.oBrain (O66 c80%, Q13 c41%, prod #8, EARLY_STAGE_CANDIDATE); 2.FAZE (O55 c90%, Q23 c46%, prod #5, EARLY_STAGE_CANDIDATE); 3.ARCUS (O48 c50%, Q10 c41%, new, EARLY_STAGE_CANDIDATE); 4.LONG (O37 c75%, Q22 c45%, prod #4, EARLY_STAGE_CANDIDATE); 5.MURMUR (O37 c90%, Q25 c61%, prod #9, EARLY_STAGE_CANDIDATE); 6.TOLLY (O34 c90%, Q31 c50%, prod #3, ESTABLISHED_BLUE_CHIP); 7.ARGUS (O33 c90%, Q35 c50%, prod #1, ESTABLISHED_BLUE_CHIP); 8.ARCOON (O31 c90%, Q44 c60%, prod #2, EARLY_STAGE_CANDIDATE); 9.KAIRO (O31 c80%, Q14 c41%, prod #6, EARLY_STAGE_CANDIDATE); 10.WAVE (O31 c60%, Q16 c46%, new, EARLY_STAGE_CANDIDATE)

## ethereum — eligible pool 24, overlap with production 5/10, mean coverage Q 55% / O 69.6%
PROD: 1.CVX 2.LDO 3.AAVE 4.ENA 5.PEPE 6.LINK 7.UNI 8.SKY 9.puppies 10.CON
DUAL: 1.AXGT (O36 c60%, Q22 c46%, new, EARLY_STAGE_CANDIDATE); 2.CON (O30 c60%, Q49 c60%, prod #10, EARLY_STAGE_CANDIDATE); 3.GRT (O25 c60%, Q34 c61%, new, ESTABLISHED_BLUE_CHIP); 4.AAVE (O24 c90%, Q46 c65%, prod #3, ESTABLISHED_BLUE_CHIP); 5.LINK (O24 c90%, Q46 c61%, prod #6, ESTABLISHED_BLUE_CHIP); 6.PEPE (O23 c90%, Q26 c50%, prod #5, LEGACY_MEME); 7.MANA (O21 c50%, Q14 c41%, new, ESTABLISHED_BLUE_CHIP); 8.LDO (O19 c90%, Q46 c61%, prod #2, ESTABLISHED_BLUE_CHIP); 9.APU (O15 c60%, Q42 c56%, new, EARLY_STAGE_CANDIDATE); 10.IMX (O14 c50%, Q14 c41%, new, ESTABLISHED_BLUE_CHIP)

## robinhood — eligible pool 27, overlap with production 5/10, mean coverage Q 44.1% / O 62.8%
PROD: 1.STATICS 2.FOBO 3.ZZZ 4.TORCH 5.Index 6.AI 7.HOOKR 8.DEGEN 9.STONKBROKER 10.TENDIES
DUAL: 1.TORCH (O62 c80%, Q14 c41%, prod #4, EARLY_STAGE_CANDIDATE); 2.ZZZ (O54 c80%, Q14 c41%, prod #3, EARLY_STAGE_CANDIDATE); 3.Index (O51 c80%, Q18 c41%, prod #5, EARLY_STAGE_CANDIDATE); 4.TENDIES (O50 c80%, Q14 c41%, prod #10, EARLY_STAGE_CANDIDATE); 5.AI (O48 c90%, Q39 c50%, prod #6, EARLY_STAGE_CANDIDATE); 6.BUN (O48 c50%, Q14 c41%, new, EARLY_STAGE_CANDIDATE); 7.SFI (O48 c50%, Q14 c41%, new, EARLY_STAGE_CANDIDATE); 8.BOW (O47 c50%, Q14 c41%, new, EARLY_STAGE_CANDIDATE); 9.TAO (O39 c50%, Q14 c41%, new, EARLY_STAGE_CANDIDATE); 10.FLOCK (O37 c50%, Q14 c41%, new, EARLY_STAGE_CANDIDATE)

## pons — eligible pool 13, overlap with production 9/10, mean coverage Q 54.3% / O 45.4%
PROD: 1.DELTA 2.HMM 3.PRIORS 4.PONS 5.ORBIO 6.COFR 7.IDLEX 8.VENIN 9.CORBEL 10.ANSEMWIF
DUAL: 1.HMM (O51 c90%, Q23 c46%, prod #2, EARLY_STAGE_CANDIDATE); 2.DELTA (O46 c80%, Q34 c51%, prod #1, EARLY_STAGE_CANDIDATE); 3.PONS (O25 c90%, Q33 c65%, prod #4, EARLY_STAGE_CANDIDATE); 4.PRIORS (O21 c90%, Q54 c75%, prod #3, EARLY_STAGE_CANDIDATE); 5.VENIN (O15 c15%, Q15 c45%, prod #8, EARLY_STAGE_CANDIDATE); 6.ORBIO (O14 c90%, Q41 c65%, prod #5, EARLY_STAGE_CANDIDATE); 7.COFR (O10 c25%, Q29 c65%, prod #6, EARLY_STAGE_CANDIDATE); 8.CORBEL (O10 c25%, Q29 c65%, prod #9, EARLY_STAGE_CANDIDATE); 9.OBSYN (O10 c25%, Q23 c61%, new, EARLY_STAGE_CANDIDATE); 10.ANSEMWIF (O10 c15%, Q14 c45%, prod #10, EARLY_STAGE_CANDIDATE)

## Risks
- Low coverage: many dual-ranked "new" rows have Opportunity coverage of 50%. Their rank rests on acceleration plus early-discovery points.
- Opportunity alone favours very young, low-quality tokens (Quality 10–16). A combined gate (minimum Quality or coverage) would be needed before any production use.
- Intraday windows are a single snapshot. Acceleration can flip between 2-hour runs.

## Rollback
Leave `RADAR_DUAL_SCORE_SHADOW` unset (the default), or revert the PR. No served format, data migration or flag on main changes.
