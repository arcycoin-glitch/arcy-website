# V4 completion — five-card visibility and ONDO source access

## Review boundary

Base: `ef23327dc55333adab490e2e3d14f3d2fd76e7ec` (PR #29).
Review branch: `fix/search-v4-five-card-visibility`.
This continuation changes only the Search renderer and its acceptance tests.
All backend modules, twenty field identifiers, field/evidence semantics,
provider gates, holder worker/checkpoints, signed publication protections,
logo cache improvements and PR #28 burn-custody explanations are unchanged.
No CSS, HTML skeleton, order, names, typography, responsive grid, Hero,
Unlocks, Pulse, website Burn, Swap or Research files are changed.

## Actual visibility causes and minimal fix

The previous renderer placed missing metric rows inside `.missingGroup` and
entire zero-source categories inside a closed `.unverifiedModules` group.
Its outer `#deepResearch` disclosure also started closed and was closed again
when a detail search began. These were presentation decisions, not missing
API cards. In particular, ONDO's gated Liquidity/Activity cards disappeared
into the zero-source group even though the response contained their fields
and specific missing-data reasons.

The renderer now appends all five card sections directly in the existing
definition order, and all four metric rows directly in each card. Missing
values retain NOT VERIFIED and the existing short reason. The outer report
is open initially and on navigation/new search; its existing user control and
per-card evidence/technical JSON disclosures remain. No style or markup
structure was replaced. Unknown values never become zero or positive facts.

## Production versus preview: ONDO market diagnosis

Read-only Vercel environment metadata was inspected with decryption disabled.
Only the non-secret DEX authorization boolean and target/branch scope were
compared; no credential values were returned, copied or changed.

| Environment | DEX public-display setting | Observed ONDO response |
|---|---|---|
| Existing Production | Existing `DEXSCREENER_PUBLIC_DISPLAY_APPROVED=true` | Liquidity 3/4, Activity 4/4 |
| Existing V4 PR #29 preview | No matching branch/global preview authorization | Liquidity 0/4, Activity 0/4; `PROVIDER_DISABLED_LICENSE_UNVERIFIED` |
| Other preview branch `codex/search-only-coverage-20261014` | Explicit branch-only authorization exists | Does not authorize the V4/review branches |
| Local V4 acceptance | Conservative Vercel-like environment with optional providers unapproved | Same fail-closed reason as V4 preview |

Existing V4 preview inspected:
`dpl_2ckxPZ276ocHFmZnTXiLvor5XuYp`, SHA `ef23327…`, READY.
Production was read from `https://www.arcyusdc.xyz/api/search?action=report&chain=ethereum&address=0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3`.
Its observed response included price **$0.4355**, source-reported valuation
**$4,355,272,587**, **−4.25%** change, tracked liquidity **$2,492,615.36**,
24-hour volume **$428,976.77**, and **2 DEX / 24 tracked pools**. These are
time-specific provider reports, not constants, an exhaustive pool inventory
or independent on-chain valuations. LP status remains unknown because pool
reserves do not prove LP custody/lock/burn ownership.

The V4 preview returned the exact same Ethereum ONDO contract, name and symbol,
but explicit authorization-denial fields. Thus the audited 0/4 market result
is not caused by absent pool discovery, a contract mismatch, frontend property
mapping, cache reuse or an ordinary provider timeout. The provider adapter
intentionally exits before a market request in that permission state.
No flag was copied, enabled or changed. Existing Production access was
preserved, not represented as newly obtained legal permission. This PR does
not authorize a provider or repair preview configuration behind the owner's
back; enabling that scope requires the applicable documented authorization.

Existing [DEX terms review](ARCY_SEARCH_SOURCE_LICENSE_RELEASE.md) remains in
force. [Official DEX terms](https://docs.dexscreener.com/api/api-terms-and-conditions)
were rechecked; the competing-service restriction remains relevant. There is
no silent substitution with another unlicensed aggregator.

### Compliant alternatives investigated

The existing direct Chainlink fallback is preserved for explicitly configured
Ethereum token/feed relationships (including USDC). It provides a reference
price, not 24-hour DEX volume, pool reserves or custody evidence. ONDO is not
in that verified exact-contract feed registry. The apparent
`https://data.chain.link/feeds/ethereum/mainnet/ondo-usd` route could not be
verified; an ONDO/USD [Data Stream](https://data.chain.link/streams/ondo-usd-cexprice-streams)
exists in the catalog, but it is a premium stream and the live page fetch
returned 403. It was not treated as a free public on-chain feed or activated.
No reliable, authorized alternative was established that supplies the missing
complete market/liquidity dataset without a new permission/configuration step.

## ONDO identity and artwork

The existing official issuer record matches Ethereum chain 1 and
`0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3`.
[Ondo Foundation's token documentation](https://docs.ondo.foundation/ondo-token)
was fetched live and gives that exact address. The API's existing identity is
`OFFICIAL_CONTRACT_MATCHED`, issuer Ondo Foundation. The real UI shows Ondo,
ONDO, Ethereum and the full linked contract even when no image is returned.
Artwork is not used as proof of official identity.

The prior rights/provenance findings remain: the issuer's token documentation
does not grant a token-logo redistribution license; the Global Markets token
list/media assets are not blanket permission to use a governance-token logo.
The Foundation brand URL could not be verified. No new official-looking,
ticker-only or unlicensed ONDO image is installed. Existing safe no-image /
initials behavior is preserved, with exact identity text still visible.

## Verification method and evidence boundaries

- Full existing automated regression: **415/415 PASS**, 0 failures/skips,
  80.68 seconds. The permission-denial and stronger source-evidence tests remain.
- Existing three-chain browser E2E and homepage/detail regression: PASS. These
  explicitly mock API data; they verify UI behavior, not source coverage.
- Extended visibility fixtures: **30 PASS scenarios** at desktop/mobile, three
  chains, with unknown/architecture-only/missing-field/missing-card/verified
  Mechanics data. Every scenario also checks all five cards and twenty direct
  rows without manually opening the report; evidence and overflow tests remain.
- Real acceptance uses seven requested exact contracts and actual public-source
  local API responses, with restricted provider flags left disabled. Widths
  320, 390×844, 768 and 1440 are checked without opening card-hiding groups.
- A separate **14-case baseline UI replay** renders those captured real API
  payloads through the unchanged `ef23327` HTML at desktop/mobile. This isolates
  the visibility regression without pretending the replay is a fresh live API
  result. The baseline starts with no visible rows because the report is closed;
  even after opening it, empty categories and some rows remain hidden.
- Production API was read for the same seven contracts; all seven returned
  HTTP 200. Production's pre-V4 Mechanics results are not misrepresented as a
  V4 regression. No production build/promotion or worker operation was performed.

## Measured acceptance results

Counts below are source-backed availability, not blanket current on-chain
verification. Historical holder COMPLETE values remain historical; Ethereum
source-ranked candidates remain source-ranked candidates, not a proved global
census. Transfer-only tax evidence still leaves DEX/hook fees unknown.

| Token / chain / exact contract | V4 baseline direct cards/rows after opening report | Fixed direct visible cards/rows | Source-backed S/H/L/A/M before → after | Actual decoded title art |
|---|---|---|---|---|
| ARCY/arc `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | 5/18 | 5/20 | 3/4/3/4/4 → 3/4/3/4/4 | 1363×1154 |
| USDC/ethereum `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | 4/13 | 5/20 | 3/4/0/2/4 → 3/4/0/2/4 | 32×32 |
| GRT/ethereum `0xc944e90c64b2c07662a292be6244bdf05cda44a7` | 3/11 | 5/20 | 3/4/0/0/4 → 3/4/0/0/4 | 32×32 |
| ONDO/ethereum `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | 3/11 | 5/20 | 3/4/0/0/4 → 3/4/0/0/4 | no image; identity preserved |
| LINK/arc `0x76a443768a5e3b8d1aed0105fc250877841deb40` | 4/14 | 5/20 | 3/0/3/4/2 → 3/0/3/4/2 | 32×32 |
| TSLA/robinhood `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | 2/7 | 5/20 | 3/0/0/0/4 → 3/0/0/0/4 | 180×180 |
| LINK/robinhood `0x492641f648a4986844848e0befe66d14817bce34` | 2/7 | 5/20 | 3/0/0/0/2 → 3/0/0/0/2 | 32×32 |

Every baseline report initially had 0 visible metric rows because the outer disclosure was closed. The table also measures the remaining hidden rows/categories after that outer disclosure is opened. The fixed UI needs no such expansion. Actual final scans: **7/7 PASS, 28/28 responsive states**. All seven source-backed field-state vectors match their prior V4 baseline; no source-backed slot was lost.

The previous 29-contract V4 result remains **107/116 Mechanics source-backed slots** as a baseline, not a claimed new 29-contract live run. Backend/profile/evidence modules are byte-identical in this continuation. The seven-contract Mechanics subset is **24/28 → 24/28** and the holder subset **16/28 → 16/28**, including the original evidence-scope limitations.

### Existing Production versus final local permission profile

| Token / chain | Existing Production S/H/L/A/M | Local / preview-like S/H/L/A/M |
|---|---|---|
| ARCY/arc | 3/4/3/4/4 | 3/4/3/4/4 |
| USDC/ethereum | 3/4/3/4/4 | 3/4/0/2/4 |
| GRT/ethereum | 3/4/3/4/1 | 3/4/0/0/4 |
| ONDO/ethereum | 3/4/3/4/1 | 3/4/0/0/4 |
| LINK/arc | 3/0/3/4/2 | 3/0/3/4/2 |
| TSLA/robinhood | 3/0/3/4/4 | 3/0/0/0/4 |
| LINK/robinhood | 3/0/3/4/2 | 3/0/0/0/2 |

Production is still the older deployed source, with its own authorized provider configuration. Its GRT/ONDO Mechanics 1/4 does not replace or invalidate V4's reviewed 4/4 result. Conversely, production's enabled market access must not be silently treated as permission for every preview branch.

### Exact missing-field reasons in final local acceptance

| Token / chain | Field | Reason |
|---|---|---|
| ARCY/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| ARCY/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDC/ethereum | supply.circulatingSupply | CoinGecko data is disabled for ARCY SEARCH until the applicable commercial-use rights are verified. |
| USDC/ethereum | liquidity.liquidityUsd | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.dexPairCount | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| USDC/ethereum | activity.change24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
| USDC/ethereum | activity.volume24h | DEX Screener public display is disabled until its production-use restrictions are reviewed. |
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
| LINK/arc | supply.circulatingSupply | No permitted, exact-contract circulating-supply source is currently approved. Total supply is not circulating supply. |
| LINK/arc | holders.holderCount | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.largestWalletPct | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.top10Pct | A secure signed holder publication feed is not configured. |
| LINK/arc | holders.top20Pct | A secure signed holder publication feed is not configured. |
| LINK/arc | liquidity.lpStatus | No independently verified LP lock/custody evidence. |
| LINK/arc | mechanics.tradingTaxes | Taxes need source-reviewed contract getter or exact-chain security evidence. |
| LINK/arc | mechanics.mintCapability | A generic getter cannot establish mint privileges. |
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

### Visible identity, image and restriction record

| Token / chain | Visible identity | API issuer identity status | Decoded artwork |
|---|---|---|
| ARCY/arc | Arcy (ARCY) · Arc · 0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b · Block 26504813 | OFFICIAL_CONTRACT_MATCHED | PASS |
| USDC/ethereum | USD Coin (USDC) · Ethereum · 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 · Block 26215328 | OFFICIAL_CONTRACT_MATCHED | PASS |
| GRT/ethereum | Graph Token (GRT) · Ethereum · 0xc944e90c64b2c07662a292be6244bdf05cda44a7 · Block 26215328 | OFFICIAL_CONTRACT_MATCHED | PASS |
| ONDO/ethereum | Ondo (ONDO) · Ethereum · 0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3 · Block 26215329 | OFFICIAL_CONTRACT_MATCHED | safe no-image fallback |
| LINK/arc | ChainLink Token (LINK) · Arc · 0x76a443768a5e3b8d1aed0105fc250877841deb40 · Block 26504928 | OFFICIAL_CONTRACT_MATCHED | PASS |
| TSLA/robinhood | Tesla • Robinhood Token (TSLA) · Robinhood Chain · 0x322f0929c4625ed5bad873c95208d54e1c003b2d · Block 91288138 Robinhood official registry: Stock Token contract matched · Shares-per-token multiplier: 1.000000000000000000 · This token does not represent direct share ownership. | REGISTRY_MATCHED | PASS |
| LINK/robinhood | ChainLink Token (LINK) · Robinhood Chain · 0x492641f648a4986844848e0befe66d14817bce34 · Block 91288242 | OFFICIAL_CONTRACT_MATCHED | PASS |

### Remaining limits and release safety

- Preview ONDO Liquidity/Activity remain unverified because source permission is absent. No unsupported values or configuration changes were introduced to fill them.
- Circulating supply remains unverified where no approved exact-contract source exists; no burn arithmetic is substituted.
- Unknown LP custody is not inferred from liquidity amount. Holder publication configuration/public explorer access limitations remain as documented in the parent V4 audit.
- ONDO artwork remains absent until an exact-token approved source/use permission is established. Name, symbol, Ethereum chain and full contract remain visible.
- The only application file changed is search/index.html (renderer JavaScript only). Tests and this audit are the other changes. No production, credentials, provider authorization or unrelated file changes.
- Separate Draft PR only; no merge or production deployment.
