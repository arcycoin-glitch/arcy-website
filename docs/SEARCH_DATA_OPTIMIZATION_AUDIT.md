# Search data and logo audit — approved baseline 76c857a

Scope: Search-only data/identity work. The approved commit is immutable. Development branch: `data/search-data-optimization`. No production configuration, provider approval flags, design, Unlocks, Pulse, Burn, Research or Swap changes are authorized here.

## Before implementation (2026-10-16)

Full baseline suite: 291/291. Nine live exact-contract reports were measured locally with Vercel production policy enabled, without credentials or permission overrides. This deliberately conservative profile is not a claim about deployed configuration. Public production health reports DEX Screener enabled and GoPlus disabled; health expressly does not attest legal permission. No flags will be enabled by this work.

| Card / metric | Arc source | Ethereum source | Robinhood source | Evidence / gap |
|---|---|---|---|---|
| Supply / totalSupply | pinned Arc RPC | pinned ETH RPC | pinned RH RPC | On-chain, exact contract and network; unavailable if mandatory RPC fails |
| Supply / circulatingSupply | legacy exact-contract circulation | disabled licensed adapter | unavailable | Issuer/provider-reported only; no total-minus-burn arithmetic |
| Supply / burnAddressBalance | zero/dead balanceOf | zero/dead balanceOf | zero/dead balanceOf | On-chain custody at one block; not lifetime burn |
| Supply / burnAddressPct | custody / total | custody / total | custody / total | On-chain-derived, invalid denominator rejected |
| Holders / count | signed COMPLETE, original publication, explorer count | explorer counters, full small set | explorer/optional existing PRO | Signed historical snapshot or explicitly source-reported current count |
| Holders / largest | COMPLETE publication | RPC-reconciled source ranking | gated limited sample | Full enumeration and source-ranked evidence must remain distinct |
| Holders / top10 | COMPLETE publication | RPC-reconciled source ranking | gated limited sample | Small ETH populations unnecessarily rejected below 20 |
| Holders / top20 | COMPLETE publication | RPC-reconciled source ranking | unavailable | No fabricated missing ranks; source failure must not erase a usable count |
| Liquidity / liquidityUsd | original tracked exact-contract pools | permitted DEX observations | permitted DEX observations | Source-reported returned-pool subset, production permission gate preserved |
| Liquidity / volume24h | same | same | same | Source-reported tracked subset, not chain-wide volume |
| Liquidity / dexPairCount | same | same | same | Returned pairs only; not exhaustive DEX census |
| Liquidity / lpStatus | existing custody analysis | unavailable | unavailable | Liquidity amount does not establish custody, lock or burn |
| Activity / priceUsd | exact base-token pools | same | same | Source-reported, no quote-token price reuse |
| Activity / valuation | same | same | same | Market cap and FDV separately labelled; RH token value is not issuer equity cap |
| Activity / change24h | same | same | same | Source-reported, source timestamp/caching can differ |
| Activity / volume24h | tracked pool subtotal | same | same | Duplicate shared observation, not a new independent metric source |
| Mechanics / taxes | mature reviewed source/getter/hook pipeline | gated security provider | gated security provider | Never infer zero tax from absent getter; V4 hook scope preserved |
| Mechanics / mint | mature reviewed source/roles | security provider | security provider | Unknown without actual capability evidence; ABI names alone insufficient |
| Mechanics / ownerAdmin | original evidence / owner getter | owner/admin getter | owner/admin getter | Zero/missing owner does not prove no authority; canonical ABI padding required |
| Mechanics / architecture | original evidence / implementation slot | implementation slot/getter | implementation slot/getter | Missing slot is not NON-PROXY; conservative runtime/clone/legacy/beacon proof can improve coverage |

Live baseline (source-backed cells, not all independently on-chain): Arc ARCY 18/20, ARGUS 18/20, LINK 11/20; Ethereum USDC 5/20, UNI 7/20, USDT 5/20; Robinhood AAPL 3/20, TSLA 3/20, LINK 4/20. Provider changes can vary later values. Arc/RH explorer search returned 403; ETH counters returned 200. Official Robinhood registry returned 195 assets. No Cloudflare challenge bypass is attempted.

## Logo audit

Server local registry has 2 Arc and 7 Ethereum entries, none for RH. RH registry already supplies issuer artwork; remote third-party artwork remains disabled. Homepage and detail page each have an additional exact-contract artwork table, so backend-only additions would be invisible. Only these data tables may be extended; DOM/layout/CSS/interaction behavior must stay byte-equivalent.

Permitted improvement sources:
- Existing CC0 cryptocurrency-icons collection: https://github.com/spothq/cryptocurrency-icons/blob/master/LICENSE.md (CC0 covers artwork copyright, not trademark endorsement).
- Chainlink issuer contract list: https://docs.chain.link/resources/link-token-contracts — Arc 5042 `0x76a443768a5e3b8d1aed0105fc250877841deb40`, RH 4663 `0x492641f648a4986844848e0befe66d14817bce34`.
- AAVE issuer documentation: https://www.aave.com/docs/ecosystem/aave and its linked Ethereum deployment.
- GRT issuer documentation: https://thegraph.com/docs/en/resources/tokenomics/.

No ticker-only logo mappings, no unlicensed image host enabling, no fabricated issuer identity. Missing artwork retains the current letters fallback.

## Safe implementation selected

1. Exact-chain/contract CC0 artwork additions plus source provenance; strict RH registry artwork contract binding.
2. Reuse conservative runtime proof for non-delegating bytecode; inspect exact minimal clones and confirmed legacy/EIP-1967 beacon targets at one pinned block. Unknown mechanisms remain unknown.
3. Complete small Ethereum holder reconciliation, preserving independently usable holder count on ranked-source failure.
4. Bounded source requests with full-body timeout, in-flight coalescing, short successful-response caching and rate-limit cooldown. Never cache failures as data or show stale evidence as fresh.
5. Negative and malformed identity regression tests, full suite and frozen-design browser checks.

Further circulation, tax and LP coverage requiring new paid subscriptions, unsettled data rights or unsupported inference is intentionally blocked. Existing production permissions/configuration are not changed.

## Implemented and live-validated comparison

The same nine contracts, same no-credential local runtime and same conservative production policy were used before/after. Counted observations include explicitly provider-reported and historical fields, not just independently on-chain-verified fields. All preserve source/status/evidence. This is a sample, not a claim of universal token coverage.

| Network / contract | Before | After | Before ms | After ms |
|---|---:|---:|---:|---:|
| Arc ARCY `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | 18/20 | 18/20 | 10078 | 9381 |
| Arc ARGUS `0xece5ca8bf9220718e5727754026757512212cb3c` | 18/20 | 18/20 | 7396 | 6553 |
| Arc LINK `0x76a443768a5e3b8d1aed0105fc250877841deb40` | 11/20 | 12/20 | 3930 | 4371 |
| Ethereum USDC `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | 5/20 | 6/20 | 3891 | 3721 |
| Ethereum UNI `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | 7/20 | 8/20 | 1858 | 1994 |
| Ethereum USDT `0xdac17f958d2ee523a2206206994597c13d831ec7` | 5/20 | 6/20 | 3499 | 2136 |
| Robinhood AAPL `0xaf3d76f1834a1d425780943c99ea8a608f8a93f9` | 3/20 | 4/20 | 2207 | 2938 |
| Robinhood TSLA `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | 3/20 | 4/20 | 1371 | 2457 |
| Robinhood LINK `0x492641f648a4986844848e0befe66d14817bce34` | 4/20 | 5/20 | 1387 | 1621 |

Totals: Arc 47/60 → 48/60; Ethereum 17/60 → 20/60; Robinhood 10/60 → 13/60. Total 74/180 → 81/180 (41.1% → 45.0%). Seven additional defensible architecture observations, zero downgraded fields in the paired run. Extra runtime proof costs RPC work on some tokens; this is not a blanket latency-speedup claim. These sequential single-run timings are diagnostic, not statistical performance benchmarks.

### All 20 metrics (source-backed tokens / 3 per network)

| Metric | Arc before → after | Ethereum before → after | Robinhood before → after |
|---|---|---|---|
| Total supply | 3 → 3 | 3 → 3 | 3 → 3 |
| Circulating supply | 0 → 0 | 0 → 0 | 0 → 0 |
| Burn-address balance | 3 → 3 | 3 → 3 | 3 → 3 |
| Burn-address percent | 3 → 3 | 3 → 3 | 3 → 3 |
| Holder count | 2 → 2 | 3 → 3 | 0 → 0 |
| Largest holder | 2 → 2 | 1 → 1 | 0 → 0 |
| Top 10 | 2 → 2 | 1 → 1 | 0 → 0 |
| Top 20 | 2 → 2 | 1 → 1 | 0 → 0 |
| Tracked liquidity | 3 → 3 | 0 → 0 | 0 → 0 |
| Tracked 24h volume (liquidity) | 3 → 3 | 0 → 0 | 0 → 0 |
| Returned DEX/pairs | 3 → 3 | 0 → 0 | 0 → 0 |
| LP status | 0 → 0 | 0 → 0 | 0 → 0 |
| Price | 3 → 3 | 0 → 0 | 0 → 0 |
| Market cap / FDV | 3 → 3 | 0 → 0 | 0 → 0 |
| 24h change | 3 → 3 | 0 → 0 | 0 → 0 |
| Tracked 24h volume (activity) | 3 → 3 | 0 → 0 | 0 → 0 |
| Trading taxes | 2 → 2 | 0 → 0 | 0 → 0 |
| Mint capability | 2 → 2 | 0 → 0 | 0 → 0 |
| Owner/admin | 3 → 3 | 2 → 2 | 1 → 1 |
| Contract architecture | 2 → 3 | 0 → 3 | 0 → 3 |

### Logo results

Four newly working exact-contract mappings: Arc LINK, Robinhood LINK, Ethereum AAVE, Ethereum GRT. Two original CC0 SVGs added; existing LINK artwork reused. Local server mappings: Arc 2 → 3; Ethereum 7 → 9; RH 0 → 1. Issuer registry logos remain separate and protected by exact deployment address. A registry response pointing at another contract's artwork now falls back safely to letters.

The homepage autocomplete and detail-page changes are limited to identity/artwork data catalogs and the existing local-file allowlist. No layout, styling, interaction, chart, skeleton or markup behavior changed. Original rollback commit unchanged. 86 frozen source/config files compared against the approved baseline without differences; after stripping only the allowed data catalogs, both frontend source files are otherwise identical.

### Remaining evidence gaps and external limitations

- All networks: no newly authorized exact-contract circulating supply source; total minus burn is never substituted. LP lock/custody needs actual ownership evidence, not pool liquidity.
- Arc LINK: no usable COMPLETE holder publication; public explorer gives 403. No partial ranks published. Taxes/mint remain unknown without reviewed source/getter authority evidence.
- Ethereum USDC/USDT ranked balances can differ from the earlier report pin. This is source/index lag, not evidence of missing holders. Later browser runs sometimes reconciled all three rankings, taking USDC/USDT to 9/20. Those variable six cells are **not credited to this code change**.
- Ethereum/RH market and security provider restrictions remain active in the conservative profile. Actual production health currently reports DEX enabled and GoPlus disabled; this work does not alter either flag or claim permission based on a flag.
- RH holder explorer returned 403; no configured authorized alternative was assumed. Stock token multiplier is not circulating supply, underlying stock price or underlying equity market cap.
- Mint/tax results were not manufactured from function names, selector presence or missing getters. No default zero taxes or ownership absence were introduced.
- Chainlink's Ethereum feed registry was investigated live, but current first-party deployment/usage confirmation was insufficient for adding it as a new price source. It is **not integrated**.

### Test and browser evidence

- Approved baseline: 291/291 automated tests.
- Final full automated suite: **305/305 passed**, zero failed/skipped.
- New safety suite: 14 tests for exact identity, conservative runtime, unsupported formats, clone/legacy/beacon targets, holder reconciliation, failure isolation, canonical address padding, request coalescing, cooldown, body timeout and malformed-source cache rejection.
- Existing Search browser suite: 320/390/768/1440px, three networks, existing five cards / 20 checks and chart presets. One stale test incorrectly expected no RH iframe despite the approved baseline already supporting it; corrected test only, chart code unchanged.
- Real-source local API/browser: 11 desktop tokens, plus Arc LINK / RH LINK / ETH AAVE at 390×844; real `/api/search` responses, all 20 controls, evidence, no document overflow, all four added logos loaded. No mocked Search data used in this live suite.
- Live supplementary AAVE 9/20 and GRT 8/20, no before/after coverage claim for these extra tokens.
- Live desktop repeat on original nine: 87/180, versus paired run 81/180, entirely due to provider-rank freshness on USDC/USDT.
- Commands: `npm test`, `npm run test:search-browser`, `npm run test:browser`, `node test/search-data-live.cjs <explicit-local-output-directory>`.
- Legacy `npm run test:browser` is **not passing**: it fills the old hidden `#contract` input. The identical timeout was reproduced on a separate untouched checkout of approved commit `76c857a`. That legacy test was not changed and the approved UI was not altered to make it pass. Current Search E2E and real-source browser acceptance both pass. Thus do not describe all historical browser scripts as passing.
- Audit results/screenshots remain outside the repository checkout; no environment files, credentials or generated snapshots are added.

## Review handoff revalidation — 2026-10-16

The full suite was rerun for the review handoff: **305/305 PASS**, zero failures/skips. The current Search browser suite passed at 320/390/768/1440px. The real-source browser suite passed again for 11 desktop tokens and three 390×844 mobile scans, including all four added exact-contract logos. These are local tests, not a production deployment or GitHub CI result.

All package test commands were attempted. Two obsolete helpers remain failing independently of this change: `test:browser` targets the approved UI's hidden legacy `#contract` input; `test:live` imports removed legacy API modules (`api/control`). They are not counted as passing. The full suite and browser tests were rerun outside the Windows sandbox after sandbox-only rename/browser-launch permission errors.

The original paired coverage measurements above remain the before/after comparison; changing live provider responses are not additional credited improvements. A fresh protected-file check found no content changes (ignoring checkout line endings) in 75 tracked CSS, root HTML, API, shared library, worker/script and Vercel configuration files. Frontend diffs are restricted to the documented identity/artwork tables and local icon allowlist.

Owner-authorized handoff: commit and push only this development branch and open a separate review PR against `release/arcy-search-ultimate-20261013`, whose tip is the approved baseline. Do not modify PR #17, merge, promote, change production configuration or deploy. No production deployment is part of this work.

## Exact changed-file inventory

Frontend **data tables only**:
- `search-upgrade.js` — issuer suggestions and artwork map; no interaction/design changes.
- `search/index.html` — artwork map and local-image allowlist only; no HTML/CSS/layout/chart changes.

Search adapters:
- `search/server/lib/arc-adapter.js`
- `search/server/lib/control.js`
- `search/server/lib/discover.js`
- `search/server/lib/eth.js`
- `search/server/lib/holders.js`
- `search/server/lib/report.js`
- `search/server/lib/robinhood-adapter.js`
- `search/server/lib/robinhood-assets.js`
- `search/server/lib/search-logo.js`
- `search/server/lib/token-identity.js`
- `search/server/lib/runtime-evidence.js` (new)
- `search/server/lib/source-request.js` (new)

Artwork/provenance:
- `search/assets/token-icons/aave.svg` (new, unmodified upstream CC0 artwork)
- `search/assets/token-icons/grt.svg` (new, unmodified upstream CC0 artwork)
- `search/assets/token-icons/search-logo-provenance.json` (new)

Validation/documentation:
- `test/search-browser-e2e.cjs` — align stale chart expectation with the approved RH iframe; production chart unchanged.
- `test/search-data-optimization.test.js` (new)
- `test/search-data-live.cjs` (new)
- `docs/SEARCH_DATA_OPTIMIZATION_AUDIT.md` (new)
