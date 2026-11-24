# Mechanics V8 verification

The original cohort is the immutable 40-subject list in
[`data/verified-coverage/radar-cohort-20261121.json`](../data/verified-coverage/radar-cohort-20261121.json):
10 Arc, 10 Ethereum and 20 Robinhood Chain, including Pons. The historical V7
preview (12/40) used a different observation time. Compare V8 against the
V7 baseline measured at the **same block for every subject** to isolate the gain.

[PR #322](https://github.com/arcycoin-glitch/arcy-website/pull/322) includes the
latest measured results and the individual diagnoses for the 28 original misses.
Download `mechanics-bench-fixed40-paired.json` from the read-only benchmark run's
`mechanics-bench` artifact. It records all 40 identities, both tax states,
block, source bindings, implementation candidates, authority, fee attribution,
burn capability, diagnostics, and request counts. The broader regression
benchmark also retains its previous sample groups.

## Reproduce

On a network-enabled runner with one checkout for each revision, run these
commands from a separate temporary output directory. The first invocation
records the V7 inputs; both replays reuse exactly the recorded block for each
subject. Candidate replay may fetch only bounded read-only evidence explicitly
allowed by the paired gate.

```sh
BENCH_FIXED_COHORT=1 BENCH_REPLAY=record BENCH_ROOT=/path/to/v7 node /path/to/v8/scripts/bench-mechanics.cjs beforelive
BENCH_REPLAY=replay BENCH_ROOT=/path/to/v7 node /path/to/v8/scripts/bench-mechanics.cjs before mechanics-samples.json
BENCH_REPLAY=augment BENCH_ROOT=/path/to/v8 node /path/to/v8/scripts/bench-mechanics.cjs after mechanics-samples.json
node /path/to/v8/scripts/assert-mechanics-bench.cjs mechanics-bench-before.json mechanics-bench-after.json
node /path/to/v8/scripts/measure-mechanics-v8.cjs mechanics-bench-before.json mechanics-bench-after.json fixed40.json
```

The strict denominator is always 40. A strict success needs pinned,
typed token deductions for buy, sell and transfer within the verified scope.
A single route's hook fee, wallet transfer only, or historic observation does
not qualify. A successful replay containing bounded new requests is labeled
`augment`; latency is not equivalent to an ordinary live request.

## Proof boundaries

- Exact source bundles for standard proxy and controller families are matched
  against complete source contents and the compiler target, then against pinned
  deployed runtime. Canonical OpenZeppelin and reference Diamond versions and
  source commits are embedded in the review manifests. Other diamonds, custom
  delegated execution, and controllers remain unresolved when their routing or
  authorization is not proven. The Diamond registry applies the reviewed
  implementation's layout; ERC-2535 does not prescribe that layout.
- Following an immutable clone changes the executed code, never the storage
  context. Incomplete paths retain the immediate candidate address and do not
  obtain a terminal ABI. The reviewed MORPHO token has independent evidence for
  its **current** UUPS implementation, using its source bundle, canonical proxy,
  UUID, slot and proxy-context getter. This comparison can change over blocks.
- A declared owner, candidate admin, signer, or configured delay is not an
  executable upgrade permission. The trace limits are six nodes, depth three,
  20 logical reads, four source lookups and 2.6 seconds. Incomplete traces do
  not erase proofs already established. RPC endpoint hostnames are captured
  without URLs, authentication or route tokens.
- Fee attribution keeps the token charge, LP pool fee, protocol fee, router,
  hook, aggregator, gas and slippage distinct. The reviewed Arc hook and its
  PoolKey support separate scoped hook and configured LP fee evidence. A router,
  aggregator, or executable quote needs separate transaction or route context.
- Historic slot checks pin canonical block hashes before and after the reads
  and preserve provider disagreements. The optional local checkpoint is reused
  only for the same chain, token, provider and canonical hash. Spot checks
  establish changes between sampled blocks; they are not a complete upgrade log.
  No production worker format or scheduler changes were made.
- A reviewed supply-reducing method proves capability, not an actual burn.
  A receipt can prove a direct burn for the eligible exact profiles. A transfer
  to a dead address and unverified buyback claims never establish supply
  destruction. Buyback execution requires an independently attributed funding
  source, spend and destination.

Operator probes, using public RPC or configured archive RPC:

```sh
node scripts/probe-mechanics-v8-history.cjs ethereum TOKEN BLOCK_A,BLOCK_B checkpoint.json
node scripts/probe-mechanics-v8-burn.cjs ethereum TOKEN TX_HASH
```
