# Contract & Mechanics V5 (2026-11-15)

Scope: evidence engine only. The four visible rows, the 20-check Search contract, `search/index.html` (byte-protected) and
all other cards are unchanged. Risk Engine public flags stay OFF.

## Measurement method
- Sample: the standard Mechanics bench sample (`scripts/bench-mechanics.cjs`): 3 regression contracts, 12 fixed Ethereum
  tokens and the top Radar tokens per network, including the Pons subset of Robinhood (46 contracts).
- Paired replay: BEFORE (main) records every provider answer at one pinned block per contract; AFTER (branch) replays the
  identical answers. New requests are allowed only in named, budgeted, read-only kinds, and the paired gate
  (`scripts/assert-mechanics-bench.cjs`) enforces them per contract.
- Each field is classified as DATA_FOUND, PARTIAL_EVIDENCE, NOT_VERIFIED, RPC_ERROR, SOURCE_UNAVAILABLE,
  UNSUPPORTED_CONTRACT or STALE (`dataClass` in the bench). PARTIAL_EVIDENCE means one of two cases:
  - a token-transfer-only tax row ("Transfer 0% · DEX/hook fees NOT VERIFIED");
  - an exact-runtime verified source whose execution path is not yet reviewed.
- Ethereum now runs through the same `mechanics-coverage` wrapper as Production.

## Source review
Source text was read from Sourcify in CI with `scripts/probe-mechanics-sources.cjs`. That probe resolves the executed
runtime, re-validates identity with the production validator and prints transfer-path and privileged functions.
The workflow is `mechanics-source-review.yml`. Every profile is keyed only by the full sorted source-content digest.

| Profile | Digest | Finding |
|---|---|---|
| `UNISWAP_UERC20_FIXED_SUPPLY` (Robinhood UERC20) | 530718da… | Solady ERC20; constructor-only mint; only approve/transfer/transferFrom/permit; no admin. Permit2 has a built-in infinite allowance. |
| `FIXED_SUPPLY_SELF_BURN` (SHIB) | 8bcf4ef2… | Constructor-only mint; holder self-burn; no owner. |
| `LEGACY_FIXED_SUPPLY_SELF_FREEZE` (BNB) | 78eedccb… | Constructor supply; holder self-freeze/burn; the owner can only withdraw ETH. |
| `ERC1155_WRAPPED_FIXED_SUPPLY` (NPC) | 398bcb70… | Fixed supply held by the contract; 1:1e18 ERC1155 wrap; the owner has only ownership functions. |
| `PAXOS_SUPPLY_CONTROLLED` (BUSD implementation) | f529ab7e… | Supply-controller mint; owner pause and role setters; asset-protection freeze/wipe. |

Proxy binding: the ZeppelinOS `AdminUpgradeabilityProxy` outer source `a3ba0c7d…` (PAXG and BUSD) is now reviewed. It has
the `ifAdmin` admin surface, and non-admin calls delegate. The probe confirmed the constants in the raw source:
`IMPLEMENTATION_SLOT=0x7050c9…` and `ADMIN_SLOT=0x10d6a5…`, identical to the already reviewed `b49bec60…`.

Not reviewed (remaining NOT VERIFIED):
- PAXG V3 implementation: about 510 functions with a rewards and payout-group system, too large for a sound review in this
  pass.
- XAUt: the outer proxy `cccdea8d…` is not reviewed.
- Zama, BridgedFP, Tibbir: banned assembly or bridge code.
- Arc ArgusTax restrictions: handled by the legacy Arc route.
- Robinhood NoxaFun: Sourcify reports `SOURCE_SCHEMA_INVALID` (Yul).

## Transfer Restrictions (supplementary)
`search/server/lib/mechanics-restrictions.js` publishes a finding only for a reviewed complete source or an accepted
pinned-OpenZeppelin template. Values include:
- None in token code
- Pause + blacklist · not paused
- Pause + freeze
- Owner pause
- Pause + blocked accounts
- Launch buy limits until block N / expired
- Bot blocklist (frozen) · limits removed
- Investor vesting locks · transfers enabled

Pause state, launch end block, `transferAllowed`, `limited` and pair come from pinned reads. Behind any replaceable
implementation (proxy slot or beacon), absence is shown as "None in current code · upgradeable". A selector or ABI name
alone never produces a finding.

The field lives in `card.supplementary.transferRestrictions`, validated in `data-engine` with the same chain, token and
block binding as the four fields. It is shown through the existing research-note and proof list under
"View sources & evidence", so the 20-check tally is unchanged.

### Fourth-row decision
Pre-registered rule: replace "Contract Architecture" only if, on the same paired sample, Transfer Restrictions
DATA_FOUND ≥ Contract Architecture DATA_FOUND on every network.

| Network | Restrictions | Architecture |
|---|---|---|
| Arc | 4/8 | 8/8 |
| Robinhood | 7/10 | 9/10 |
| Ethereum | 15/20 | 19/20 |
| Pons | 8/8 | 8/8 |

Not met, so the row is unchanged: swapping would add about 10 visible NOT VERIFIED rows. The change becomes a one-line
schema edit once restriction coverage catches up.

## Short reasons
`mechanics-gaps.explain` now returns a short `reason`, for example "Verified source unavailable." or "Admin execution path
not yet reviewed in the verified source.". The complete text, with verified ABI interface hints, is kept in
`explanation` and the evidence JSON.

## Risk Engine reuse
`search/server/lib/mechanics-risk-evidence.js` is inert unless `ARC_AUTONOMY_RISK_PUBLIC_ENABLED === 'true'`, which is OFF.
When enabled it:
- reads only the worker's Ed25519-signed snapshot and issues no RPC;
- uses only a `risk.sell-transfer-tax` record that is VERIFIED_ONCHAIN (two operators, same block) and less than 24 h old;
- attaches it as corroboration, or fails closed (NOT_VERIFIED) on disagreement with reviewed evidence;
- otherwise shows a simulated sell deduction of at least 1% (buy and transfer stay NOT VERIFIED).

## Budgets (paired gate)
- `augReviewed` ≤ 8 per contract.
- `augRestriction` ≤ 2 per contract, and only where restrictions were unverified on main.
- `augBinding` ≤ 8 per contract, and only for a contract newly bound from a "delegation proven" architecture.
- All other request kinds must not grow.
