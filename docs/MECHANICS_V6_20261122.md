# Contract & Mechanics V6: reviewed-source profiles (2026-11-22)

Scope: backend Mechanics engine only. UI, the four visible rows, the 20-metric contract and other engines are unchanged.
Risk Engine production flags stay off. No paid API. Source: Sourcify full source digest + exact runtime match only.

## P0: measured NOT VERIFIED classes (bench "before" replay, 51 contracts)

| Class | Contracts | Examples |
|---|---|---|
| EXECUTION_PATH_UNREVIEWED | ~10 | SKY, CVX, LDO, YFI (eth); ARGUS (arc); TAO, STONKBROKER, FOBO owner (robinhood); DELTA, HMM (pons) |
| VERIFIED_SOURCE_UNAVAILABLE | 5 | ARCOON, FAZE, oBrain, LONG (arc); 56910d (robinhood) |
| IMPLEMENTATION_UNRESOLVED | 4 | 9f8F72, MORPHO 58d97b (eth); STATICS, AI Solady clones (robinhood) |
| SOURCE_IDENTITY_UNVERIFIED | 2 | 020bfc, TENDIES 452423 (SOURCE_SCHEMA_INVALID) |
| RPC_ERROR | 1 | ENA 57e114 (-32001) |

Largest verifiable gain: EXECUTION_PATH_UNREVIEWED (source exists and matches; it had not been reviewed yet).

## Reviewed sources added (full source review in the mechanics-source-review CI log)

| Profile | Digest (prefix) | Token | Reads (pinned, argument-free) | Result |
|---|---|---|---|---|
| FIXED_SUPPLY_OZ_BURNABLE | 1ed15a24 | FOBO (robinhood) | none | No mint, no owner/admin, no restrictions |
| CCIP_BURN_MINT_ROLE_TOKEN | 7aa78076 | TAO (robinhood) | MINTER_ROLE, BURNER_ROLE, maxSupply, totalSupply, decimals, getCCIPAdmin | Role-gated mint with cap remaining; AccessControl authority |
| GOVERNANCE_MINTER_SET | 028764df | YFI (eth) | governance | Uncapped minters managed by governance |
| OPERATOR_SCHEDULED_CAPPED_MINT | afb5ce3f | CVX (eth) | operator, vecrvProxy, maxSupply, totalSupply | Operator cliff mint, cap remaining |
| MINIME_CONTROLLED | 623789e4 | LDO (eth) | controller, transfersEnabled | Controller mint/destroy/move; transfer gate state |
| WARD_AUTH_TOKEN (mechanics-deep) | 039eb7a0 | SKY (eth) | existing ward pass | wards auth mint, full-value transfers |
| FIXED_LAUNCH_RESTRICTIONS (v4, 2nd digest) | 78a58d11 | DELTA, HMM (pons) | existing v4 getters | Launch-window restrictions, constructor-only mint |

Not reviewable: STONKBROKER CollectionToken (inline assembly outside the reviewed set); 0x808507 (no Sourcify source).

## Evidence rules kept

- Transfer 0% is published as `TOKEN_TRANSFER_ONLY` and never as Buy/Sell 0%; DEX/pool/hook fees stay NOT VERIFIED.
- Mint distinguishes capability, authority and cap state. An executable mint is never claimed where role or minter sets are not enumerable (TAO, YFI, LDO).
- Absence claims (no mint, no admin) require a non-delegating runtime. A missing or mismatching pinned getter publishes nothing (fail closed).
- Profiles are keyed only by the full 64-hex source digest, never by address, symbol or project name.
- Bench budgets are unchanged (reviewed reads ≤ 8 per contract, restriction reads ≤ 2).

## Results

See PR #318: the Mechanics before/after benchmark (B) and the 40-token cohort (A).
