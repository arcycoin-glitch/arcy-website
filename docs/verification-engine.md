# ARCY verification engine

`lib/verification/metric-evidence.js` defines version 1 of the evidence contract. The producer submits a metric ID, exact network and token, optional scope for a particular pool or sample, unit, engine version, and up to eight observations. A pinned observation carries the block number and hash. Each observation identifies the source, upstream operator, observation time, and method. Source and provenance identifiers are short, secret-free labels.

Values are scalar. Use decimal strings for EVM integers and fractional values so comparison preserves precision. Timestamps use canonical UTC and `dataAgeMs` measures the time from observation to evidence generation. Consumers must assess freshness again when serving stored evidence.

## State rules

| State | Current value | Evidence rule |
| --- | --- | --- |
| `VERIFIED_ONCHAIN` | Present | Two or more independent RPC operators agree exactly on the value, unit, block number, and block hash. Every observation in the record agrees. |
| `INDEPENDENTLY_CROSS_CHECKED` | Present | At least two operators agree exactly on value, unit, and observation time with matching anchors where present. |
| `SINGLE_SOURCE` | Present | Observations from one operator agree. This is an unverified value. |
| `CONFLICTING` | Withheld | Disagreement identifies the affected source IDs and the reason. |
| `STALE` | Withheld | The observations are outside the metric's freshness policy. |
| `UNAVAILABLE` | Withheld | The producer could not obtain the required observations. |
| `UNSUPPORTED` | Withheld | The chain, asset, protocol, or metric operation is outside the producer's coverage. |
| `NOT_VERIFIED` | Withheld | The observations are missing required evidence or cannot be compared safely. |

RPC provider aliases must share an operator ID when they use the same upstream. Producers must establish the chain, target, anchor, and correctness of the decoded value before constructing observations. Strict parsing rejects malformed records and verifies that a trusted claim has the required agreement. A failure record can carry diagnostic observations with a reason code. Historical values belong to the ledger, outside the record's current value.
