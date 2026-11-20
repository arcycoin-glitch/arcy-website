# ARCY Radar V8 — custom safe-first market opportunity Top 10

## Request and contract
The owner's water-filter analogy separates two operations. A critical risk filter removes confirmed scams/impersonation, verified failed exits, mint/admin hazards, risk holds and contradictory contract identities. All other observable, uniquely identified market candidates should compete for up to ten places in each network. A missing official website, low profile completeness, limited historic data, weak liquidity or weak near-match classification lowers ranking and/or confidence; it is not automatically a confirmed scam.

V8 never guarantees a price breakout, recovery or safety. An observed price drop and strong reported volume are a **research combination**, not proof of organic demand or a future move.

## Selection
- Four independent network sections: Arc, Ethereum, Robinhood and Pons Launch (Pons is a verified Robinhood factory subset and must not appear twice).
- Max **10** actual contracts per section; no dummy/fake tokens. When fewer than ten contracts have positive observed price, liquidity and volume, and pass security vetoes, publish the actual count with a shortfall reason.
- Full category scope: early, growth, established and mature assets; exclude wrappers/stablecoins/commodity equivalents, issuer impersonation, and known blocked contract categories. No automatic endorsement of a long-established token as an early-stage project.
- Fixed vetoes: on-chain proven failed exit, verified dangerous contract control, held risk, explicit impersonation, source conflict, past verified 8x run-up exclusion, truly absent market measurements. Do not relax these to fill the ten slots.
- Soft limits: not meeting premium liquidity, profile score below 60, no verified team/product information, fewer source confirmations, missing OHLCV, or a moderate price drop. Mark as **LOW_CONFIDENCE_WATCH** or lower priority instead of excluding.
- Score from **observations**: price pressure (18), drawdown with prior evidence (12), trading activity (20), measured consolidation (16), volume/participation acceleration (12), liquidity (10), project evidence (7), market corroboration (5). Penalties for excessive churn, sharp drops, historical collapses, manipulation indications, and source disputes. Values are research-priority scores, **not** win probabilities.
- Priority bands: STRONG_RESEARCH_SIGNAL, MARKET_OPPORTUNITY_WATCH, LOW_CONFIDENCE_WATCH. Within bands, high scores first with deterministic tie breaks.
- Protect the legacy Discovery Score and existing Radar table/UI. All newly surfaced candidates are WATCHLIST_NOT_VERIFIED (including high-ranked rows): no implied safety certification.
- V7 continues to work unchanged when customFilter=false.

## Operations
- Builder-only opt-in: RADAR_CUSTOM_FILTER_ENABLED=true, set in this PR's snapshot GitHub Action. Site/read-only API, worker, other six cards and UI untouched.
- Every scheduled snapshot run re-ranks candidates from real sources. The producer must run and pass V8 tests before committing new data. Existing immutable snapshot checks still validate before serving.
- Guarded by a Draft PR: **do not merge or modify the production feature gate** before reviewing preview counts, eligibility, on-chain risk vetos, field provenance and source budgets.
- Prior V7 production snapshots remain readable during rollout; the displayed ranking changes only after a valid V8 snapshot is produced.

## Known bounds
- This does not guarantee ten results if the discovery intake is insufficient; new providers/coverage can expand the observation pool but must not invent market data or ignore genuine high-risk signals.
- 'Scam-free' cannot be established by an automated filter. Incomplete checks must remain visible to users as warnings.
- Price near a historical low is not necessarily a bottom: sustained collapse, drain of liquidity, or circular/self-trading can make it riskier.

## Exact Top 10 ranking engine (`arcy-custom-filter-2`, follow-up to #302)
Owner rules: exactly ten real projects per section (Ethereum, Arc, Robinhood, Pons); exclusion first, then ranking; a weak score never removes an eligible project; Pons takes priority over Robinhood; no fabricated data.

**Stage 1 — hard eligibility (unchanged safety rules, one addition).** Confirmed scam/honeypot/failed exit, dangerous contract control (sell/mint/admin), confirmed critical integrity finding, persistent risk hold, impersonation or identity-source conflict, provider-critical conflict, unreviewed exclusion, no real market observation, unproven Pons launch. **New:** `NO_VERIFIABLE_PROJECT_PROFILE` — after enrichment the exact contract must be tied to the project by an independent project source (identity `METADATA_CROSS_CORROBORATED` or `OFFICIAL_CONTRACT_VERIFIED`: explorer-linked listing, explorer+DEX symbol match, Pons factory record, reviewed/live-checked official page). `LISTED_IN_PONS` keeps factory-verified launches out of Robinhood.

**Stage 2 — ranking only.** Score 0–100 = organic volume 15 · price weakness with stabilisation 14 · compression / falling volatility 14 · liquidity & exit depth 12 · buyer participation 10 · project activity & verified identity 12 · manipulation cleanliness 8 · **upside asymmetry 15**. Order is strictly by score (then data coverage, then exact key); the band is a label only. Unmeasured components earn 0 and are listed (`unmeasured`). Pumps, thin books, extreme turnover, sharp falls and provider disagreement are penalties, not exclusions.

**Upside asymmetry (15).** Market cap vs FDV (circulating share; low share flagged `DILUTION_RISK_LOW_CIRCULATING_SHARE`), valuation per dollar of real 24h volume as a percentile among the section's eligible peers (≥5 peers), liquidity relative to valuation, organic growth (market-memory activity growth, OHLCV volume ratio, buy-side breadth), product traction / dated catalyst. Valuation credit is halved without growth/traction evidence and halved again for crashes (`CRASH_NOT_UNDERVALUATION`). Unlock schedules are not measured by any current source and are flagged `UNLOCK_SCHEDULE_NOT_MEASURED`. No 2x/5x/10x/100x figure is produced anywhere; the Info text states it is a research signal, not a return forecast.

**Pons priority and coverage.** Before selection, every contract in the Pons intake leaves the Robinhood intake, so Robinhood refills its ten from its own remaining candidates. Robinhood-intake contracts (V3 rows + universe rows) and Pons rows without launch status are checked against the official factories (`getLaunchedToken`, chain-checked 4663, ≤40 per run); confirmed launches move to Pons with their observed market data (`PONS_FACTORY_EXPANSION`). A membership failure is reported (`ponsExpansion.error`), nothing is guessed.

**Serving.** The P0 #297 serve-time market veto no longer removes `arcy-custom-filter-2` rows (it still applies to V4–V7 snapshots and the legacy fallback); Pons/Robinhood de-duplication and the held-risk guard remain. Snapshot validation requires non-increasing scores across all ten rows and a verifiable identity level on every custom row.

## Audit corrections (`arcy-custom-filter-3`)
- **Pegged / stable assets:** a contract is classified STABLECOIN only when its own name or ticker declares a currency or stable asset AND its observed price sits inside that currency's peg band (USD 0.97–1.03, GBP 1.15–1.50, EUR 1.00–1.30, …), with |24h| ≤ 2% when that move is measured. A price near $1 alone never classifies a project. Robinhood U ("United Stables", $0.9992) and Arc GBPA ("Agant GBP", $1.31) are now `PEGGED_OR_STABLE_ASSET`. Wrappers, bridged assets and tokenized equities are `WRAPPED_OR_REPRESENTATION_ASSET`.
- **Project profile ≠ token identity:** `OFFICIAL_PROJECT` > `SELF_PUBLISHED_PROJECT_SITE` (the project's own reviewed site publishes the exact contract, not contradicted by a live check) > `PROJECT_CHANNELS_LISTED` (creator-provided website/social on the exact-contract listing, unverified). `TOKEN_IDENTITY_ONLY` (explorer + DEX symbol match or factory record alone) is excluded. Listing channels are read for up to 90 candidates per network.
- **Churn and spikes (ranking only):** organic volume ×0.6 above 2x turnover and ×0.15 above 5x turnover. A fresh 24h spike multiplies it by 0.7 (≥35%) or 0.4 (≥70%). None of this is an exclusion.
- **Large caps:** volume and depth saturate at about 2x the network research floor ("sufficient", not "biggest"). The valuation-headroom multiplier is 0.2 at ≥$10B, 0.35 at ≥$1B and 0.7 at ≥$250M. Early-stage growth carries more weight. Established projects stay eligible.
- **Audit trail:** `display.customVetoes` lists every hard exclusion by reason, with a sample of up to 40.
- **Carry-forward:** a carried custom section is not re-filtered by P0, and its positions are renumbered.
