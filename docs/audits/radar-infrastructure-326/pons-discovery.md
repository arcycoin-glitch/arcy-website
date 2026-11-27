# Pons discovery reliability and existing coverage

## Attribution and unchanged policy

The public data revision `db6a95a531889c733673c8c0ea3de9d78deb0888`, generated
`2026-11-27T04:37:54.673Z`, already contains 10 Arc, 10 Ethereum, 10 Robinhood and
10 Pons rows. The preceding 39/40 shortfall recovered before this change through
the existing scheduled snapshot run. **Attributable coverage gain: zero.** No
candidate source, quality threshold, score, membership budget, provider licence,
production configuration, subscription or public UI was changed here.

The same-input audit is preserved in `pons-discovery-quality.json`. It includes
all 40 exact addresses and their original timestamps, profile evidence, market
observations, history, critical findings and the engine's exclusion counts.
It must not be described as 40 safety-certified investments.

## Defect and fix

`pons.membership()` previously ignored an individual `eth_call` error inside an
otherwise successful RPC batch. An unresolved launch could consequently be
reported as nonmember; `ponsLookup()` then cached that null result for the
source TTL. A single temporary factory failure could shrink a ten-row Pons
edition to a fresh nine-row edition, or allow an unresolved launch to remain
in Robinhood's general intake.

A negative now requires every factory to return an ABI-sized record with a
canonical `exists=false` flag. Empty/malformed records, invalid bools, a
positive record naming another token, and per-call RPC errors are unavailable
evidence. A valid positive record from any official factory remains sufficient.
Unresolved negatives fail through the existing
`RADAR_PONS_MEMBERSHIP_UNAVAILABLE` path. The last complete edition may then be
served only as bounded **STALE**, preserving its original observation time;
failure does not cache a false negative. Repair is immediately retryable through
the existing request flow. No automatic retry or extra provider call was added.

## Real factory compatibility and paired replay

One read-only public Robinhood RPC probe at chain 4663, block `0x76521ee`, used
two HTTP requests and 14 logical RPC calls: chain/head plus twelve pinned
factory calls for four subjects. The subjects were DELTA, ORBIO, official WETH
and STATICS. Both V1 factories returned 13-word structs (834 characters with
`0x`); V2 returned 15-word structs (962 characters). All ten sampled negative
records were full structs, not empty `0x`. DELTA matched the V1 factory and
ORBIO the V2 factory; neither control was a launch.

The complete responses are retained in
`test/fixtures/radar/pons-factory-shapes-20261127.json`. Replaying identical
answers against base `bf33726` and this change gives:

| Input | Before | After | Membership HTTP calls |
|---|---|---|---:|
| Captured healthy answers | Same 2 launches, 2 nonmembers | Same 2 launches, 2 nonmembers | 2 → 2, including existing V1 graduation lookup |
| One positive V1 call changed to a temporary RPC error | Incorrectly claims complete check of 4, returns only ORBIO | Reports incomplete check, publishes no false negative | 1 → 1 |
| Ten-row cached edition, one factory call fails after TTL | Could replace the edition with fresh nine | Retains the original ten as STALE; repair restores fresh ten | Existing request paths only |

The fault is deliberately injected into the same recorded provider input. It
demonstrates the defect and failure handling; it is not a claim that a sampled
production RPC request actually failed.

## Quality and exclusions of the existing 40

The published custom-filter policy treats critical evidence as hard vetoes and
ordinary missing/suspicious market evidence as disclosed ranking limitations.
This infrastructure fix preserves that distinction and the qualified fallback
path. Historical price events are not automatically fraud findings.

| Network | Rows | Official project | Self-published exact-contract site | Listed project channels | Low-confidence watch rows |
|---|---:|---:|---:|---:|---:|
| Arc | 10 | 2 | 4 | 4 | 4 |
| Ethereum | 10 | 10 | 0 | 0 | 0 |
| Robinhood | 10 | 3 | 3 | 4 | 1 |
| Pons | 10 | 1 | 6 | 3 | 4 |
| Total | 40 | 16 | 13 | 11 | 9 |

- All 40 carry a project profile under the existing policy: 16 official
  contract identities and 24 corroborated metadata identities. Listed channels
  remain creator-reported and are not relabelled official.
- No displayed row has a confirmed-critical finding or intersects the 22-entry
  persistent-risk ledger. All ten Pons rows carry an official factory record.
- Current observed 24h changes range from -14.739% to +61.709%; none reaches the
  existing +70% spike warning. ARGUS and HYENA lack a verified current 24h
  value; missing values are not evidence that they have not risen.
- Six rows retain historical price-event flags. SOLON has an observed 4.91x
  run-up; ARCANUS 3.06x and a historical +110.342% 24h rise; FOBO 2.43x and
  +84.293%; OAK +99.03%; oBrain retains an earlier sharp-drop flag; HYENA
  retains a -61.6% drawdown from its observed peak. None reaches the existing
  8x hard run-up threshold in the preserved observations. Historical sample
  coverage remains incomplete.
- Four rows are below the current custom ranker's research-liquidity reference:
  GLITCH $13,574 and Builders $14,740 versus Arc $20,000; JAZZ $9,219 and HYENA
  $5,262 versus Pons $10,000. These references are existing ranking penalties,
  not newly relaxed admission floors. HYENA also has a suspicious 21x
  volume/liquidity ratio; it is not reported as verified organic demand.
- The existing Pons intake considered 38 candidates; its display stage recorded
  five critical provider-conflict vetoes and eight missing-profile vetoes. Those
  thirteen exclusions remain in force. The other networks' exact veto counts
  and samples are preserved in the JSON audit.

No new market intake was necessary to assert 40/40. The implementation fixes a
source-failure classification error rather than padding the list or weakening
the policy to guarantee ten candidates under every market condition.

## Validation

95 tests passed across the new membership-integrity suite and the existing
Radar V2, V3 discovery and Pons-ledger suites. Coverage includes real V1/V2
negative shapes, malformed/per-call errors, positive evidence with another
factory unavailable, no partial-as-complete result, ten-to-nine cache poisoning,
bounded stale handling, immediate repair, factory-only identity and Pons/RH
separation. No Mechanics or Holder module was modified.
