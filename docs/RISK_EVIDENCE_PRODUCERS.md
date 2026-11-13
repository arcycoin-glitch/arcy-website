# Risk evidence producers and shadow integration (issue #226)

Connects the Autonomous Risk Engine V1 (#224) to the Verification Runtime (#225) **without** renaming or coercing any Search metric. Each `risk.*` record comes from a dedicated, reviewed producer with its own semantics and provenance.

- Flag: `ARC_AUTONOMY_RISK_ENGINE_ENABLED=1`, **default OFF**. OFF: no producer runs, no request is made.
- ON: shadow mode only. The result is persisted to the Evidence Ledger (when durable storage exists) and logged as one `RISK_SHADOW` line. **It is never attached to a Search response**; the 20 metrics, cards, statuses and every API stay unchanged. No new Vercel function, route or response field.

## First security review fix (v2, superseded by v3 below)

Review of #227 ([comment](https://github.com/arcycoin-glitch/arcy-website/pull/227#issuecomment-6836358243)): an accepted privileged `eth_call` proves **access to that calldata**, not the operation. An admin-only fallback or an owner-only no-op (even with an inert `PUSH4 40c10f19` in its bytecode) produces the same differential without writing the EIP-1967 slot or increasing supply.

Since producer **v2**:
- A positive record also requires that `keccak256` of the runtime code handling the call (the proxy for upgrade calls; the implementation, or the token itself, for mint) is in `REVIEWED_CODE[network]` with the matching capability (`upgrade: true` / `mint: true`) and a reference to reviewed, bytecode-matched source. The registry is per network and frozen.
- **The registry ships empty.** Every case is therefore `NOT_VERIFIED / OPERATION_SEMANTICS_UNREVIEWED` (engine `UNKNOWN`); the access observation and the code hash are kept for diagnostics.
- The gate requires `minVersion: 2`, so v1 records (access differential only) are rejected as `PRODUCER_NOT_REVIEWED`.
- Execution traces (`debug_traceCall`) are not used: the public endpoints in use do not offer them, and a trace-based proof would itself need review.

## Second security review fix (v3): execution route and full operator agreement

Review of #227 ([comment](https://github.com/arcycoin-glitch/arcy-website/pull/227#issuecomment-6864901625)): a reviewed implementation hash says nothing if the proxy in front of it can answer the selector itself, and two operators that agree on "accepted" may still be looking at different implementations.

Since producer **v3**:
- `REVIEWED_CODE` is replaced by the **reviewed-code registry** (`lib/risk-engine/reviewed-code/`). One entry proves one capability for one **execution route** on one network: `capability` + `architecture` + `selector` + `actorRole` + `proxyCodeHash` + `implementationCodeHash`.
  - `eip1967-transparent-proxy` (upgrade): the proxy code handles admin calls itself; proxy hash required, actor must be the EIP-1967 admin.
  - `eip1967-uups` (upgrade) and `eip1967-delegated` (mint): proxy **and** implementation hashes required; the proxy is reviewed as delegating that selector for that actor. A proxy admin is never a mint actor.
  - `direct` (mint): the token is not a proxy; its own code hash is reviewed.
- Every entry needs a review artifact: for each code hash a Sourcify `exact_match` whose verified runtime bytecode hash equals the on-chain code hash read from two operators at one block hash, the source file hashes, the reviewed functions with findings, and a conclusion. Invalid, inconsistent, partial-match or duplicate entries are dropped at load (fail closed). No wildcard, no "trusted contract".
- Operators must agree on the whole identity at one block hash: outcome, reason, actor role, actor, selector, calldata hash, review id, proxy code hash, implementation **address**, implementation code hash, admin and beacon. Same outcome with a different identity → `NOT_VERIFIED / EXECUTION_IDENTITY_MISMATCH`. Different outcome → `CONFLICTING / AUTHORITY_OUTCOME_MISMATCH`.
- A set EIP-1967 beacon slot → `BEACON_PROXY_UNSUPPORTED`. The pinned header is re-read after all reads; a changed hash fails that operator (`PINNED_BLOCK_CHANGED`).
- The gate requires `minVersion: 3`; v1 and v2 records are `PRODUCER_NOT_REVIEWED`.
- **The registry ships empty**, so every live result is `UNKNOWN`. `scripts/review-code-evidence.cjs` (workflow `reviewed-code-evidence`) collects the machine-checkable half of a review; an entry is added only by a reviewed pull request that includes the artifact.
- Not used: `debug_traceCall` / state overrides (not offered by the public endpoints in use), `PUSH4` presence as proof, `upgradeTo(currentImplementation)` success as proof.

## Reviewed producer: `arcy-risk-authority-producer` v3 (`lib/risk-engine/producers/authority.js`)

Registered in `lib/risk-engine/rules.js` for two rules, **positive values only** (`values: [true]`).

| Rule | Access observation | Needed in addition for `true` |
|---|---|---|
| `admin-upgrade-authority` / `risk.upgrade-authority` | An EIP-1967 proxy accepts `upgradeToAndCall(currentImpl, "")` or `upgradeTo(currentImpl)` from the admin slot address or `owner()`, and the identical call from the control address reverts | a reviewed upgrade route for this proxy code (and implementation code for UUPS) |
| `privileged-minting` / `risk.mint-authority` | `mint(control, 1)` is accepted from `owner()` and reverts from the control address | a reviewed mint route: proxy code + implementation code, or the token's own code |

- Control address: `keccak256("arcy-risk-control-v1")[12:]` — no key exists for it.
- Reads: `eth_chainId`, header, `eth_getStorageAt`, `eth_getCode`, `eth_call` at the report's exact block. Nothing is signed or sent.
- Budget: ≤ 22 read-only calls per endpoint, two endpoints, 3 s per call, 6 s overall, no retries; watchdog cooldown ⇒ the provider is skipped.
- It never emits `false`. "Not demonstrated" is `NOT_VERIFIED` (engine `UNKNOWN`), never "no risk". A forged `false` record with this producer's id cannot become `NOT_CONFIRMED`.

Limits of a positive claim: it shows that at that block the reviewed code would execute the reviewed operation for that actor. It does not show that the actor's key or multisig is live, that a timelock does not delay execution, or that other mint/upgrade paths (roles, master-minter schemes, legacy non-EIP-1967 proxies) do not exist — those stay `UNKNOWN`.

## Capability / evidence matrix (`lib/risk-engine/capability-matrix.js`)

Shadow output carries `evidenceGaps`: for every `UNKNOWN` rule, the producer's own reason where one ran, otherwise the blocker below.

| Rule | Producer | Arc 5042 | Ethereum 1 | Robinhood 4663 | Missing evidence |
|---|---|---|---|---|---|
| `admin-upgrade-authority` | authority v3, confirm-only | `NO_REVIEWED_EXECUTION_ROUTE` | `NO_REVIEWED_EXECUTION_ROUTE` | `NO_REVIEWED_EXECUTION_ROUTE` | a reviewed route artifact; a negative needs a complete upgrade-path audit |
| `privileged-minting` | authority v3, confirm-only | `NO_REVIEWED_EXECUTION_ROUTE` | `NO_REVIEWED_EXECUTION_ROUTE` | `NO_REVIEWED_EXECUTION_ROUTE` | a reviewed route artifact; a negative needs a complete supply-increase audit |
| `high-exit-impact` (rule v2) | none | `PRICE_ANCHOR_NOT_REVIEWED` | `PRICE_ANCHOR_NOT_REVIEWED` | `PRICE_ANCHOR_NOT_REVIEWED` | Rule v1 probed 1 % of reserves, which gives ≈ 0.99 % impact on every constant-product pool whatever its size. v2 defines a fixed $1,000 probe (`pinned-fixed-usd-1000-exit-replay`); it needs a reviewed same-block USD anchor for the quote asset from two operators. None is reviewed on any network |
| `low-pool-liquidity` | none | `RESERVE_VALUATION_NOT_REVIEWED` | `RESERVE_VALUATION_NOT_REVIEWED` | `RESERVE_VALUATION_NOT_REVIEWED` | two-operator reserves plus a reviewed USD valuation of both assets; market-reported liquidity is not proof |
| `sell-transfer-tax` | none | `TRANSFER_DEDUCTION_NOT_ISOLATED` | `TRANSFER_DEDUCTION_NOT_ISOLATED` | `TRANSFER_DEDUCTION_NOT_ISOLATED` | balance deltas across a simulated transfer (state override / trace) on two operators; never inferred from a quote |
| `top-ten-holder-concentration` | none | `HOLDER_CENSUS_SINGLE_OPERATOR` | `HOLDER_CENSUS_UNAVAILABLE` | `HOLDER_CENSUS_UNAVAILABLE` | complete census reconciled to supply at one block hash, reproduced by a second operator, with a reviewed eligibility policy |

No rule returns `NOT_CONFIRMED` anywhere: no producer performs a complete audit.

## Evidence lifecycle

| Stage | Where | Meaning |
|---|---|---|
| OBSERVED | one operator read at the pinned block | `SINGLE_SOURCE` at most |
| VALIDATED | strict `MetricEvidence` contract, chain id, block hash, freshness | malformed → rejected |
| CROSS_CHECKED | two registered operators, one block hash, identical execution identity | else `CONFLICTING` / `NOT_VERIFIED` |
| SEMANTICALLY_REVIEWED | reviewed-code registry route match | else `OPERATION_SEMANTICS_UNREVIEWED` |
| VERIFIED | `VERIFIED_ONCHAIN` + reviewed producer version + allowed polarity | engine `CONFIRMED` |
| UNKNOWN / CONFLICTING / STALE | any step missing, disagreeing or too old | never a verdict |

## Durability

The Evidence Ledger needs `ARC_VERIFICATION_LEDGER_DIR` or `ARC_HOLDER_PUBLISHED_DIR`. On Vercel neither is durable or shared, so shadow results there report `ledger.history: NOT_PRESERVED`. Retained risk history exists only where the worker volume is mounted. Writes are atomic (lock + fsync + rename), throttled to one rewrite per minute per unchanged record, and time-bounded (1.5 s).

## Next release gates

1. Owner review of the producer semantics and this matrix.
2. Live probe results on the current head (appended to the PR).
3. Shadow mode on a preview or the worker with durable storage, comparing producer records against the ledger over time.
4. Only then: a reviewed, backward-compatible, opt-in diagnostic API field — not part of this change.
