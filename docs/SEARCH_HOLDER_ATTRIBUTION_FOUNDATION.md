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

## First read-only integration (review branch)
- For Ethereum tokens with at least 21 well-formed Blockscout holder candidates,
  each candidate receives a pinned RPC balance, and the 20 largest candidates
  are reported with exact public addresses, candidate-relative ranks, and
  percentages of pinned total supply. This **does not prove global rank**.
- Each address receives only deterministic zero/dead custody attribution or
  UNKNOWN. No issuer treasury, exchange, LP, bridge or vesting label is
  assigned without an independently reviewed source record.
- The holder report keeps its original four metric identifiers. The optional
  `holderCandidates` array is shown **only within the existing evidence panel**
  with Blockscout address links and explicit candidate-scope limitations.
- Arc historical COMPLETE publications and Robinhood holder metrics remain
  intact and unchanged. No new addresses are invented when explorer feeds
  return 403 or source coverage is absent.
- A failed pinned RPC reconciliation yields no address candidates.

## Validation and release status
- Added seven focused Node test scenarios (five classifier and two candidate tests).
- Code committed to GitHub, but test execution **has not been confirmed**:
  the isolated runner cannot access the repository over the network.
- Do not merge or deploy until CI/Node suite, API responses for ONDO and other
  Ethereum tokens, UI acceptance at 320/390/768/1440px, and security review
  have completed. In particular, the optional candidate field must not change
  the existing count, concentration metrics or evidence semantics.
- Source-backed roles beyond deterministic zero/dead **are not yet populated**;
  achieving that requires an independently reviewed issuer/explorer registry,
  provenance controls, and reviewed claim expiry/revocation.

## Report engine and browser acceptance gates
- The schema-preserving report formatter now retains up to twenty candidate
  addresses **only for Ethereum**, when the holder RPC evidence and candidate
  block match. Non-Ethereum reports and invalid evidence receive no candidates.
- Public Ethereum explorer links appear only inside the pre-existing holder
  sources/evidence disclosure. No new core card or metric is introduced.
- Tests now additionally cover fail-closed candidate ranks, invalid balances,
  wrong-chain metadata, mismatched evidence blocks, and attempted unreviewed
  role promotion.
- Vercel preview for current commit was READY, indicating deployment build
  success, but this alone does **not** establish Node test passing or live
  holder result correctness. Production must remain unchanged.
