# ARCY Search V3 — data and logo audit

> Review follow-up (2026-10-17): owner additionally authorized the narrow Mechanics row-visibility correction described below. Original data/logo findings are retained; no broader redesign is included.

Audit date: 2026-10-16 UTC. Review-only branch: `data/search-v3-data-logos`. No production deployment, provider-flag change, environment-file change, or merge.

## Baseline and scope

Vercel production was checked twice: READY `dpl_BTD8DkRDeeFe2zeNqkR5WmDaA8Xw`, exact SHA `7c1faf7baa920581f9216b3403a208d5317665b5`, source branch `data/search-mechanics-deep`. This branch descends directly from that SHA. PR #25 was reviewed and selected timeout/cache, bounded reconciliation and exact artwork records were ported; no merge. PR #26 Mechanics engine and schema remain byte-identical. The original visual baseline was not used as an outdated code base.

All counts below are **source-backed DATA_FOUND**, not a claim that every value is independently on-chain verified. There are 29 real contracts: Arc 8, Ethereum 13, Robinhood 8. Large/well-documented examples: Arc ARCY/USDC/LINK, Ethereum USDC/USDT/UNI, Robinhood AAPL/TSLA/LINK. Smaller/partial: Arc UBI/TOLLY/cirBTC, Ethereum USDY/OUSG/USDON, Robinhood CRM/ON/APLD/AEHR. Ambiguous issuer identity controls: Arc USDT-Arc, Ethereum USDON, Robinhood PONS. These are real contracts, **not assertions that they are counterfeit**. Same-ticker/wrong-chain synthetic negatives are tested separately and never counted as real coverage.

## Permission profile and evidence limits

Live before/after report runs used identical conservative local production-mode policy: VERCEL=1; GoPlus and restricted CoinGecko disabled; the Ethereum/Robinhood DEX display approval flag was absent. Production health reported the existing DEX flag enabled and GoPlus disabled; this local matrix therefore **does not claim to be the current production market-coverage matrix**. Existing legacy Arc market adapters continue their prior behavior and were not enabled or replaced by this task. No authorization flags or secrets were changed. An enabled flag is not itself legal permission. Approved and unapproved DEX profiles are covered with fixtures, not a new provider activation.

[DEX Screener API terms](https://docs.dexscreener.com/api/api-terms-and-conditions) contain commercial-use restrictions, including competing-product/resale restrictions; existing operator licensing gates remain unchanged. No new GoPlus/CoinGecko dependency or license is assumed.

## All 20 fields — before → after

The after column includes the explicitly identified successful WBTC repeat. Initial after WBTC report failed at Ethereum public RPC eth_getCode (-32000), before any card response. Raw initial totals are recorded below, not hidden.

| Card / field | Arc (n=8) | Ethereum (n=13) | Robinhood (n=8) |
|---|---:|---:|---:|
| supply.totalSupply | 8 → 8 | 13 → 13 | 8 → 8 |
| supply.circulatingSupply | 0 → 0 | 0 → 0 | 0 → 0 |
| supply.burnAddressBalance | 8 → 8 | 13 → 13 | 8 → 8 |
| supply.burnAddressPct | 8 → 8 | 13 → 13 | 8 → 8 |
| holders.holderCount | 5 → 5 | 13 → 13 | 0 → 0 |
| holders.largestWalletPct | 5 → 5 | 13 → 13 | 0 → 0 |
| holders.top10Pct | 5 → 5 | 13 → 13 | 0 → 0 |
| holders.top20Pct | 5 → 5 | 13 → 13 | 0 → 0 |
| liquidity.liquidityUsd | 8 → 8 | 0 → 0 | 0 → 0 |
| liquidity.volume24h | 8 → 8 | 0 → 0 | 0 → 0 |
| liquidity.dexPairCount | 8 → 8 | 0 → 0 | 0 → 0 |
| liquidity.lpStatus | 0 → 0 | 0 → 0 | 0 → 0 |
| activity.priceUsd | 6 → 6 | 6 → 6 | 0 → 0 |
| activity.valuation | 6 → 6 | 0 → 6 | 0 → 0 |
| activity.change24h | 5 → 5 | 0 → 0 | 0 → 0 |
| activity.volume24h | 8 → 8 | 0 → 0 | 0 → 0 |
| mechanics.tradingTaxes | 5 → 5 | 4 → 4 | 2 → 2 |
| mechanics.mintCapability | 5 → 5 | 4 → 4 | 2 → 2 |
| mechanics.ownerAdmin | 7 → 7 | 9 → 9 | 3 → 3 |
| mechanics.contractArchitecture | 8 → 8 | 13 → 13 | 8 → 8 |

| Network | Before | Initial after | After WBTC repeat |
|---|---:|---:|---:|
| arc | 118 | 118 | 118 |
| ethereum | 127 | 124 | 133 |
| robinhood | 39 | 39 | 39 |

**Deterministic gain: six explicitly labelled FDVs** (UNI, DAI, USDC, WETH, LINK, AAVE) from the existing exact-contract price and pinned raw totalSupply/decimals. No extra provider or RPC call; never market cap/circulating supply. Sound source-reported valuations are retained. Contradictory cap above full-supply value is withheld/replaced as FDV with rejection evidence. No circulating-supply subtraction. No claimed Holder/Mechanics coverage increase from this change.

### Exact contracts and measured coverage

| Network | Token | Exact contract | Before /20 | Initial after /20 | Successful repeat /20 |
|---|---|---|---:|---:|---:|
| arc | ARCY | `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | 18 | 18 | — |
| arc | ARGUS | `0xece5ca8bf9220718e5727754026757512212cb3c` | 18 | 18 | — |
| arc | USDT-Arc | `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` | 12 | 12 | — |
| arc | UBI | `0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56` | 15 | 15 | — |
| ethereum | USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` | 11 | 11 | — |
| ethereum | UNI | `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | 12 | 13 | — |
| ethereum | DAI | `0x6b175474e89094c44da98b954eedeac495271d0f` | 12 | 13 | — |
| ethereum | USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | 12 | 13 | — |
| arc | TOLLY | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | 14 | 14 | — |
| arc | cirBTC | `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` | 18 | 18 | — |
| ethereum | WETH | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | 9 | 10 | — |
| ethereum | LINK | `0x514910771af9ca656af840dff83e8264ecf986ca` | 9 | 10 | — |
| ethereum | AAVE | `0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9` | 10 | 11 | — |
| ethereum | WBTC | `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` | 9 | RPC FAILURE | 9 |
| ethereum | GRT | `0xc944e90c64b2c07662a292be6244bdf05cda44a7` | 8 | 8 | — |
| ethereum | ONDO | `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | 8 | 8 | — |
| ethereum | USDY | `0x96f6ef951840721adbf46ac996b59e0235cb985c` | 9 | 9 | — |
| ethereum | OUSG | `0x1b19c19393e2d034d8ff31ff34c81252fcbbee92` | 9 | 9 | — |
| ethereum | USDON | `0xace8e719899f6e91831b18ae746c9a965c2119f1` | 9 | 9 | — |
| arc | USDC | `0x3600000000000000000000000000000000000000` | 11 | 11 | — |
| arc | LINK | `0x76a443768a5e3b8d1aed0105fc250877841deb40` | 12 | 12 | — |
| robinhood | AAPL | `0xaf3d76f1834a1d425780943c99ea8a608f8a93f9` | 7 | 7 | — |
| robinhood | TSLA | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | 7 | 7 | — |
| robinhood | CRM | `0xd95b44124e475743a7589e68f3d74008a5536d44` | 4 | 4 | — |
| robinhood | ON | `0xbbd09f72b025360fee5c928053dca6248d35be54` | 4 | 4 | — |
| robinhood | APLD | `0xb8dbf92f9741c9ac1c32115e78581f23509916fd` | 4 | 4 | — |
| robinhood | AEHR | `0x5f604fba1162193a4388a5dfa56f556f3e133cc2` | 4 | 4 | — |
| robinhood | LINK | `0x492641f648a4986844848e0befe66d14817bce34` | 5 | 5 | — |
| robinhood | PONS | `0x39dbed3a2bd333467115de45665cc57f813c4571` | 4 | 4 | — |

### Classification

- Supply: pinned chain RPC totalSupply and zero/dead balance; burn percentage is explicitly on-chain-derived custody percentage, not lifetime burns. Circulating remains NOT VERIFIED without authorized contract-matched source.
- Arc Holders: existing historical verified COMPLETE publications retain original pinned block/time. Worker, durable store, publication signing and queue code untouched.
- Ethereum holders: Blockscout count is **SOURCE_REPORTED**; ranked candidate balances are **SOURCE_REPORTED_RPC_RECONCILED**, with provider-ranked-sample scope. They are not relabelled a complete census or cryptographic proof of global rank. Reconciliation rejects duplicate addresses case-insensitively and invalid/zero balances.
- Robinhood holders: explorer HTTP403 prevents candidate enumeration; no partial concentration is promoted. Concurrent balance reads are capped at four, preserving existing completeness requirements and pinned block.
- Liquidity/volume/pool counts: source-reported exact-network/contract pool subtotals, not full-network totals. Identical pairs deduplicate; conflicting duplicate pools are excluded. LP custody remains unverified without ownership/lock proof.
- Market: existing source-reported price or exact canonical oracle reference, with scope; new FDV derives from pinned supply × that price. Signed-negative oracle answers and incomplete rounds fail closed. No OHLCV/chart change.
- Mechanics: prior reviewed source + pinned bytecode/storage/getter engine unchanged. No absence inferred from missing ABI/getter; hook/trading fee limitations preserved.

## Logo diagnosis and provenance

Production exact `ondo` discovery returned 12 candidates and **all logoUrl/logoSource fields null** (HTTP200, 2032ms in the observed sample). Exact ONDO DEX request returned one pair but **no info.imageUrl**. Thus no image URL was lost in rendering, CSP or has-logo for those results: the browser correctly had no image to request. CC0 repository ONDO artwork path returned404. Existing rights restriction remains unresolved; official media-kit instructions are not treated as a permissive reusable license. ONDO/USDY/OUSG/USDON keep initials. No false artwork/issuer assignment.

A separate concrete rendering defect was verified: WETH backend returned bundled eth.svg but the detail local-art allowlist omitted eth; frontend refused it. Fixed only the local exact-contract catalog/allowlist, not the DOM/CSS. Homepage can accept vetted exact local art without upgrading its issuer badge. Added GRT local CC0 artwork and first-party contract mappings for Arc LINK, Robinhood LINK and Ethereum GRT.

[Chainlink contract registry](https://docs.chain.link/resources/link-token-contracts) live HTTP200 contained both exact new LINK addresses (788ms). [The Graph tokenomics](https://thegraph.com/docs/en/resources/tokenomics/) HTTP200 contained exact GRT address (765ms). [Pinned upstream CC0 license](https://raw.githubusercontent.com/spothq/cryptocurrency-icons/1a63530be6e374711a8554f31b17e4cb92c25fa5/LICENSE.md) HTTP200 (424ms). The artwork manifest records the original GRT SHA256, exact mappings and source revision. AAVE was already present in production and is **not** counted as new.

Remote raster validation now checks approved HTTPS paths, exact Robinhood contract basename, no redirects/credentials, MIME/signature/dimensions, streamed 256KiB limit, 8–2048px bounds, timeout and positive/negative cache expiry. Remote SVG is rejected; local GRT SVG is audited for executable content. Validation is not a full browser codec decoder; actual browser load/decode is tested separately. Art validation has one-second aggregate budget and three concurrent reads per enhancement. It never changes issuer status.

### Actual browser image coverage

Real Edge, local baseline/V3 API, live public sources. Desktop1440×1000 and mobile390×844. Report-body counts are not treated as successful image loads: naturalWidth/naturalHeight and browser decode were checked. Four slower stock artwork loads were repeated after explicit decode before counting.

| Network | Loaded before | Loaded after | Same real-contract set |
|---|---:|---:|---|
| Arc | 4/8 | 5/8 | ARCY, ARGUS, USDT-Arc, UBI, TOLLY, cirBTC, USDC, LINK |
| Ethereum | 7/13 | 9/13 | all 13 contracts above |
| Robinhood | 6/8 | 8/8 | all 8 contracts above |
| Total | 17/29 | 22/29 | PONS variation explained below |

**Four attributable repairs:** WETH detail allowlist, Ethereum GRT, Arc LINK, Robinhood LINK. On the original 28-token common sample:17/28→21/28. PONS was independently observed with no art in baseline browser and with valid800×800 DEX art in the later V3 run; this fifth increase is **source/timing availability**, not claimed a deterministic code fix. No loaded image in the counted set was broken. Expected no-art fallbacks are not counted as loaded logos. Stock PNGs decoded180×180; local CC0 icons32×32 or150×150; ARCY1363×1154; ARGUS450×450; TOLLY400×400.

Detail re-search desktop: ONDO0→0 loaded images among8 displayed results; GRT0→1, WETH0→1, ArcLINK0→1, RobinhoodLINK0→1, TSLA1→1. Homepage desktop: GRT0→1, WETH0→1, ArcLINK0→1, RobinhoodLINK0→1, ONDO0→0, TSLA1→1. Mobile V3 repeated these same six queries on both surfaces. Detail loaded avatars set has-logo; homepage uses its existing image-overlay behavior rather than that detail-only class. Existing error-removal/fallback behavior is unchanged and tested with image failures.

The real ONDO detail screenshot shows intact initials, correct chain and exact-contract candidates, no blank/broken image frame. No CSP/hotlink diagnosis is asserted for a URL that was never supplied. Same-symbol fake contracts, wrong-network images and wrong Robinhood registry basenames are rejected by regression fixtures; no real token was branded official by a picture.

### Live latency and request observations

Independent sequential before/after public-source runs, paired successful contracts. These are observations, not controlled speed benchmarks or production SLA. Request count includes read-only RPC/source requests, not browser static assets. WBTC failed initial after run and is excluded from this paired latency table, then separately recovered in6708ms. PONS was additional4513ms V3, no request instrumentation.

| Network | Paired n | Mean before ms | Mean after ms | Mean requests before → after |
|---|---:|---:|---:|---:|
| Arc |8|11954|13706|44.8→45.1|
| Ethereum |12|5376|4573|47.3→47.3|
| Robinhood |7|3479|3818|26.4→27.1|

Do **not** claim universal speedup: Arc/RH were slower in these variable-provider samples. Six FDVs add zero requests; bounded image validation adds up to1s for optional remote art. Existing report engine and independent-source semantics are preserved. Shared source cache/coalescing reduces duplicate calls only on repeated/in-flight reads. DEX cached evidence keeps original retrieval time, not a new fresh timestamp. Cache/coalescing and production approval modes are tested deterministically; no market flag was toggled in production.

## Remaining honest gaps

- ONDO-family reusable artwork rights/source image availability: unresolved. Keep initials.
- Robinhood explorer holder enumeration: HTTP403, so there is no authorized usable complete census; no invented percentages. Existing durable Arc worker is untouched.
- Circulating supply: authorization/source identity gap; no total-minus-burn fallback.
- LP custody: no independent lock/burn ownership proof; liquidity is not custody.
- Taxes/privileges: unknown source or insufficient exact runtime evidence stays unknown; engine unchanged.
- Additional Chainlink feeds: official candidate pages returned HTTP429; no remembered/unverified feed address added.
- ETH public RPC transient eth_getCode(-32000) occurred for WBTC; successful repeat distinguishes provider availability from code behavior.
- Third-party image bytes are bounded/sanitized raster checks, not a license grant or issuer-verification proof.

## Implementation and safety

Source body deadlines now remain active after HTTP headers; coalescing, TTL and source429 cooldown reuse the existing source-request abstraction. Holder percentage standards and pinned reconciliation remain unchanged; case-insensitive duplicate addresses fail closed and RH RPC concurrency is four. Pool parsing accepts finite scientific decimal strings, excludes contradictory duplicates and retains correct contract/network scope. Oracle signed values and completed rounds are validated. Optional remote artwork is cacheable with bounded negative cache and fails to initials without blocking card data indefinitely.

No new serverless function, provider credential, worker/store schema, queue or deployment configuration. No main/homepage HTML change, CSS change, chart behavior change, visual DOM change, navigation/animation/mascot change, unrelated API change or API field-ID replacement. Search-only catalog rendering is the minimal exception explicitly authorized for logos.

## Validation

- Full Node suite: **393/393 PASS**, same full suite with --test-concurrency=1,81.15s.
- Earlier default-parallel run:391/392, legacy Holder deadline fixture failed under concurrent browser CPU load; not hidden or changed. Windows sandbox run also encountered EPERM rename on unrelated temporary-file tests; rerun outside sandbox. Serial full suite passed without weakening existing tests.
- Real desktop:29 unique contracts via28-token main browser run plus PONS follow-up; all29 exact-chain reports rendered5 cards/20 field slots and evidence panels. Mobile:11 representative contracts, all three networks, plus six queries on both discovery surfaces. No page errors or document overflow. Metrics remaining unavailable are recorded as unavailable rather than counted as verified.
- New negative coverage: unsafe MIME/SVG/redirects/oversize/dimensions, body timeout/cache expiry, scientific numeric invalids, wrong chain/contract, contradictory pools, holder duplicates, bounded RH concurrency, negative/incomplete oracle answers, FDV evidence binding, production permission profiles and unchanged PR26 engine/schema and visual DOM.
- Reproducible live audit: `node test/search-v3-live.cjs <checkout> <output-dir> <port>` with Playwright/Edge available. Optional ARCY_V3_ONLY and ARCY_V3_WIDTHS restrict repeats; default29 contracts and both widths. It makes read-only public-source requests, no production writes or provider approvals. Private local raw reports/screenshots are not committed; output is caller-selected.

Existing browser regression final results are appended below. This is a review-ready data upgrade, **not production approval or deployment**.

### Remaining field reasons by exact sample

Contracts are given in the table above. Codes below come from the measured response; NOT VERIFIED is retained.

| Network / token | Unavailable fields and reason codes |
|---|---|
| arc / ARCY | supply.circulatingSupply — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| arc / ARGUS | supply.circulatingSupply — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| arc / USDT-Arc | supply.circulatingSupply, activity.priceUsd, activity.change24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; activity.valuation — VALUATION_NOT_VERIFIED; mechanics.tradingTaxes — TAX_NOT_VERIFIED; mechanics.mintCapability — MINT_NOT_VERIFIED; mechanics.ownerAdmin — OWNER_ADMIN_NOT_VERIFIED |
| arc / UBI | supply.circulatingSupply, activity.priceUsd, activity.change24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; activity.valuation — VALUATION_NOT_VERIFIED |
| ethereum / USDT | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / UNI | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / DAI | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / USDC | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| arc / TOLLY | supply.circulatingSupply — PROVIDER_DISABLED_LICENSE_UNVERIFIED; holders.holderCount, holders.largestWalletPct, holders.top10Pct, holders.top20Pct — SIGNED_HOLDER_PUBLICATION_UNAVAILABLE; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| arc / cirBTC | supply.circulatingSupply — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / WETH | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.ownerAdmin — OWNER_ADMIN_NOT_VERIFIED |
| ethereum / LINK | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.ownerAdmin — OWNER_ADMIN_NOT_VERIFIED |
| ethereum / AAVE | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / WBTC | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / GRT | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.ownerAdmin — OWNER_ADMIN_NOT_VERIFIED |
| ethereum / ONDO | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.ownerAdmin — OWNER_ADMIN_NOT_VERIFIED |
| ethereum / USDY | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / OUSG | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| ethereum / USDON | supply.circulatingSupply, liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h, mechanics.tradingTaxes, mechanics.mintCapability — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| arc / USDC | supply.circulatingSupply, activity.change24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; holders.holderCount, holders.largestWalletPct, holders.top10Pct, holders.top20Pct — SIGNED_HOLDER_PUBLICATION_UNAVAILABLE; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.tradingTaxes — TAX_NOT_VERIFIED; mechanics.mintCapability — MINT_NOT_VERIFIED |
| arc / LINK | supply.circulatingSupply — PROVIDER_DISABLED_LICENSE_UNVERIFIED; holders.holderCount, holders.largestWalletPct, holders.top10Pct, holders.top20Pct — SIGNED_HOLDER_PUBLICATION_UNAVAILABLE; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED; mechanics.tradingTaxes — TAX_NOT_VERIFIED; mechanics.mintCapability — MINT_NOT_VERIFIED |
| robinhood / AAPL | supply.circulatingSupply, holders.holderCount — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / TSLA | supply.circulatingSupply, holders.holderCount — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / CRM | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability, mechanics.ownerAdmin — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / ON | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability, mechanics.ownerAdmin — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / APLD | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability, mechanics.ownerAdmin — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / AEHR | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability, mechanics.ownerAdmin — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / LINK | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |
| robinhood / PONS | supply.circulatingSupply, holders.holderCount, mechanics.tradingTaxes, mechanics.mintCapability, mechanics.ownerAdmin — INSUFFICIENT_EVIDENCE; holders.largestWalletPct, holders.top10Pct, holders.top20Pct — BLOCKSCOUT_HOLDERS_HTTP_403; liquidity.liquidityUsd, liquidity.volume24h, liquidity.dexPairCount, activity.priceUsd, activity.valuation, activity.change24h, activity.volume24h — PROVIDER_DISABLED_LICENSE_UNVERIFIED; liquidity.lpStatus — LP_STATUS_NOT_VERIFIED |

## Exact changed files

- `docs/SEARCH_V3_DATA_LOGO_AUDIT.md`
- `search-upgrade.js`
- `search/assets/token-icons/grt.svg`
- `search/assets/token-icons/search-v3-logo-provenance.json`
- `search/index.html`
- `search/server/lib/dex-market.js`
- `search/server/lib/discover.js`
- `search/server/lib/eth.js`
- `search/server/lib/holders.js`
- `search/server/lib/logo-validation.js`
- `search/server/lib/multichain-service.js`
- `search/server/lib/oracle-market.js`
- `search/server/lib/report.js`
- `search/server/lib/robinhood-adapter.js`
- `search/server/lib/robinhood-assets.js`
- `search/server/lib/robinhood-holder-rank.js`
- `search/server/lib/search-logo.js`
- `search/server/lib/token-identity.js`
- `search/server/lib/valuation.js`
- `test/search-logo-engine.test.js`
- `test/search-v3-data.test.js`
- `test/search-v3-live.cjs`
- Existing Search browser E2E: **PASS** at320/390/768/1440px, all three networks, image load/fallback, exact candidate flow, evidence and all four unchanged chart presets.
- Existing general browser regression: **PASS** at320/390/1440px, source429/report503 isolation and unchanged5 cards/20 metrics.
- Both were rerun alone without modifying either test. Initial simultaneous runs observed one extra debounced discovery request (25 vs24;19 vs18); this timing sensitivity is disclosed, not “fixed” by weakening assertions or changing UI behavior.
- Production remains READY at7c1faf7. This branch is for DRAFT review only; production is not deployed from it.


## Review follow-up — TSLA deterministic tests and Mechanics row visibility

### TSLA regression diagnosis

The previous392/393 failure expected the exact official TSLA PNG URL but received null after roughly1017ms. The registry itself was mocked; the subsequent binary artwork fetch was not. This made a unit assertion depend on live CDN/network availability within the existing1s image budget. Original failure logs did not record the HTTP outcome, so an exact historical403/429 versus timeout cannot be retroactively asserted.

Three unmodified single-test retries all passed (process totals1246/498/496ms). Three fresh Node-runtime live validation probes returned HTTP200 image/png,180×180, no redirect: cold360/204/198ms; warm0ms with no second HTTP request. Production discovery returned the exact4663 TSLA contract and official PNG in1404ms. The existing5dfacb1 preview was protected for raw fetch; Vercel authenticated fetch confirmed the same exact contract, chain and registry logo without changing protection or exposing credentials. These results support the owner's independent observation: contract identity mapping is correct.

The proven defect fixed here is **nondeterministic unit-test I/O**, not an invented production identity defect. The original assertions are retained. An injected complete32×32 PNG fixture replaces live image I/O in that one existing logo test; unmatched contract artwork receives an empty mocked market response. A new test explicitly rejects accidental global fetch use. No production image-validator, timeout, cache TTL or identity/security logic was changed.

Seven added unit cases cover exact TSLA identity, the existing1s timeout, body stall after headers, HTTP403/429/503/network outages, negative-cache expiry/recovery, concurrent validation/warm cache, wrong chain/contract, redirects and executable SVG rejection. The timeout test deterministically produces null without any concurrency, proving that concurrency is not necessary for this outcome. Negative results remain cached30s; valid art15min. The current conservative fallback is intentional: an upstream image exceeding1s or failing security validation may still produce initials. It does not erase issuer identity or metrics and is not a permanent poisoned cache.

The separate live browser test uses real production API responses and actual180×180 PNG decode at1440px and390×844. It tests title art, detail re-search and homepage suggestions. Simulated browser-only CDN503 restores TS initials on both discovery surfaces. Fault cases use fresh browser contexts: reusing already-decoded browser memory would otherwise hide the simulated outage. No production API, provider flag or application cache is altered by this test.

### Owner-requested Mechanics visibility correction

The renderer previously moved unresolved rows into missingGroup, and moved a wholly unresolved card into unverifiedModules. The narrowly scoped correction in search/index.html exempts only mechanics from both hide rules. The existing four row labels, metric identifiers, formatters, verified values, NOT VERIFIED fallback, short reasons and View sources & evidence remain unchanged. Unknown rows do not increase verified/source-backed counts. The redundant zero-source notice is omitted for Mechanics because its four visible reasons already explain the state. No rows are duplicated in the disclosure.

No CSS, static HTML skeleton, card order, typography, spacing, colors, backend/data semantics, other cards, PR26 engine, workers, licensing flags or unrelated sections changed. This is the explicitly requested visibility exception to the original visual freeze. The existing full-report disclosure remains unchanged.

Focused browser fixtures passed30/30 combinations: three networks ×1440/390px ×architecture-only/all-unverified/missing-fields/missing-card/all-verified. Missing-schema resilience is tested by directly invoking the renderer after loading a valid report; the API's strict schema validation is not weakened. All four Mechanics rows are direct children, visible; total structure stays5 cards/20 metric rows. Evidence access and document/card overflow checks pass. Screenshots were inspected at both widths.

Real-source local browser acceptance passed ARCY(Arc), GRT(Ethereum), TSLA(Robinhood) at both1440px and390×844. Each returned its exact-chain contract, five cards and twenty fields, with four visible Mechanics rows. Missing data remains NOT VERIFIED. Provider approval flags stayed disabled in the conservative local profile; no new provider was enabled. This focused follow-up does not claim a new29-token data-coverage increase.

### Follow-up regression results

- Full Node suite:400/400 PASS (default parallel,18.06s).
- Full Node suite repeat:400/400 PASS (serial file scheduling,74.04s).
- Existing Search browser regression: PASS unchanged,320/390/768/1440px, three networks, chart presets and logo rendering.
- Existing general browser regression: PASS unchanged,320/390/1440px, error isolation,5 cards/20 metrics.
- Focused Mechanics visibility:30/30 PASS.
- Live TSLA production browser and browser-only image outage fallback: desktop/mobile PASS.
- Real-source ARCY/GRT/TSLA visibility: desktop/mobile PASS.
- PR26 engine/schema and unchanged unrelated site files remain protected by the full regression. No application/backend source changes were required for TSLA.

Follow-up files: search/index.html; test/search-pulse-original-logos.test.js (TSLA test only, existing Pulse assertions untouched); test/helpers/logo-artwork.cjs; test/search-logo-reliability.test.js; test/search-mechanics-visibility.cjs; test/search-tsla-logo-live.cjs; test/search-v3-live.cjs (direct-row assertions and explicit sample-filter handling); this report.

Review only. No merge, manual deployment, production promotion or provider/security configuration change.
- Final full-suite repeat on the completed changes: **400/400 PASS**, serial file scheduling,79.00s. Total:three full successful runs. No test assertion or production security limit was weakened.
