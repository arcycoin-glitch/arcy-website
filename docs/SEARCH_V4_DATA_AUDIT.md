# ARCY SEARCH V4 — verified data audit

## Scope and release boundary

This is a draft, data-only review branch based on PR #27 commit
`73a5798c217575e952da9f7e6b0f486ef006bf4a`. It preserves that commit's four
always-visible Mechanics rows and imports PR #28's burn-address clarification
from `9dec736b7bd40e58d43424cc65b6d6b441638539` without merging either PR.
The production deployment observed at the start was
`dpl_51ippBoufb2D4FS83Z6uNTJF2ph6`, commit
`5dfacb1894fd390b7475105a11ff57254fc44067`.
No production promotion, environment change, worker deployment, restricted
provider activation, Redis provisioning or artwork regeneration is part of V4.

The five cards and twenty field identifiers remain unchanged. The only HTML
changes are the PR #28 burn-custody terminology and safe tiny-percentage
formatting, also applied to Quick Facts. There are no CSS, layout, animation,
Hero, Unlocks, Pulse, Burn-section, Swap or Research changes.

## Evidence and counting rules

- `DATA_FOUND` means a source-backed value is available, not necessarily a
  current independently verified fact. The tables below keep this distinction.
- Historical COMPLETE holder publications remain historical, with their
  original timestamp/block. A signed publication is not fresh merely because
  it was downloaded today.
- Ethereum explorer holder count is source-reported. RPC reconciliation of a
  source-ranked candidate set does not prove a globally exhaustive census or
  ranking. Such values must not be counted as COMPLETE global-holder proof.
- Market values are exact-contract provider reports; source retrieval time is
  not a provider publication timestamp. Missing circulating supply is not
  filled with totalSupply minus burn custody.
- A reviewed token-level full-value transfer establishes Transfer 0%, not Buy
  0% or Sell 0%. External DEX/hook fees remain NOT VERIFIED unless separately
  established. Existing stronger Arc hook evidence is retained.
- Mint and authority results describe the proven permission model and pinned
  getters. They do not assert all active members, successful mint execution,
  permanent fixed supply or renouncement when that cannot be established.

## Mechanics implementation and source review

Source acquisition uses the existing public Sourcify v2 endpoint:
`https://sourcify.dev/server/v2/contract/{chainId}/{address}?fields=abi,sources,compilation,runtimeBytecode`.
The existing validator still requires exact chain and contract, supported
runtime match, and equality between pinned RPC bytecode and the source
service's on-chain bytecode. The complete sorted source-content digest must
match a reviewed profile. A function selector or ABI name alone never enables
these profiles. No source text is redistributed in this branch.

The new full-source profiles in `mechanics-reviewed-v4.js` cover:

| Source family | Reviewed execution / authority evidence | Important limit |
|---|---|---|
| Native wrapper (WETH) | Full-value transferFrom; native-deposit issuance; no privileged authority in complete direct implementation | Forced native transfers can affect supply; not a fixed-supply token |
| Fixed ERC677 (LINK Ethereum) | Constructor-only allocation, constant supply, full-value transfer, no privileged token authority | Callback behavior and external market fees are separate; absence only for a direct nondelegating implementation |
| Owned issuance / pause (WBTC) | Inherited mint, nonzero pinned owner, mintingFinished false, full-value transfer | Pause can revert; no transaction simulation or unlimited executable issuance claim |
| Governed minter set (GRT) | onlyMinter issuance, onlyGovernor membership administration, pinned governor | No exhaustive active minter list |
| Role/timelock transfer (ONDO) | Role-enforced mint/authority and full-value transfers with vesting/restriction checks | Role membership and immediate executable issuance not assumed |
| Fixed launch restrictions (PONS) | Constructor-only mint, factory-controlled exemption, full-value permitted transfers | Pool fee is not token tax; expiry/wallet limits are separate restrictions |
| Compliance role implementations (USDY/OUSG/USDON) | Reviewed inherited ERC20/mint paths, matching pinned MINTER_ROLE | KYC/pause/allow/block checks can revert; upgrade authority remains |
| Upgradeable no-direct-mint implementation (AAVE) | Current reviewed implementation lacks public issuance, revision-gated empty initialize, pinned proxy admin | Explicitly upgradeable: not permanent fixed supply or renouncement |

Original PR #26 source profiles, source validation and stronger-evidence
precedence remain intact. Source review hashes are in the new module rather
than token-address-specific branches. Verified transparent/admin proxy outer
source binds the pinned implementation slot to its actual execution path.

For Robinhood's immutable beacon proxy, all 283 runtime bytes including
compiler metadata must match the reviewed template except the compiler's
single 32-byte immutable at byte 29. Invalid address padding, a changed
instruction, size or metadata fails closed. The beacon itself must have pinned
code and the reviewed source digest. Its implementation getter is called at
the same block with `from` equal to the token proxy. The implementation must
also have deployed pinned code and matching reviewed source before token
behavior is inherited. Source-less CRM/ON/APLD/AEHR outer contracts can thus be
identified generically without trusting an arbitrary storage word or ticker.

## Holder safety and delivery

The existing Railway durable worker, queue, checkpoints and publication schema
are unchanged. V4 changes only the Search publication reader and candidate
normalization:

1. A correctly signed exact-contract COMPLETE publication is no longer thrown
   away solely because it is older than 48 hours. Every returned field is
   explicitly LAST_VERIFIED at its original block/time.
2. Snapshot evidence and all four metric proofs must share the same block hash
   anchor. Validly signed mixed-anchor payloads are rejected.
3. A bounded process-local cache retains the latest 32 authenticated COMPLETE
   publications per exact feed/public-key/contract. A failed/429/timed-out or
   invalid refresh cannot erase the last verified result in that runtime.
   An older successful response also cannot roll it back.
4. A cold runtime still requires the durable publication feed to be reachable;
   this memory cache is not a new durable database and cannot recover a
   publication it has never loaded. Existing worker storage remains necessary.
5. Mixed-case duplicate candidate wallets are rejected before reconciliation,
   preventing double counting under case-sensitive Set identity.

Public holder sources were tested with exact Arc ARCY/LINK, Ethereum USDT/LINK,
and Robinhood TSLA/LINK/PONS contracts:

| Endpoint | Actual response | Limit / conclusion |
|---|---|---|
| Arc explorer `/api/v2/tokens/{contract}/holders` and compatible `getTokenHolders` | HTTP 403, approximately 246–490 ms | No unauthenticated holder coverage available from this environment; no bypass attempted |
| Robinhood explorer same routes | HTTP 403, approximately 229–265 ms | No public holder census acquired |
| Routescan `/v2/network/mainnet/evm/{5042,4663}/erc20/{contract}/holders?limit=25` | HTTP 400, Blockchain not found | Not an available fallback for these chains |
| Ethereum Blockscout REST / compatible holder routes | HTTP 200, 50 rows, approximately 209–2509 ms | Paginated source dataset; not proof of exhaustive global ranking |
| Routescan Ethereum holder route | HTTP 200, 25 rows, approximately 406–424 ms | Limited ranked page, not a full census |

No new paid/API-key provider or unlicensed endpoint is enabled. Railway
control-plane logs/restarts were not available in this local audit; do not
interpret read-only publication tests as a new production worker health check.

## Logos, provenance and rights

Existing exact-chain/full-contract identity, host/URL security, MIME/size
validation, one-second aggregate artwork deadline, fifteen-minute positive
cache and thirty-second negative cache remain. A valid warm cached image is
now reused even when earlier slow artwork consumed the aggregate deadline.
Unknown/expired images still require normal validation. This fixes a proved
order-dependent null-logo case without relaxing security or increasing the
timeout. Deterministic artwork tests isolate this bug from upstream outages.

No newly discovered artwork is installed merely to increase a count. ONDO's
official `ondoprotocol/ondo-global-markets-token-list` returned its list (200,
140 ms), README (200, 418 ms), and exact USDON identity, but no explicit license
was found (GitHub license endpoint 404). The existing CC0 collection's ONDO SVG
returned 404. The official issuer is `ondo.finance`, whose terms link to
`docs.ondo.finance/legal/terms-of-service`; it is unrelated to the retail site
ondo.com. The issuer media kit does not by itself establish unrestricted image
redistribution permission. V4 therefore leaves the existing initials fallback
when no approved exact-token artwork is available. No logo gain is claimed
without an actual decoded browser image and acceptable provenance.

## Validation methodology

`test/search-v4-live.cjs` runs the real local API against public sources, with
conservative optional-provider permissions. No Search-response mocking or
worker/queue writes are used. The unchanged PR #27 checkout and V4 checkout
are measured separately. Each of 29 exact contracts is searched in the browser,
all five cards/twenty fields and four directly visible Mechanics rows checked,
then resized to 1440, 768, 390×844 and 320 pixels. Actual title/discovery images
are decoded and natural dimensions recorded. Home autocomplete and detail
re-search are checked separately; absence from a bounded suggestion result is
not reclassified as successful discovery. Full reports, response times and
screenshots are kept outside the repository, not committed as generated files.

Unit/regression tests additionally cover wrong/unknown source, immutable
runtime mutations, unreviewed beacon source, role getter mismatch, zero-owner
ambiguity, proxy residual upgrade authority, capped/conditional capability,
same-block mixed anchors, signed stale snapshot retention, feed/key/contract
cache isolation, refresh failures, duplicate wallet casing, tiny numeric
formatting and the exhausted-artwork-budget regression.

## Measured results

The following measured tables are filled from completed real-source runs; no
target coverage is substituted for observed results.

### Summary and attribution

The complete browser comparison observed **68/116 → 107/116 source-backed
Mechanics slots**: Taxes 11→25, Mint 11→25, Owner/Admin 18→28, Architecture
28→29. These are usable, scope-qualified results, not 25 fully proven buy/sell
tax schedules. The earlier independent 29-contract API baseline contained
**70/116** (Taxes 11, Mint 11, Owner 19, Architecture 29). USDY's later baseline
browser request temporarily lost owner/architecture proof, whereas its earlier
baseline API request had both. Consequently **37 additional Mechanics slots**
are attributable to the V4 reviewed profiles/binding, and **two** of the
browser comparison's 39 additional slots are recovery of source/RPC
availability, not new detection logic. No unchanged card's provider variation
is credited as a V4 improvement.

No new global COMPLETE holder census is claimed. Existing historical values
remain available; Ethereum source-ranked candidates are still not a proof of
global enumeration. Arc tokens without a local historical fallback require
the existing configured signed publication feed; that production configuration
was not copied into this local checkout. Robinhood's public holder 403 remains
an external limitation. The V4 holder gain is safety/freshness/delivery under
refresh failure, demonstrated with signed-document and reconciliation tests,
not fabricated numerical coverage.

The full browser sweep decoded 22 title logos before and 20 after. The two
temporary differences were AAPL and PONS; separate exact-contract V4 API/browser
rechecks returned the same correct URLs and decoded both successfully (AAPL
validation 373 ms, 180×180 PNG; PONS 137 ms, 800×800 WebP). Thus **22/29** were
demonstrably loadable after focused rechecks, but the initial 20/29 observation
is retained below rather than overwritten. The original null responses did not
record which internal image-validation substep timed out/rejected, so the exact
transient substep is not asserted. The unchanged short validation budget can
still produce safe initials on cold/transient failures; there is no proven
persistent contract-to-artwork mapping regression and **zero newly mapped
logos**. The warm-cache ordering bug has a deterministic regression test; this
does not make all upstream images permanently available.

Boolean false in the raw Mechanics outcome table represents the existing
evidence-backed absence result, not a missing value. The actual UI keeps its
approved absence formatting and four visible rows.

### Twenty-field availability by chain

Each cell is source-backed slots before → after / tested contracts. This is availability, NOT a blanket on-chain-verification score. Holder candidate rankings and historical snapshots are classified separately below. Browser observations are at different times; providers and blocks can change.

| Card / field | Arc (8) | Ethereum (13) | Robinhood (8) |
|---|---|---|---|
| supply / totalSupply | 8 → 8 / 8 | 13 → 13 / 13 | 8 → 8 / 8 |
| supply / circulatingSupply | 0 → 0 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| supply / burnAddressBalance | 8 → 8 / 8 | 13 → 13 / 13 | 8 → 8 / 8 |
| supply / burnAddressPct | 8 → 8 / 8 | 13 → 13 / 13 | 8 → 8 / 8 |
| holders / holderCount | 5 → 5 / 8 | 13 → 13 / 13 | 0 → 0 / 8 |
| holders / largestWalletPct | 5 → 5 / 8 | 13 → 13 / 13 | 0 → 0 / 8 |
| holders / top10Pct | 5 → 5 / 8 | 13 → 13 / 13 | 0 → 0 / 8 |
| holders / top20Pct | 5 → 5 / 8 | 13 → 13 / 13 | 0 → 0 / 8 |
| liquidity / liquidityUsd | 8 → 8 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| liquidity / volume24h | 7 → 8 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| liquidity / dexPairCount | 7 → 8 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| liquidity / lpStatus | 0 → 0 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| activity / priceUsd | 6 → 6 / 8 | 6 → 6 / 13 | 0 → 0 / 8 |
| activity / valuation | 6 → 6 / 8 | 6 → 6 / 13 | 0 → 0 / 8 |
| activity / change24h | 5 → 5 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| activity / volume24h | 8 → 8 / 8 | 0 → 0 / 13 | 0 → 0 / 8 |
| mechanics / tradingTaxes | 5 → 5 / 8 | 4 → 13 / 13 | 2 → 7 / 8 |
| mechanics / mintCapability | 5 → 5 / 8 | 4 → 13 / 13 | 2 → 7 / 8 |
| mechanics / ownerAdmin | 7 → 7 / 8 | 8 → 13 / 13 | 3 → 8 / 8 |
| mechanics / contractArchitecture | 8 → 8 / 8 | 12 → 13 / 13 | 8 → 8 / 8 |

### Exact-contract outcomes

S/H/L/A/M = number of source-backed slots in Supply / Holders / Liquidity / Activity / Mechanics. Each card has four slots. Historical or provider-reported values count as available, not as fresh global truth.

| Chain / token | Exact contract | Before S/H/L/A/M | After S/H/L/A/M | Report time before → after | Title artwork before → after |
|---|---|---|---|---|---|
| arc/ARCY | `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | 3/4/3/4/4 | 3/4/3/4/4 | 17.95 s → 18.09 s | decoded → decoded |
| arc/ARGUS | `0xece5ca8bf9220718e5727754026757512212cb3c` | 3/4/3/4/4 | 3/4/3/4/4 | 8.19 s → 8.91 s | decoded → decoded |
| arc/USDT-Arc | `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` | 3/4/3/1/1 | 3/4/3/1/1 | 17.55 s → 17.63 s | initials → initials |
| arc/UBI | `0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56` | 3/4/1/1/4 | 3/4/3/1/4 | 9.89 s → 10.21 s | initials → initials |
| ethereum/USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` | 3/4/0/0/4 | 3/4/0/0/4 | 4.44 s → 4.15 s | decoded → decoded |
| ethereum/UNI | `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | 3/4/0/2/4 | 3/4/0/2/4 | 3.78 s → 2.86 s | decoded → decoded |
| ethereum/DAI | `0x6b175474e89094c44da98b954eedeac495271d0f` | 3/4/0/2/4 | 3/4/0/2/4 | 3.19 s → 3.53 s | decoded → decoded |
| ethereum/USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | 3/4/0/2/4 | 3/4/0/2/4 | 3.59 s → 3.29 s | decoded → decoded |
| arc/TOLLY | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | 3/0/3/4/4 | 3/0/3/4/4 | 17.93 s → 17.94 s | decoded → decoded |
| arc/cirBTC | `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` | 3/4/3/4/4 | 3/4/3/4/4 | 9.34 s → 8.71 s | initials → initials |
| ethereum/WETH | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | 3/4/0/2/1 | 3/4/0/2/4 | 3.75 s → 4.98 s | decoded → decoded |
| ethereum/LINK | `0x514910771af9ca656af840dff83e8264ecf986ca` | 3/4/0/2/1 | 3/4/0/2/4 | 3.23 s → 2.43 s | decoded → decoded |
| ethereum/AAVE | `0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9` | 3/4/0/2/2 | 3/4/0/2/4 | 3.10 s → 3.14 s | decoded → decoded |
| ethereum/WBTC | `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` | 3/4/0/0/2 | 3/4/0/0/4 | 3.53 s → 4.06 s | decoded → decoded |
| ethereum/GRT | `0xc944e90c64b2c07662a292be6244bdf05cda44a7` | 3/4/0/0/1 | 3/4/0/0/4 | 3.33 s → 2.71 s | decoded → decoded |
| ethereum/ONDO | `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | 3/4/0/0/1 | 3/4/0/0/4 | 5.48 s → 4.02 s | initials → initials |
| ethereum/USDY | `0x96f6ef951840721adbf46ac996b59e0235cb985c` | 3/4/0/0/0 | 3/4/0/0/4 | 7.89 s → 6.29 s | initials → initials |
| ethereum/OUSG | `0x1b19c19393e2d034d8ff31ff34c81252fcbbee92` | 3/4/0/0/2 | 3/4/0/0/4 | 3.63 s → 7.27 s | initials → initials |
| robinhood/APLD | `0xb8dbf92f9741c9ac1c32115e78581f23509916fd` | 3/0/0/0/1 | 3/0/0/0/4 | 4.17 s → 5.58 s | decoded → decoded |
| robinhood/AEHR | `0x5f604fba1162193a4388a5dfa56f556f3e133cc2` | 3/0/0/0/1 | 3/0/0/0/4 | 3.54 s → 5.40 s | decoded → decoded |
| robinhood/LINK | `0x492641f648a4986844848e0befe66d14817bce34` | 3/0/0/0/2 | 3/0/0/0/2 | 2.19 s → 2.96 s | decoded → decoded |
| robinhood/PONS | `0x39dbed3a2bd333467115de45665cc57f813c4571` | 3/0/0/0/1 | 3/0/0/0/4 | 2.55 s → 6.80 s | decoded → initials |
| ethereum/USDON | `0xace8e719899f6e91831b18ae746c9a965c2119f1` | 3/4/0/0/2 | 3/4/0/0/4 | 6.61 s → 7.21 s | initials → initials |
| arc/USDC | `0x3600000000000000000000000000000000000000` | 3/0/3/3/2 | 3/0/3/3/2 | 17.57 s → 17.76 s | decoded → decoded |
| arc/LINK | `0x76a443768a5e3b8d1aed0105fc250877841deb40` | 3/0/3/4/2 | 3/0/3/4/2 | 4.82 s → 4.63 s | decoded → decoded |
| robinhood/AAPL | `0xaf3d76f1834a1d425780943c99ea8a608f8a93f9` | 3/0/0/0/4 | 3/0/0/0/4 | 4.62 s → 6.26 s | decoded → initials |
| robinhood/TSLA | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | 3/0/0/0/4 | 3/0/0/0/4 | 4.18 s → 4.86 s | decoded → decoded |
| robinhood/CRM | `0xd95b44124e475743a7589e68f3d74008a5536d44` | 3/0/0/0/1 | 3/0/0/0/4 | 5.26 s → 5.11 s | decoded → decoded |
| robinhood/ON | `0xbbd09f72b025360fee5c928053dca6248d35be54` | 3/0/0/0/1 | 3/0/0/0/4 | 4.70 s → 4.22 s | decoded → decoded |

### All four Mechanics results after V4

Transfer-only results below leave buy/sell/DEX/hook charges unverified; see the exact card evidence.

| Token / chain | Taxes | Mint | Owner/Admin | Architecture |
|---|---|---|---|---|
| ARCY/arc | Buy 3% · Sell 3% · Transfer 0% | false | owner() getter: 0x9c07a97364e59afe744fdbe55951df929bd5d90e | EIP-1167 minimal proxy |
| ARGUS/arc | Buy 1% · Sell 1% · Transfer 0% | false | owner() getter: 0x7d613c6316ede9d257f3bf512777cb4ea4a6bee4 | EIP-1167 minimal proxy |
| USDT-Arc/arc | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NON-PROXY · runtime verified |
| UBI/arc | Buy 0% · Sell 0.01% · Transfer 0% | false | owner() getter: 0xfb0885bc62eb7147fa4d29f710864b83de35c5d1 | EIP-1167 minimal proxy |
| USDT/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Owner-authorized issuance | owner() getter: 0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828 | NON-PROXY · runtime verified |
| UNI/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Capped / time-gated minter | Minter authority: 0x1a9c8182c09f50c8318d769245bea52c32be35bc | NON-PROXY · runtime verified |
| DAI/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Ward-authorized mint | wards authorization | NON-PROXY · runtime verified |
| USDC/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Allowance-limited mint | owner() getter: 0xfcb19e6a322b27c06842a71e8c725399f049ae3a | Legacy implementation slot |
| TOLLY/arc | Buy 0% · Sell 0% · Transfer 0% | false | false | NON-PROXY · runtime verified |
| cirBTC/arc | Buy 0% · Sell 0% · Transfer 0% | true | owner() getter: 0xbc22a4c5f2c1cdb50e2f55dbf9b5f73417d2e6cf | Legacy implementation slot |
| WETH/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Native-deposit issuance | NONE DETECTED ✓ | NON-PROXY · runtime verified |
| LINK/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | NONE DETECTED ✓ | NONE DETECTED ✓ | NON-PROXY · runtime verified |
| AAVE/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | No direct mint · upgradeable | Proxy admin: 0x86c3ffee349a7cff7ca88c449717b1b133bfb517 | EIP-1967 implementation |
| WBTC/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Owner-authorized mint | owner() getter: 0xca06411bd7a7296d7dbdd0050dfc846e95febeb7 | NON-PROXY · runtime verified |
| GRT/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Governor-managed minter set | Governor: 0x48301fe520f72994d32ead72e2b6a8447873cf50 | NON-PROXY · runtime verified |
| ONDO/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Role-gated mint | AccessControl role authority | NON-PROXY · runtime verified |
| USDY/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Role-gated mint | Proxy admin: 0x3ed61633057da0bc58f84b2b9002845e56f94c19 | EIP-1967 implementation |
| OUSG/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Role-gated mint | Proxy admin: 0xba80aa44cc25e85cc30359150dfb1c7d041cf6d5 | EIP-1967 implementation |
| APLD/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| AEHR/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| LINK/robinhood | NOT VERIFIED | NOT VERIFIED | owner() getter: 0xf09afe78d3c7d359b334d7cb88995751f7ec5e13 | NON-PROXY · runtime verified |
| PONS/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | NONE DETECTED ✓ | Launch factory controls | NON-PROXY · runtime verified |
| USDON/ethereum | Transfer 0% · DEX/hook fees NOT VERIFIED | Role-gated mint | Proxy admin: 0x5244a3d8e6534d253c11b9459a4c4c6d3b2361dd | EIP-1967 implementation |
| USDC/arc | NOT VERIFIED | NOT VERIFIED | owner() getter: 0xf5a5658b55983e2aa037cac7a8431b510e8a97f4 | Legacy implementation slot |
| LINK/arc | NOT VERIFIED | NOT VERIFIED | owner() getter: 0x3ec62564f66874f619640cbb7fd42a157f21a442 | NON-PROXY · runtime verified |
| AAPL/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| TSLA/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| CRM/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| ON/robinhood | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |

### Holder results and proof classification

| Token / chain | Count | Largest % | Top10 % | Top20 % | Status / scope | Snapshot / evidence block |
|---|---|---|---|---|---|---|
| ARCY/arc | 41 | 80.8809084 | 90.96948882 | 95.70251104 | HISTORICAL_ONCHAIN_VERIFIED | 0x16c2ef9 |
| ARGUS/arc | 20546 | 4.78202163 | 22.49685603 | 35.80930322 | HISTORICAL_ONCHAIN_VERIFIED | 0x173d210 |
| USDT-Arc/arc | 6 | 99.99999998 | 99.99999999 | 99.99999999 | HISTORICAL_ONCHAIN_VERIFIED | 0x16d5a03 |
| UBI/arc | 3 | 99.99989643 | 99.99999999 | 99.99999999 | HISTORICAL_ONCHAIN_VERIFIED | 0x173e6d5 |
| USDT/ethereum | 16873349 | 18.1195 | 48.0526 | 53.7182 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002c4 |
| UNI/ethereum | 408812 | 26.2248 | 51.9714 | 59.7334 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002c4 |
| DAI/ethereum | 765833 | 17.6598 | 37.4421 | 41.9827 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002c6 |
| USDC/ethereum | 9506564 | 8.7245 | 26.6182 | 34.8358 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002c6 |
| TOLLY/arc | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| cirBTC/arc | 5696 | 71.02472541 | 99.82604177 | 99.94916274 | HISTORICAL_ONCHAIN_VERIFIED | 0x16d5f9b |
| WETH/ethereum | 3357005 | 17.841 | 60.2355 | 67.6027 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002c9 |
| LINK/ethereum | 1009007 | 4.2194 | 31.4468 | 42.4886 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002ca |
| AAVE/ethereum | 199493 | 15.4624 | 44.0699 | 54.9887 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002ca |
| WBTC/ethereum | 202974 | 28.6959 | 53.8667 | 58.9452 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002cb |
| GRT/ethereum | 179318 | 22.1532 | 51.8592 | 61.8179 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002cb |
| ONDO/ethereum | 216765 | 51.7921 | 67.8151 | 73.7398 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002cc |
| USDY/ethereum | 1314 | 32.841 | 95.5449 | 97.5875 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002cd |
| OUSG/ethereum | 51 | 29.1662 | 95.2732 | 99.6209 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002cd |
| APLD/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| AEHR/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| LINK/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| PONS/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| USDON/ethereum | 5078 | 84.3574 | 99.883 | 99.9187 | SOURCE_REPORTED; SOURCE_REPORTED_RPC_RECONCILED | 0x19002d2 |
| USDC/arc | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| LINK/arc | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| AAPL/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| TSLA/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| CRM/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |
| ON/robinhood | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT_VERIFIED | not supplied |

### Every missing field: observed reason

| Token / chain | Missing field | Observed reason / state |
|---|---|---|
| ARCY/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| ARCY/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| ARGUS/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| ARGUS/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDT-Arc/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| USDT-Arc/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDT-Arc/arc | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT-Arc/arc | activity.valuation | FDV withheld: an exact-contract positive USD price is unavailable. |
| USDT-Arc/arc | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT-Arc/arc | mechanics.tradingTaxes | Taxes need source-reviewed contract getter or exact-chain security evidence. |
| USDT-Arc/arc | mechanics.mintCapability | A generic getter cannot establish mint privileges. |
| USDT-Arc/arc | mechanics.ownerAdmin | No reliable owner or admin getter established. |
| UBI/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| UBI/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| UBI/arc | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UBI/arc | activity.valuation | FDV withheld: an exact-contract positive USD price is unavailable. |
| UBI/arc | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| USDT/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDT/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDT/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UNI/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| UNI/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UNI/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UNI/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UNI/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| UNI/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| UNI/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| DAI/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| DAI/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| DAI/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| DAI/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| DAI/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| DAI/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| DAI/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| USDC/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDC/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TOLLY/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| TOLLY/arc | holders.holderCount | A secure signed holder publication feed is not configured. |
| TOLLY/arc | holders.largestWalletPct | A secure signed holder publication feed is not configured. |
| TOLLY/arc | holders.top10Pct | A secure signed holder publication feed is not configured. |
| TOLLY/arc | holders.top20Pct | A secure signed holder publication feed is not configured. |
| TOLLY/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| cirBTC/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| cirBTC/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| WETH/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| WETH/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WETH/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WETH/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WETH/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| WETH/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WETH/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| LINK/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| LINK/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAVE/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| AAVE/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAVE/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAVE/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAVE/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| AAVE/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAVE/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| WBTC/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| WBTC/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| WBTC/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| GRT/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| GRT/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| GRT/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| ONDO/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| ONDO/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ONDO/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| USDY/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDY/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDY/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| OUSG/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| OUSG/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| OUSG/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| APLD/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| APLD/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| APLD/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| APLD/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| APLD/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| APLD/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| APLD/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| AEHR/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| AEHR/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AEHR/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AEHR/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AEHR/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| AEHR/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AEHR/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| LINK/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| LINK/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| LINK/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| LINK/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| LINK/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| LINK/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| LINK/robinhood | mechanics.tradingTaxes | No contract-matched trading-tax report. |
| LINK/robinhood | mechanics.mintCapability | Mint permission is unverified; absent getter does not prove no minting. |
| PONS/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| PONS/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| PONS/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| PONS/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| PONS/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| PONS/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| PONS/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| PONS/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| USDON/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDON/ethereum | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDON/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| USDC/arc | holders.holderCount | A secure signed holder publication feed is not configured. |
| USDC/arc | holders.largestWalletPct | A secure signed holder publication feed is not configured. |
| USDC/arc | holders.top10Pct | A secure signed holder publication feed is not configured. |
| USDC/arc | holders.top20Pct | A secure signed holder publication feed is not configured. |
| USDC/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDC/arc | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/arc | mechanics.tradingTaxes | Taxes need source-reviewed contract getter or exact-chain security evidence. |
| USDC/arc | mechanics.mintCapability | A generic getter cannot establish mint privileges. |
| LINK/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| LINK/arc | holders.holderCount | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.largestWalletPct | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.top10Pct | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.top20Pct | A secure signed holder publication feed is not configured. |
| LINK/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| LINK/arc | mechanics.tradingTaxes | Taxes need source-reviewed contract getter or exact-chain security evidence. |
| LINK/arc | mechanics.mintCapability | A generic getter cannot establish mint privileges. |
| AAPL/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| AAPL/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| AAPL/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AAPL/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AAPL/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| AAPL/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| AAPL/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| AAPL/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| TSLA/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| TSLA/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| TSLA/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| TSLA/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| TSLA/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| TSLA/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| TSLA/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| CRM/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| CRM/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| CRM/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| CRM/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| CRM/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| CRM/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| CRM/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | supply.circulatingSupply | No source-confirmed, contract-matched circulating supply for Robinhood Chain. |
| ON/robinhood | holders.holderCount | No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable. |
| ON/robinhood | holders.largestWalletPct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| ON/robinhood | holders.top10Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| ON/robinhood | holders.top20Pct | Blockscout holder ranking could not be reconciled at the pinned Robinhood block. |
| ON/robinhood | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| ON/robinhood | activity.priceUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | activity.valuation | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| ON/robinhood | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |

### Timings, artwork and browser checks

- arc: before {"mean":"12.91 s","median":"17.55 s","min":"4.82 s","max":"17.95 s"}; after {"mean":"12.99 s","median":"17.63 s","min":"4.63 s","max":"18.09 s"}.
- ethereum: before {"mean":"4.27 s","median":"3.63 s","min":"3.10 s","max":"7.89 s"}; after {"mean":"4.30 s","median":"4.02 s","min":"2.43 s","max":"7.27 s"}.
- robinhood: before {"mean":"3.90 s","median":"4.18 s","min":"2.19 s","max":"5.26 s"}; after {"mean":"5.15 s","median":"5.40 s","min":"2.96 s","max":"6.80 s"}.

Actual title images decoded: **22/29 → 20/29**. Newly decoded tokens in this run: none. No new artwork asset/registry entry was added; any observed live availability change is not attributed to a new logo mapping.

| Surface | Before exact target present / decoded | After exact target present / decoded |
|---|---|---|
| homeDiscovery | 22 / 19 | 22 / 18 |
| detailDiscovery | 22 / 19 | 22 / 18 |

Both complete runs: 29/29 actual API reports, 116/116 responsive states each, five cards/twenty metric slots, four visible Mechanics rows, five evidence panels and no captured uncaught page errors. Widths: 320, 390×844, 768, 1440. Images were decoded rather than accepted solely from a URL. Some exact tokens are absent from bounded symbol-discovery results; this is recorded above, not silently counted as a successful suggestion.

Times are end-to-end local navigation → full report responses, not per-card paint or production SLAs. Public source timing, process warmth and API rate-limit waits are confounders. V4 is not presented as a general speed optimization. The initial automated sweep exceeded the unchanged 24/minute local limit; failed slots were subsequently retried after Retry-After with bounded pacing. Successful slots were preserved. No rate limit was disabled.

### Source reachability

| Chain / contract | Source | HTTP / latency | Runtime match |
|---|---|---|---|
| arc/ARCY | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b?fields=abi,sources,compilation,runtimeBytecode) | 404 / 348 ms | no verified source |
| arc/ARGUS | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0xece5ca8bf9220718e5727754026757512212cb3c?fields=abi,sources,compilation,runtimeBytecode) | 404 / 277 ms | no verified source |
| arc/UBI | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56?fields=abi,sources,compilation,runtimeBytecode) | 404 / 106 ms | no verified source |
| ethereum/USDT | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xdac17f958d2ee523a2206206994597c13d831ec7?fields=abi,sources,compilation,runtimeBytecode) | 200 / 125 ms | match |
| arc/USDT-Arc | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a?fields=abi,sources,compilation,runtimeBytecode) | 404 / 262 ms | no verified source |
| ethereum/UNI | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984?fields=abi,sources,compilation,runtimeBytecode) | 200 / 147 ms | match |
| ethereum/DAI | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x6b175474e89094c44da98b954eedeac495271d0f?fields=abi,sources,compilation,runtimeBytecode) | 200 / 138 ms | exact_match |
| ethereum/USDC | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48?fields=abi,sources,compilation,runtimeBytecode) | 200 / 106 ms | match |
| arc/TOLLY | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0xbc43ce8dec648ea298c4275559b81d6261c90b67?fields=abi,sources,compilation,runtimeBytecode) | 200 / 141 ms | match |
| arc/cirBTC | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x171a4217b86a807a64eb94757db6849fb4bdbaa0?fields=abi,sources,compilation,runtimeBytecode) | 200 / 114 ms | match |
| ethereum/WETH | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2?fields=abi,sources,compilation,runtimeBytecode) | 200 / 143 ms | match |
| ethereum/LINK | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x514910771af9ca656af840dff83e8264ecf986ca?fields=abi,sources,compilation,runtimeBytecode) | 200 / 134 ms | match |
| ethereum/AAVE | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9?fields=abi,sources,compilation,runtimeBytecode) | 200 / 150 ms | exact_match |
| ethereum/WBTC | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599?fields=abi,sources,compilation,runtimeBytecode) | 200 / 130 ms | match |
| ethereum/GRT | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xc944e90c64b2c07662a292be6244bdf05cda44a7?fields=abi,sources,compilation,runtimeBytecode) | 200 / 116 ms | match |
| ethereum/ONDO | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3?fields=abi,sources,compilation,runtimeBytecode) | 200 / 135 ms | exact_match |
| ethereum/USDY | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x96f6ef951840721adbf46ac996b59e0235cb985c?fields=abi,sources,compilation,runtimeBytecode) | 200 / 139 ms | exact_match |
| ethereum/OUSG | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0x1b19c19393e2d034d8ff31ff34c81252fcbbee92?fields=abi,sources,compilation,runtimeBytecode) | 200 / 123 ms | exact_match |
| arc/USDC | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x3600000000000000000000000000000000000000?fields=abi,sources,compilation,runtimeBytecode) | 404 / 117 ms | no verified source |
| ethereum/USDON | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/1/0xace8e719899f6e91831b18ae746c9a965c2119f1?fields=abi,sources,compilation,runtimeBytecode) | 200 / 176 ms | match |
| arc/LINK | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/5042/0x76a443768a5e3b8d1aed0105fc250877841deb40?fields=abi,sources,compilation,runtimeBytecode) | 404 / 125 ms | no verified source |
| robinhood/AAPL | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0xaf3d76f1834a1d425780943c99ea8a608f8a93f9?fields=abi,sources,compilation,runtimeBytecode) | 200 / 111 ms | match |
| robinhood/TSLA | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0x322f0929c4625ed5bad873c95208d54e1c003b2d?fields=abi,sources,compilation,runtimeBytecode) | 200 / 90 ms | exact_match |
| robinhood/CRM | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0xd95b44124e475743a7589e68f3d74008a5536d44?fields=abi,sources,compilation,runtimeBytecode) | 404 / 110 ms | no verified source |
| robinhood/ON | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0xbbd09f72b025360fee5c928053dca6248d35be54?fields=abi,sources,compilation,runtimeBytecode) | 404 / 120 ms | no verified source |
| robinhood/APLD | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0xb8dbf92f9741c9ac1c32115e78581f23509916fd?fields=abi,sources,compilation,runtimeBytecode) | 404 / 104 ms | no verified source |
| robinhood/AEHR | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0x5f604fba1162193a4388a5dfa56f556f3e133cc2?fields=abi,sources,compilation,runtimeBytecode) | 404 / 112 ms | no verified source |
| robinhood/LINK | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0x492641f648a4986844848e0befe66d14817bce34?fields=abi,sources,compilation,runtimeBytecode) | 404 / 116 ms | no verified source |
| robinhood/PONS | [Sourcify exact contract](https://sourcify.dev/server/v2/contract/4663/0x39dbed3a2bd333467115de45665cc57f813c4571?fields=abi,sources,compilation,runtimeBytecode) | 200 / 125 ms | match |

### Regression and release status

- Full automated regression: **415/415 PASS**, zero failures/skips, serial execution, 80.39 s. The first sandbox-only attempt could not run the local HTTP preview test; the complete permitted-local-server rerun passed without altering that test.
- Existing Search browser E2E: PASS at 320/390/768/1440. Existing homepage/detail browser regression: PASS at 320/390/1440. Those suites use explicit mocks and are not counted as real-source coverage.
- No new licensed artwork claimed; warm-artwork cache reliability is covered deterministically, including provider timeout/fallback behavior.
- PR #27 Mechanics visibility and PR #28 burn custody semantics retained. No unrelated application/worker/UI file changed.
- Draft branch only. No merge, production deployment, new provider authorization or infrastructure change.
