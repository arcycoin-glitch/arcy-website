# V8 two-card evidence audit — 27 October 2026

## Preserved source
Production READY: adeddc74ac752b4cbf20ca98fd7e21eeddf850c2, dpl_F1xFqHY2Se7oVNin9MrsNHbvqtsS. Branch data/v8-two-card-evidence-20261027 starts there; earlier pushed62d65dd remains intact. PR59/60/61 reviewed. Screenshot identity was not independently supplied, so no token was guessed.
Trace: exact-chain RPC token inspection -> adapter -> mechanics-deep/supply-insights -> data-engine -> frozen schema/render. Production already has Total/Circulating/Burn Address/Next Unlock primary rows. No Holder, worker, UI, schema, Pulse, other card or homepage edits.

## Proven fixes
1. TOLLY owner() reverts; it is not a zero owner. Full source has immutable pad and one-time only-pad setPool. Exact-source profile establishes constructor-only mint, token-transfer0 and pinned pad/pool setup state. Nonzero pool means setup completed, not universally renounced external control.
2. Generic token source digest previously preserved unproved buy/sell zero claims. Broad fee preservation now requires reviewed hook/portal digests, runtime match and exact token/chain/block. ARCY3/3/0 retained. TOLLY/cirBTC correctly show transfer0 only, external fees NOT VERIFIED. Previous observations remain in evidence.
3. Unlock normalization required DATA_FOUND but not token identity. It now requires exact subject and rejects conflicting address/token/contract, chain/network. Separate vestingContract identity and decimal strings retained. No new unlock invented.

## Actual production baseline versus local real-source API
Counts mean source-backed row availability, not complete independent security verification.

| Network/token | Exact contract | Mechanics before -> after | Supply before -> after |
|---|---|---|---|
| Arc ARCY | 0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b |4 ->4|2 ->2|
| Arc TOLLY | 0xbc43ce8dec648ea298c4275559b81d6261c90b67 |3 ->4|2 ->2|
| Arc cirBTC | 0x171a4217b86a807a64eb94757db6849fb4bdbaa0 |4 ->4|2 ->2|
| Ethereum USDT | 0xdac17f958d2ee523a2206206994597c13d831ec7 |4 ->4|2 ->2|
| Ethereum USDC | 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 |4 ->4|2 ->2|
| Ethereum ONDO | 0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3 |4 ->4|2 ->2|
| Robinhood LINK | 0x492641f648a4986844848e0befe66d14817bce34 |2 ->2|2 ->2|
| Robinhood TSLA | 0x322f0929c4625ed5bad873c95208d54e1c003b2d |4 ->4|2 ->2|
| Robinhood PONS | 0x39dbed3a2bd333467115de45665cc57f813c4571 |4 ->4|2 ->2|

Mechanics33/36 ->34/36: tax-row8/9, mint8/9, owner8/9 ->9/9, architecture9/9. Seven ->eight contracts with four sourced rows. Only ARCY has reviewed linked buy/sell hook evidence in final sample; seven other tax rows cover token transfer only. Owner getter is not a full privilege audit. Supply18/36 unchanged: total9/9 and burn-address9/9, circulating0/9 and next unlock0/9; no four-of-four supply token. No historical or provider-failure value counted as current evidence.

## Sources and genuine limitations
Full reviewed source: https://sourcify.dev/server/v2/contract/5042/0xbc43ce8dec648ea298c4275559b81d6261c90b67?fields=all . Digest2fe87a0ede258f1d3827f837a1a42c860542e346867f64fe5c89fdb7feefe90b matched to pinned deployed runtime. Inherited ERC20, anti-snipe rule and setPool reviewed; no address/symbol override. pad()/pool() reread at current block.
Circulation provider remains commercial-permission blocked; no complete exact-contract issuer exclusion ledger established. Never total-minus-dead. No supported exact-contract future unlock schedule in sample: CoinBell lacks addresses, ONDO emissions requires paid HTTP402 access, issuer allocations do not prove exact future executable dates/amounts, Ethereum reviewed registry empty. Existing Today/7D/30D known-event-only semantics preserved. LINK source unavailable through permitted adapters; selectors do not prove mint absence or taxes. No restricted provider enabled.

## Tests, latency and release state
Focused44/44 PASS. Exact-production full baseline521/535 PASS,14 FAIL; final candidate524/538 PASS,14 SAME failures. No assertions weakened or unrelated failure repaired. Initial sandbox EPERM atomic-file failures were environmental; one simultaneous-run worker timing failure did not reproduce in final standalone full run. Holder code untouched.
Local browser23 scenarios PASS across320/360/390/430/768/1024/1440. Captured real API responses replayed for rendering; not additional live coverage. Both scoped cards have four direct rows, twenty existing rows retained, evidence/navigation work, no overflow/runtime errors. Other-card disclosures unchanged.
Production aggregate report latency mean4686ms/worst10793ms; final local real-source mean6896ms/worst13173ms. Different host/network/aggregation prevents claiming a speedup. Same-block isolated Mechanics enrichment separately established TOLLY pad/pool at the baseline block. No provider/RPC speed promise.
Preview/production acceptance remains separately gated. No production success claim from local tests, fixture rendering or build readiness.
