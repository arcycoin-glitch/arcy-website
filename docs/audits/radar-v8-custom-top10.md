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
