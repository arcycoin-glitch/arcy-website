# Contract & Mechanics implementation review — 20 October 2026

## Source and boundaries

Live Vercel was inspected read-only: READY commit
`d0249734f21d92d43249f4aab0b7fce792eae8eb`, branch
`fix/hero-motion-mobile-section-transitions-20261019`.
The current main branch is a different, restored snapshot; it was not used to
replace the live site. Development is isolated in
`data/mechanics-intelligence-20261020`, based on that actual deployed source.
Prior V4 branches/worktrees remain intact.

Draft PR #43 (`194b5aeb495d40a367d835e9365ade632c62ece3`) was reviewed and
its five commits selectively applied without merging. They modify only the
legacy app's Mechanics visibility, ui-model predicate and its tests. That
legacy Arc-only app is not the active three-network detail-page renderer, so
PR #43 alone does not satisfy the current user story. Its behavior is reused,
and the active Search renderer receives a separate strict evidence predicate.

No Hero, mascot, animation, stylesheet, site layout, Pulse, Burn, Unlocks,
Swap, holder pipeline, market, liquidity, supply or provider configuration is
changed. No dependencies or providers are added. No production deployment,
promotion, credential read/change or provider enablement is performed.

## Delivered changes

### Evidence-based visibility in both entry points

- Legacy app uses PR #43's threshold: two complete verified summary rows or
  one fully verified buy/sell/transfer tax row. It starts hidden while loading
  and explains the absence in the existing status area.
- Active multichain Search uses `search/mechanics-policy.js`: evidence must
  bind the selected chain/network/full contract and pinned block. Historical
  evidence requires an explicit original observation date and keeps its
  historical label. A single non-proxy result, partial transfer-only taxes,
  missing provenance or a generic external report cannot reveal the card.
- Complete reviewed Arc hook evidence retains its special, independently
  reviewed runtime-template provenance; a source-reported label alone is
  insufficient. Normalized legacy facts retain their original evidence status.
- The four primary rows and evidence controls remain when the card is shown.
  Unknown/partial rows are not removed from an otherwise supported card.
  Partial token-transfer evidence does not become a complete trading-tax row.
- The active card status now distinguishes partial verified evidence from
  complete verified contract evidence and last verified evidence. The other
  four cards keep their existing renderer and progressive-loading rules.

### Exact proxy execution rather than arbitrary storage

Previously a delegating runtime plus a deployed address in a standard or legacy
slot could create a proxy/admin result even when the outer execution path was
not source-bound. Such storage can be unrelated or misleading. These cases
now remain explicitly unbound candidates in technical evidence. Publishing
architecture/authority requires the existing exact EIP-1167 runtime, reviewed
outer slot-proxy source or reviewed immutable-beacon/runtime/source binding.
Implementation code and all state reads remain pinned to the same block.

Unknown UUPS/Transparent/beacon/Diamond/custom forwarding semantics are not
invented. A proxiableUUID observation is not itself upgrade authorization.
Current non-proxy runtime proof remains conservative and does not prove the
absence of external authority. Source validators, reviewed profiles and
stronger-source precedence remain unchanged.

### Real cirBTC delivery bug fixed

The live-source test initially found cirBTC's reviewed legacy architecture
discarded by multichain identity validation. The first proof's `address` was
the **value read from a storage slot** (including the zero address), not the
token subject. The normalizer consequently returned SOURCE_CONTRACT_MISMATCH.

The Arc Mechanics API now provides a separate, validated token-subject binding
for established summary facts at the analysis block. Original slot values,
implementation addresses, authority addresses, source proof and scope remain
unchanged as subsequent evidence. The mapping fix does not change any storage
value or relax the multichain validator. Foreign-chain contexts cannot create
this Arc subject record. cirBTC returned usable architecture after the fix.

### Residual role authority after zero ownership

The existing bytecode-matched FiatToken implementation's masterMinter, pauser
and blacklister getters already have reviewed permission semantics and pinned
reads. The summary now retains those validated authorities even when owner()
is zero. An unrelated ABI exposing the same role names cannot enable this
rule. The zero-owner/residual-role case is covered by a negative/positive
fixture test; no untested live renouncement case is claimed. No new RPC is
introduced because these role reads already exist.

### Secondary-source and chain safety

- GoPlus negative capability reports no longer become independently verified
  absence. Secondary positives/taxes retain SOURCE_REPORTED attribution and
  cannot by themselves satisfy the complete verified-row threshold.
- Existing permission gates remain closed unless configured by the operator.
  No source's 0% output overrides stronger reviewed source/state evidence.
- `/api/mechanics` is explicitly Arc-only. Foreign or ambiguous chain/network
  query parameters are rejected before provider/RPC calls. Ethereum and
  Robinhood use their existing selected-chain Search adapters instead.
- New deep-analysis facts include chain, subject, block, method, status and
  successful read time; source retrieval time and source digests remain in the
  original source proof. Legacy subject binding does not manufacture a new
  observation timestamp for cached evidence.

## Capability scope and limits

The existing reviewed source families continue to provide scoped token taxes,
role/capped/native-deposit issuance, owner/admin observations, launch restrictions,
proxy/implementation and beacon analysis. Existing reviewed tax mutability,
processor/recipient, pause/blacklist and hook details remain available in
technical evidence. No new unreviewed family is claimed merely from selectors,
ABI function names, ticker, zero owner or a missing standard slot.

Dynamic hook fee, anti-sniping and launch restrictions remain separate from
ERC20 transfer deductions and LP/protocol fees. Mint capability is not proof
that a mint transaction can execute now; source-defined roles are not a full
active-member census. A getter is an observed address, not complete privilege
enumeration. Renouncement is not established by a zero owner while other roles
or upgrade paths may remain.

Unsupported/unverified custom proxy routing, unverified implementations,
unresolved Diamond selector routing, absent source code and unknown hook/pool
associations remain unknown. No trading simulation provider was activated.

## Performance and provenance

The other four cards' existing parallel/progressive path is untouched.
Inspections retain their 14-second read budget, four-concurrent read ceiling,
per-read deadlines and source-cache coalescing. Unknown proxy candidates no
longer trigger the formerly automatic UUID/admin follow-up publication probes.
There is no new history scan, event enumeration, database or background job.
Live timings below are complete report/stream times, not standalone Mechanics
latency or a production SLA; this task makes no unmeasured speed claim.

## Tests and release gate

- Focused Mechanics tests: **48/48 PASS**, including dynamic/hook fees,
  exact-source/runtime matching, mint and role constraints, absence, proxy
  binding, wrong chain/contract/block, secondary sources and subject mapping.
- Mechanics browser fixtures: **48 PASS scenarios**, three chains, 1440px and
  390×844, hidden → sufficient → source loss → historical → recovered,
  four rows, evidence controls and no overflow.
- Existing Search browser E2E: PASS (320/390/768/1440). Existing homepage/detail
  browser regression: PASS. Progressive streaming isolation/navigation safety:
  PASS, 8 scenarios/10 scans. These suites are mocked and are not counted as
  live-source coverage.
- Separate real-source/API/browser acceptance: nine contracts, desktop/mobile;
  no API fixtures, credentials or new provider authorization. The final browser
  consumed the real streaming response; the initial DevTools response-body
  capture problem was a diagnostic-helper issue, not scored as a source failure.
- The production-baseline full suite is **466 PASS / 13 FAIL (479 tests)**.
  The first complete candidate full suite was **474 PASS / the same 13 FAIL
  (487 tests)**, with no new failing test names. Final totals are recorded below.

The 13 pre-existing failures concern Pulse source/edition fixtures, a Hero
visual assertion, an outdated cross-version website byte-identity assertion
and the prior burn-percentage formatting expectation. They reproduce on the
untouched deployed source. Those unrelated files/tests have not been changed
to force a green build. **Overall release acceptance remains blocked, not
PASS; no production deployment is authorized by this report.**

No new configuration is required for the implementation. An optional explorer
key or security-provider license remains optional and unmodified; unavailable
sources stay unknown. Review existing production/test baseline inconsistencies
separately before merging or deploying.

## Real-source results

Nine normal local browser searches, 1440px and 390×844, real selected-chain API/RPC/source responses. Optional restricted providers were not enabled. A UI PASS means correct evidence-driven visibility/layout, not that every tax or capability became verified.

| Token / chain | Full contract | Trading taxes (scope retained) | Mint | Owner/Admin | Architecture | Complete rows / displayed? | Full-stream time |
|---|---|---|---|---|---|---|---|
| USDT/ethereum | `0xdac17f958d2ee523a2206206994597c13d831ec7` | Transfer 0% · DEX/hook fees NOT VERIFIED | Owner-authorized issuance | owner() getter: 0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828 | NON-PROXY · runtime verified | 2/4 / shown | 10.08s |
| ONDO/ethereum | `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | Transfer 0% · DEX/hook fees NOT VERIFIED | Role-gated mint | AccessControl role authority | NON-PROXY · runtime verified | 3/4 / shown | 3.15s |
| TSLA/robinhood | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy | 3/4 / shown | 4.77s |
| LINK/robinhood | `0x492641f648a4986844848e0befe66d14817bce34` | NOT VERIFIED | NOT VERIFIED | owner() getter: 0xf09afe78d3c7d359b334d7cb88995751f7ec5e13 | NON-PROXY · runtime verified | 2/4 / shown | 2.07s |
| ARCY/arc | `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | Buy 3% · Sell 3% · Transfer 0% | false | owner() getter: 0x9c07a97364e59afe744fdbe55951df929bd5d90e | EIP-1167 minimal proxy | 4/4 / shown | 7.83s |
| ARGUS/arc | `0xece5ca8bf9220718e5727754026757512212cb3c` | Buy 1% · Sell 1% · Transfer 0% | false | owner() getter: 0x7d613c6316ede9d257f3bf512777cb4ea4a6bee4 | EIP-1167 minimal proxy | 3/4 / shown | 4.60s |
| USDT-Arc/arc | `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NON-PROXY · runtime verified | 1/4 / hidden | 3.18s |
| TOLLY/arc | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | Buy 0% · Sell 0% · Transfer 0% | false | false | NON-PROXY · runtime verified | 3/4 / shown | 2.72s |
| cirBTC/arc | `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` | Buy 0% · Sell 0% · Transfer 0% | true | owner() getter: 0xbc22a4c5f2c1cdb50e2f55dbf9b5f73417d2e6cf | Observed proxy/implementation: 0xc6061272419bb754a6c0386d1df81ddb3fe5cf3c | 3/4 / shown | 2.73s |

Complete-row counts apply the stricter presentation predicate. They are not raw DATA_FOUND counts. For example Transfer 0% with unknown hook fees does not certify a complete buy/sell/transfer row. The legacy combined strings remain scoped to their original token/known-pool methodology in View Evidence; no new universal trading-fee claim is made.

### Missing or partial evidence in the tested set

- USDT/ethereum `0xdac17f958d2ee523a2206206994597c13d831ec7` tradingTaxes: fee=min(amount*bps/10000, maximumFee). Owner can set bps<20 and maxFee<50 tokens. Rounding/cap changes effective rate. No sender exemption in reviewed transfer path; blacklist/pause can revert. DEX/hook fees separate.
- USDT/ethereum `0xdac17f958d2ee523a2206206994597c13d831ec7` ownerAdmin: Getter-reported only. Does not prove the complete contract admin role model.
- ONDO/ethereum `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` tradingTaxes: Full-value transfer/transferFrom, subject to transfer-role and investor vesting restrictions; restrictions can revert and are not deductions.
- TSLA/robinhood `0x322f0929c4625ed5bad873c95208d54e1c003b2d` tradingTaxes: Base-unit transfers have no deduction; pause/block restrictions may revert. UI multiplier/rebase display is not a tax; DEX/hook fees unknown.
- LINK/robinhood `0x492641f648a4986844848e0befe66d14817bce34` tradingTaxes: No contract-matched trading-tax report.
- LINK/robinhood `0x492641f648a4986844848e0befe66d14817bce34` mintCapability: Mint permission is unverified; absent getter does not prove no minting.
- ARGUS/arc `0xece5ca8bf9220718e5727754026757512212cb3c` tradingTaxes: Token-level/source-reported trade taxes; pool and hook fees may be additional.
- USDT-Arc/arc `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` tradingTaxes: Taxes need source-reviewed contract getter or exact-chain security evidence.
- USDT-Arc/arc `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` mintCapability: A generic getter cannot establish mint privileges.
- USDT-Arc/arc `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` ownerAdmin: No reliable owner or admin getter established.
- TOLLY/arc `0xbc43ce8dec648ea298c4275559b81d6261c90b67` tradingTaxes: Token-level/source-reported trade taxes; pool and hook fees may be additional.
- cirBTC/arc `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` tradingTaxes: Token-level/source-reported trade taxes; pool and hook fees may be additional.

### Final regression accounting

Final full run: **489 tests — 476 PASS, 13 FAIL, 0 skipped**. The failed-test names match the untouched production-baseline run exactly; **0 new failing names**. Focused Mechanics: **48/48 PASS**. Candidate full-suite acceptance is therefore **FAIL/BLOCKED**, not production-ready.

The existing failing test names (identical on production baseline) are:

- normal Pulse never publishes; stale saved headlines remain archival while authenticated cron is the only publisher
- three distinct Pulse source panels plus ARCY Take never present archived headlines as current
- stale signed Pulse is not relabeled as the current weekly headline
- provider failure yields three truthful Pulse slots and never 503 with empty cards
- playing owl video is visible without doubling the still image or square matte
- approved visual DOM/CSS and unrelated website sections remain identical to production
- burn share rejects invalid data and never emits scientific notation or misleading zero for tiny positives
- Pulse builds dated current-cycle cards and preserves all five editorial slots plus ARCY Take
- Pulse saves a quiet weekly edition when all verified source checks succeed without a meaningful current update
- Pulse keeps meaningful cards and fills only missing categories with verified quiet-week copy
- Pulse records partial source failure as unavailable coverage rather than a false quiet week
- Pulse rejects stale, future, unrelated and duplicate candidates while retaining current exact-source Arc developments
- Pulse caps verified news but keeps all five slot identities through weekly rollover

## Exact proposed application scope

- `api/mechanics.js`: Arc-only input guard and canonical subject-bound summary output.
- `lib/contract-summary.js`: secondary-vs-reviewed distinction and token subject provenance without rewriting authority/storage values.
- `search/server/lib/mechanics-deep.js`: execution-bound proxy publication and per-fact verification metadata.
- `search/mechanics-policy.js`: strict multichain complete-row visibility predicate.
- `search/index.html`: Mechanics-only threshold, discreet status and partial/historical labels; other card branches and styles unchanged.
- `app.js`, `ui-model.js`: reused PR #43 legacy visibility plus source-reported tax distinction.
- Associated Mechanics/browser tests and this audit. No other application file is part of this proposal.

**Review disposition:** Draft only. No production merge/deploy. No new contract-family coverage, provider license or mint/renouncement guarantee is claimed beyond the implemented, tested source evidence.
