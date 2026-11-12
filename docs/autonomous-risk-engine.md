# ARCY Autonomous Risk Engine V1

`lib/risk-engine/index.js` exports the pure CommonJS function `evaluateRisk({ network, chainId, token, scope, evidence, now })`. Pass `now` as UTC epoch milliseconds, `token` as a canonical lowercase EVM address, and `scope` as a lowercase pool address or PoolId, or `null`. Network and chain ID must match `arc` / `5042`, `ethereum` / `1`, or `robinhood` / `4663`. Invalid target or clock arguments and batches above 32 records throw fixed errors. The engine reads neither system time nor configuration. It makes zero network and filesystem calls.

`evidence.js` uses the main-branch `MetricEvidence` parser. Only the exact network, token, metric ID, and scope are considered. A token-wide rule uses a null evidence scope even in a pool evaluation. The six `risk.*` identifiers are private evidence vocabulary for future producers. They do not extend the 20 Search metrics. This interface assumes records from trusted, reviewed producers that established the actual independence of their upstream operators. Schema parsing establishes internal consistency. It cannot authenticate a caller, perform an audit, or prove that two operator labels represent two real operators.

## Finding contract

The result contains `schemaVersion: 1`, `findings`, and `dataQuality`. The findings are ordered by `ruleId`. Each has exactly these fields.

| Fields | Allowed values |
| --- | --- |
| `ruleId`, `ruleVersion` | One of the IDs below and a positive integer. V1 starts every rule at version 1. Bump a rule's version when its evidence semantics or threshold changes. |
| `network`, `chainId`, `token`, `scope` | Validated target identity and exact pool scope where applicable. |
| `severity` | `HIGH` or `MEDIUM` for confirmed findings only. Otherwise `null`. |
| `status` | `CONFIRMED`, `NOT_CONFIRMED`, `UNKNOWN`, `STALE`, `CONFLICTING`, or `UNSUPPORTED`. |
| `reasonCode`, `explanation` | Allowlisted codes and static prose from `index.js` or `rules.js`. Evidence contents are never interpolated. |
| `evidenceRefs` | At most two `{ metricId, digest, block, state }` objects. The SHA-256 digest identifies the canonical parsed record with stable source ordering. `block` is `{ number, hash }` or `null`. Recompute the digest on the original reviewed record to audit it. No provider identity, endpoint, failure text, or raw value is emitted. |
| `observedAt`, `evaluatedAt` | Canonical UTC. `observedAt` is the oldest observation supporting the selected record where one applies, otherwise `null`. |

`CONFIRMED` and `NOT_CONFIRMED` require one fresh `VERIFIED_ONCHAIN` record from at least two independent operators at the same pinned anchor, **produced by an engine `{id, version}` listed in that rule's `producers`** (review gate, below). All observations must use the exact rule method and reference the expected contract or pool. `NOT_CONFIRMED` means the evidence establishes the bounded negative condition in the table. `UNKNOWN` includes missing data, single-source and externally cross-checked records, mismatched semantics, or multiple distinct records with no proven conflict. `STALE` applies to a stale record or when all applicable observations are beyond the rule window. A fresh reported conflict, different verified hashes at one height, or differing verified values at the same anchor and unit yields `CONFLICTING`. A future record is withheld. The adapter does not select a winner from conflicting records or revive a prior value. `UNSUPPORTED` reports an explicit unsupported producer result.

`dataQuality` contains `coverage` (`COMPLETE` or `INCOMPLETE`), counts by finding status, `rejectedEvidence`, and `ignoredEvidence`. Complete coverage requires a bounded positive or negative determination for each rule with no malformed inputs. It describes evidence coverage. The engine returns no aggregate risk or safety rating.

## Review gate (added in security review)

Method names, operator labels and `engine.id` are self-declared by whoever builds a record, and the `MetricEvidence` parser can only check internal consistency. Without a gate, any code path could submit a record such as `risk.mint-authority = false` with method `complete-mint-authority-audit` and receive `NOT_CONFIRMED` with the explanation "the complete mint-authority audit found no privileged mint path" — a safety statement that no audit produced.

Each rule therefore carries a frozen `producers` list of reviewed `{ id, minVersion }` entries. A positive or negative determination is returned only for records from a listed producer; anything else is `UNKNOWN / PRODUCER_NOT_REVIEWED`. **V1 lists no producer for any rule**, so the public `evaluateRisk` cannot return `CONFIRMED` or `NOT_CONFIRMED` today. Adding a producer is a code change to `rules.js` and needs its own review. `CONFLICTING`, `STALE` and `UNSUPPORTED` are fail-closed and are still reported from any producer.

`lib/risk-engine/engine.js` holds the rule-parameterised evaluator so the rule logic can be tested with a fixture producer; `lib/risk-engine/index.js` binds the frozen V1 rules and is the only entry point for production code. The Search verification runtime (`arcy-verification-runtime`, PR #225) emits Search metric IDs only and is not a reviewed risk producer; its records are ignored, and even relabelled `risk.*` records stay `PRODUCER_NOT_REVIEWED` (tested).

## Rule policies

These thresholds are explicit V1 review thresholds for the bounded claim. They have no calibrated relationship to investment outcomes. Basis points are integers from 0 through 10,000, rounded down from the exact ratio by the producer. Values and thresholds in this table are synthetic test scenarios.

| Rule / private metric ID | Minimum typed evidence | Positive / negative fixture | Maximum age |
| --- | --- | --- | --- |
| `admin-upgrade-authority` / `risk.upgrade-authority` | Boolean. A reviewed reachable upgrade path and live controlling authority (`reachable-upgrade-authority`). False requires a complete review of active proxy, implementation, and upgrade authorization paths (`complete-upgrade-authority-audit`). | True / audited false | 1 hour |
| `high-exit-impact` / `risk.exit-impact` | Bps. Reviewed pool identity and pinned single-pool sell replay for 1% of input-side active reserves (virtual reserves for concentrated pools). Compare model output to fee-adjusted mid-price output (`pinned-one-percent-reserve-exit-replay`). | 500 / 499 bps | 5 minutes |
| `low-pool-liquidity` / `risk.pool-liquidity` | Unsigned decimal string in USD cents. Independently checked reserves attributable to the identified pool, valued using reviewed, current on-chain oracle inputs at the same anchor (`pinned-pool-reserves-oracle-usd`). | 2,499,999 / 2,500,000 cents | 15 minutes |
| `privileged-minting` / `risk.mint-authority` | Boolean. A reviewed reachable supply-increase path with live privileged control (`reachable-mint-authority`). False requires a complete audit of reachable supply-increase paths and authorization across current implementation and delegation (`complete-mint-authority-audit`). | True / audited false | 1 hour |
| `sell-transfer-tax` / `risk.sell-transfer-tax` | Bps. Reviewed pinned sell-transfer replay for 1% of input-side active reserves that isolates token-side deduction from pool fees and slippage (`pinned-one-percent-reserve-sell-transfer-replay`). | 100 / 99 bps | 15 minutes |
| `top-ten-holder-concentration` / `risk.top-ten-concentration` | Bps. Complete positive-balance ranking reconciled to pinned total supply, excluding only documented zero/dead custody from both ranking and denominator (`pinned-complete-holder-supply-reconciliation`). | 5,000 / 4,999 bps | 24 hours |

Negative results are bounded to the reviewed architecture, reconciled snapshot, or simulated trade. Concentration describes addresses. Beneficial ownership and exchange custody require additional evidence. Reserve value has no direct equivalence to executable depth. A sell replay does not establish buy taxes, wallet-specific restrictions, future fees, transaction inclusion, slippage across other venues, gas, or MEV. Unreviewed proxy patterns, incomplete holder sets, hook-dependent quotes and missing oracles lack the minimum proof.

## Existing evidence and later integration

| Current Search fields | Potential use and boundary |
| --- | --- |
| `mintCapability` | Candidate for mint-authority evidence after reviewed path and actor checks. A selector, an absent getter, or fixed-looking supply cannot prove the negative. |
| `ownerAdmin`, `contractArchitecture` | Candidate provenance for upgrade authority. An owner getter or implementation slot alone is insufficient. |
| `tradingTaxes` | Candidate for reviewed sell replay. Reported taxes or a quote amount alone are insufficient. |
| `top10Pct`, `holderCount`, `largestWalletPct`, `top20Pct` | `top10Pct` can inform the concentration rule only through a complete independently reconciled census with the same denominator. The other fields are context, without V1 rules. |
| `liquidityUsd`, `dexPairCount`, `liquidityTurnover24h`, `volume24h` (both cards) | Provider-reported values cannot establish oracle-valued reserves or standardized exit impact. Existing Liquidity/Exit replay is a candidate producer only after confirming the reviewed probe, pool and independent provenance. |
| `totalSupply`, `nonBurnSupply`, `burnAddressBalance`, `burnAddressPct` | Supply may support a holder reconciliation. These fields are insufficient to establish authority or serve as independent V1 findings. |
| `priceUsd`, `valuation`, `change24h` | No direct V1 rule. Market changes do not establish contract risk. |

After the verification runtime lands, review an adapter per metric and supported protocol, run it in shadow mode against the current ledger record for each fact, and compare accepted, unsupported and rejected coverage. Keep operational integration behind `ARC_AUTONOMY_RISK_ENGINE_ENABLED`, enabled only by explicit value `1`. This PR adds no runtime flag reader, scheduler, route, or caller, so it has no operational effect. It adds only `lib/risk-engine/` (`index.js`, `engine.js`, `evidence.js`, `rules.js`), `test/risk-engine.test.js`, `test/risk-engine-review.test.js`, and this document.

## Resource and regression checks

One evaluation parses at most 32 records with up to eight observations each. The most expensive comparison is bounded to 496 pairs. The output has six findings, at most 12 digest references, and static explanations of at most 160 characters. The stress fixture exercises the maximum record count with a 2-second test ceiling and an 8 KiB output limit. Those are test bounds. This code has no production latency measurement.

Run `node --test test/risk-engine.test.js` for the focused fixture suite and `npm test` for regression. The existing PR workflow provisions Node 22 and Redis. The existing Docker job covers any changes under `lib/`.
