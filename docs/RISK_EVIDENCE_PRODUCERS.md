# Risk evidence producers and shadow integration (issue #226)

Connects the Autonomous Risk Engine V1 (#224) to the Verification Runtime (#225) **without** renaming or coercing any Search metric. Each `risk.*` record comes from a dedicated, reviewed producer with its own semantics and provenance.

- Flag: `ARC_AUTONOMY_RISK_ENGINE_ENABLED=1`, **default OFF**. OFF: no producer runs, no request is made.
- ON: shadow mode only. The result is persisted to the Evidence Ledger (when durable storage exists) and logged as one `RISK_SHADOW` line. **It is never attached to a Search response**; the 20 metrics, cards, statuses and every API stay unchanged. No new Vercel function, route or response field.

## Security review fix (v2)

Review of #227 ([comment](https://github.com/arcycoin-glitch/arcy-website/pull/227#issuecomment-6836358243)): an accepted privileged `eth_call` proves **access to that calldata**, not the operation. An admin-only fallback or an owner-only no-op (even with an inert `PUSH4 40c10f19` in its bytecode) produces the same differential without writing the EIP-1967 slot or increasing supply.

Since producer **v2**:
- A positive record also requires that `keccak256` of the runtime code handling the call (the proxy for upgrade calls; the implementation, or the token itself, for mint) is in `REVIEWED_CODE[network]` with the matching capability (`upgrade: true` / `mint: true`) and a reference to reviewed, bytecode-matched source. The registry is per network and frozen.
- **The registry ships empty.** Every case is therefore `NOT_VERIFIED / OPERATION_SEMANTICS_UNREVIEWED` (engine `UNKNOWN`); the access observation and the code hash are kept for diagnostics.
- The gate requires `minVersion: 2`, so v1 records (access differential only) are rejected as `PRODUCER_NOT_REVIEWED`.
- Execution traces (`debug_traceCall`) are not used: the public endpoints in use do not offer them, and a trace-based proof would itself need review.

## Reviewed producer: `arcy-risk-authority-producer` v2 (`lib/risk-engine/producers/authority.js`)

Registered in `lib/risk-engine/rules.js` for two rules, **positive values only** (`values: [true]`).

| Rule | Claim proven (value `true`) | Method |
|---|---|---|
| `admin-upgrade-authority` / `risk.upgrade-authority` | An EIP-1967 proxy (implementation slot set) accepts `upgradeToAndCall(currentImpl, "")` or `upgradeTo(currentImpl)` from a privileged actor — the EIP-1967 admin slot or `owner()` — while the identical call from an unprivileged control address reverts | `reachable-upgrade-authority` |
| `privileged-minting` / `risk.mint-authority` | `mint(address,uint256)` is in the executing bytecode (implementation for a proxy) and `mint(control, 1)` is accepted from `owner()` or the EIP-1967 admin, while the identical call from the control address reverts | `reachable-mint-authority` |

- Control address: `keccak256("arcy-risk-control-v1")[12:]` — no key exists for it.
- All reads are `eth_call` / `eth_getStorageAt` / `eth_getCode` / header at the report's exact block. The upgrade simulation targets the **current** implementation, and `eth_call` persists nothing.
- `VERIFIED_ONCHAIN` requires the identical outcome (actor role, actor, selector) at the identical block hash from **two registered operators** (`lib/verification/source-identity.js`). One operator → `SINGLE_SOURCE` → engine `UNKNOWN`. Disagreement → `CONFLICTING`. Different hashes → `CONFLICTING / BLOCK_HASH_MISMATCH`.
- A provider error on any read fails that endpoint; only a revert is treated as a contract property.
- Budget: ≤ 18 read-only calls per endpoint, two endpoints, 3 s per call, 6 s overall, no retries; watchdog cooldown ⇒ the provider is skipped.

What it never does: emit `false`, treat a missing getter, an empty slot, a selector, a bytecode heuristic or a GoPlus label as a finding, or send a transaction. "Not demonstrated" is `NOT_VERIFIED` (engine `UNKNOWN`), never "no risk". Even a forged `false` record carrying this producer's id cannot become `NOT_CONFIRMED`: the gate only accepts `true` from it.

Limits of the claim: a successful `eth_call` shows the authorization check passes for that actor at that block. It is not proof that a transaction would be included, that the actor's key or multisig is live, or that a timelock does not delay execution. Mint authority through roles other than `owner()`/admin (e.g. `MINTER_ROLE` holders, master-minter schemes such as USDC) is not enumerated and stays `UNKNOWN`. Non-EIP-1967 proxies (e.g. legacy ZeppelinOS slots) stay `UNKNOWN`.

## Per-rule evidence availability (Arc 5042 · Ethereum 1 · Robinhood 4663)

| Rule | Producer | Arc | Ethereum | Robinhood | Why |
|---|---|---|---|---|---|
| `admin-upgrade-authority` | authority v2 (positive only; needs a reviewed code hash — none yet) | Circle + QuickNode | Allnodes + dRPC | official + dRPC | see above; negative needs a complete upgrade-path audit that no producer performs |
| `privileged-minting` | authority v2 (positive only; needs a reviewed code hash — none yet) | same | same | same | negative needs a complete supply-increase audit |
| `high-exit-impact` | **none (rule design blocker)** | — | — | — | The rule probes 1 % of input-side active reserves. For a constant-product pool that yields ≈ 0.99 % impact regardless of pool size (measured: 9 872 ppm on every V2 pool in the #209 probe), so the rule would return `NOT_CONFIRMED` ("low impact") even for a $100 pool. Technically bounded, but misleading. Needs a fixed-size probe (e.g. USD amount with a reviewed oracle) before any producer |
| `low-pool-liquidity` | none | — | — | — | Needs reserves valued by a reviewed on-chain oracle at the same anchor. Market-reported liquidity is not that. No reviewed oracle path on Arc or Robinhood; Ethereum would need Chainlink-per-quote-asset review |
| `sell-transfer-tax` | none | — | — | — | Needs a replay isolating the token-side deduction from pool fees (balance deltas across a transfer). Not observable with plain `eth_call` without state overrides |
| `top-ten-holder-concentration` | none | — | — | — | Needs the complete holder set reconciled to same-block total supply by two operators. Arc's worker publication reconciles completeness but is single-operator; re-reading every balance on a second operator is unbounded without Multicall review |

All rules without a producer answer `UNKNOWN / PRODUCER_NOT_REVIEWED` or `EVIDENCE_MISSING` — never `NOT_CONFIRMED`.

## Durability

The Evidence Ledger needs `ARC_VERIFICATION_LEDGER_DIR` or `ARC_HOLDER_PUBLISHED_DIR`. On Vercel neither is durable or shared, so shadow results there report `ledger.history: NOT_PRESERVED`. Retained risk history exists only where the worker volume is mounted. Writes are atomic (lock + fsync + rename), throttled to one rewrite per minute per unchanged record, and time-bounded (1.5 s).

## Next release gates

1. Owner review of the producer semantics and this matrix.
2. Live probe results on the current head (appended to the PR).
3. Shadow mode on a preview or the worker with durable storage, comparing producer records against the ledger over time.
4. Only then: a reviewed, backward-compatible, opt-in diagnostic API field — not part of this change.
