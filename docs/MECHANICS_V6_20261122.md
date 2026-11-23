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

## Validated results (PR #318, head `bb2f4e1`)

### B — Mechanics paired benchmark (51 contracts; same pinned blocks, identical recorded provider answers)

Workflow: [GitHub Actions #45069818593](https://github.com/arcycoin-glitch/arcy-website/actions/runs/45069818593). Mandatory paired gate **PASS**; replay misses 0, verified fields lost 0.

| Mechanics field | Before DATA_FOUND | After DATA_FOUND | Net gain |
|---|---:|---:|---:|
| tradingTaxes | 29/51 | 37/51 | +8 |
| mintCapability | 29/51 | 37/51 | +8 |
| ownerAdmin | 31/51 | 40/51 | +9 |
| contractArchitecture | 50/51 | 50/51 | 0 |
| transferRestrictions (supplementary) | 28/51 | 36/51 | +8 |

**Interpretation:** Most added `tradingTaxes` facts describe verified **token-level transfer** semantics only (`Transfer 0% · DEX/hook fees NOT VERIFIED`), so they do **not** establish a complete verified Buy/Sell/Transfer tax triplet. Do not compare the 37/51 count to the Search 40-token cohort's strict tax coverage.

Requests under deterministic paired evidence: base 826 RPC and 76 Sourcify; branch 844 RPC and 76 Sourcify. The additional 18 RPC reads were classified within existing bounded budgets: 16 reviewed-profile, 2 sibling; 0 added GoPlus, explorer or other API calls.

The Ethereum explicit EVM-revert proof-path bug was fixed by retaining `GETTER_REVERTED` separately from opaque RPC failures in `search/server/lib/eth.js`; `test/mechanics-ethereum-rpc-revert-v6.test.js` prevents regression. The earlier `contractArchitecture` loss on Ethereum `0x58d97b...` is absent from the successful paired run, with no lowering of the evidence gate.

### A — fixed ARCY Search coverage cohort (40 contracts × 12 metrics)

Workflow: [GitHub Actions #45069818624](https://github.com/arcycoin-glitch/arcy-website/actions/runs/45069818624); identical cohort and alternating A/B ordering. Measured verification: **41.88% (201/480) → 43.96% (211/480)**. Current evidence (VERIFIED or SOURCE_BACKED): **86.88% → 88.54%**.

| Search metric (strict VERIFIED) | Main A | V6 B |
|---|---:|---:|
| mechanics.tradingTaxes | 2.5% | 2.5% |
| mechanics.mintCapability | 12.5% | 22.5% |
| mechanics.ownerAdmin | 15% | 30% |
| mechanics.contractArchitecture | 100% | 100% |

**Unresolved evidence changes:** The live A/B observed five `SOURCE_BACKED → NOT_VERIFIED` transitions: FLOCK (Robinhood: tax/mint/owner; `MECHANICS_EXECUTION_PATH_UNREVIEWED`) and TENDIES (Robinhood: tax/mint; `MECHANICS_SOURCE_IDENTITY_UNVERIFIED`). In two repeat checks the classifications persisted on both sides. The benchmark's zero VERIFIED regressions does not imply zero source-backed downgrades. Do not promote these to VERIFIED without proving their exact runtime/implementation execution path and source identity. Audit each transition before release; classify as genuine evidence-correction versus accidental drop.

### Remaining blocker priorities

1. **Strict Buy/Sell tax 2.5%** (1/40): prioritize exact verified tax execution paths and safe on-chain state reads; token-transfer-only facts cannot fill this gap.
2. **FLOCK/TENDIES evidence downgrade**: preserve the reason codes and investigate independent source/runtime proof; never add address-based trust exceptions.
3. **Source availability & implementation binding**: verified source missing (6 benchmark contracts), unreviewed execution path (2), unresolved implementations (4), source schema mismatch (2). Do not guess.
4. **Proxy/admin authority**: getters identify addresses but do not prove complete governance or upgrade authority.
5. No UI or non-Mechanics change, no new paid API, no auto-enable Risk Engine. Draft PR only; no merge or deploy until reviewed.

