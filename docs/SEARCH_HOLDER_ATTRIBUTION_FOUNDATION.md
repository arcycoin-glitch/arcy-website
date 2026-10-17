# ARCY SEARCH — Holder attribution foundation (review-only)
This is **not** a new holder census or a verified classification dataset.
The module provides a fail-closed contract for future *per-address* evidence.
Only standard zero/dead addresses receive a deterministic custody label; this
is not an issuer burn event. Named roles require a reviewed exact-chain,
exact-address issuer/verified explorer/registry proof, and are still **not**
claims of beneficial ownership. Unknown addresses remain UNKNOWN.

## Next data integration work
1. Obtain permissioned, source-backed top-holder **address rows** at a pinned
   block rather than trying to infer identity from four aggregate percentages.
2. Establish an allowlisted, auditable provenance registry for exact addresses,
   independently verify issuer source claims and record review timestamps.
3. Add non-invasive per-address drilldown with clearly scoped evidence, without
   replacing any of the five existing cards/twenty fields.
4. Audit classifications under chain reorg, proxy migration, explorer/API 403,
   source expiry, custody reuse, and source revocation.
5. Independently test against real addresses across Arc, Ethereum and
   Robinhood before exposing labels in the production Search UI.

**This initial stage does not alter production reports, visible design, API
schema, holders ranking, provider permissions, railway worker, or deployment.**
