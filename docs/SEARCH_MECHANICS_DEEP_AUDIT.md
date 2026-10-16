# Search Mechanics deep audit — 2026-10-16

## Source and scope

Development starts at the verified production commit **4c9faae3924af756dd468dbdfbc12bed2084c556**, branch `feat/autorefresh-search-reliability-20261015`. New branch: `data/search-mechanics-deep`. The older approved visual commit `76c857acdb71c6e3b143cb3c09ebe426bd633605` is not used to overwrite the newer production source.

PR #25 (`dcde9c26db227369e4ef6cc7d2d7b2d5a0db7243`) was reviewed, not merged. Its bounded source reader and strict ABI address-padding checks are selectively reused. Its logo, holder, market/discovery, UI catalog and other changes are deliberately excluded. Its conservative runtime method is already implemented by the unchanged shared `lib/mechanics-runtime.js`; it is reused, not rewritten.

No UI/HTML/CSS, schema, five-card/twenty-metric layout, navigation, homepage, holder worker/storage/RPC, endpoint handlers, Unlocks, Pulse, Burn, Swap, Research, provider permission flags, environment or deployment configuration changes. Four field identifiers remain `tradingTaxes`, `mintCapability`, `ownerAdmin`, `contractArchitecture`.

## Findings and engineering changes

1. Ethereum Mechanics previously relied on security-provider output and shallow getters. It did not use exact source/ABI evidence, legacy proxy targets or conservative runtime proofs. Robinhood exposed a DELEGATECALL opcode observation as a source-backed architecture row without resolving the target. Arc already had a mature reviewed-source/hook bridge; that engine is preserved.
2. Shared Mechanics enrichment now reads full runtime, canonical EIP-1967 implementation/admin/beacon slots, legacy ZeppelinOS implementation/admin slots, exact EIP-1167 targets and implementation bytecode at the report's pinned block. UUPS UUID is an explicitly labelled implementation getter observation, not an assertion about upgrade authorization. A slot on a nondelegating runtime is not treated as a proxy.
3. Conservative non-proxy analysis retains metadata, respects PUSH payloads and treats all JUMPDESTs as potential entries. Unsupported EOF/truncated runtimes fail closed. This establishes outer-runtime delegation limits, not absence of all external forwarding/control. Diamond-shaped loupe output is retained only as a candidate observation; unproven selector routing is NOT VERIFIED.
4. Source lookup is exact chain + full contract. Sourcify runtime match/ABI/source response must match an independent `eth_getCode` read byte-for-byte at the pinned block. Source failures never become evidence. This relies on Sourcify's verification attestation plus RPC, not a local Solidity recompile or independent state proof.
5. Unknown delegating runtimes cannot borrow a target's reviewed tax/mint semantics merely because a storage slot contains its address. Implementation semantics require an exact clone or reviewed outer proxy binding. For the reviewed OZ immutable BeaconProxy, the bytecode's immutable beacon address is read using source artifact offsets. It outranks a stale writable beacon slot. Targets must contain deployed bytecode.
6. ABI-only mint/fee/blacklist/whitelist/bridge/upgrade names remain `INTERFACE_ONLY` candidates. Read-only owner, authority, masterMinter, paused, raw fee/cap getters and bounded AccessControl role/member/admin checks are recorded as getter evidence. They do not establish effective fee units, absence of alternative privileges, all role members, or callable mint execution. Zero owner never establishes universal renouncement. Source-matched authority delay/threshold/owner getters remain observations, not automatic Safe/timelock classification.
7. Reviewed full-source fingerprints establish specific transfer and mint semantics. Current fee parameters, minter, cap/timestamp, master minter and registry are read where the reviewed method requires state. No contract-address or ticker allowlist chooses an analysis result. A changed source bundle does not match the reviewed profile and cannot inherit its conclusions.
8. Arc's existing buy/sell evidence is preserved. Already-established transfer tax now reaches the same combined row; absent/invalid transfer evidence explicitly says `Transfer NOT VERIFIED`. Existing V4/hook analysis is not replaced with token-only zero-tax guesses.

## Evidence hierarchy and limits

| Evidence class | What it establishes | What it does not establish |
|---|---|---|
| `ON_CHAIN` | Pinned runtime/slot/implementation observation; conservative outer-runtime proof | Complete admin model, future governance, every external forwarding behavior |
| `GETTER_REPORTED` | Exact ABI/source-matched or explicitly labelled getter/role observation | Verified effect of a selector name, complete role census, absence of permissions |
| `VERIFIED_SOURCE` | Reviewed source bundle, Sourcify runtime attestation and pinned bytecode match | Current complete member lists or executable privileged transaction |
| `VERIFIED_SOURCE_AND_STATE` | Reviewed semantics plus required pinned current getter values | Successful mint/trade simulation or all DEX/hook fees |
| Existing Arc `SOURCE_REPORTED` / reviewed absence | Previously working reviewed source/hook bridge retained with provenance | New independent verification beyond that inherited method |
| `NOT_VERIFIED` | Missing, unsupported, failed or insufficient evidence | Zero fee, no mint, no owner, non-proxy |

The six new transfer-fee observations are **TOKEN_TRANSFER_ONLY**. Their values explicitly say `Transfer 0% · DEX/hook fees NOT VERIFIED`. They are useful source-backed observations in the existing row, **not six newly verified buy/sell tax results**. No unlicensed simulation/security API was enabled or requested for this work.

## Reviewed source profiles

Only SHA-256 of the canonical full `(path, content)` source bundle selects these profiles, after exact chain/contract/runtime checks. No upstream Solidity source is copied into the application. Source URLs and retrieval timestamps are retained in evidence.

| Source digest | Reviewed behavior | Required state / limitations |
|---|---|---|
| `9799263b22d762e31d781b80bcf9efa38e24917e39a5d75c683ad04f80ce5965` | Capped legacy transfer fee, owner issue(), blacklist/pause/deprecation | `deprecated=false`, bps<20, max fee; fee=min(amount*bps/10000,maxFee). Owner can change params; rounding/cap affect effective fee. Active forwarding leaves tax unknown. |
| `292fad46b97e1b50bd191dfd857de081abfb199ad96ff02a055124da4a708cf2` | Full-value transfers, minter-only mint/setMinter, time and percentage cap | Current nonzero minter, mintCap, mintingAllowedAfter. Capability is not execution-now proof. |
| `3424b81acc01fc833b18f1e2341511fe1bffdd065376112ef979243834e13ba4` | Full-value transfer, ward-gated mint, rely/deny authority | Source-defined ward permissions; active ward list not claimed. |
| `5f75f27c6b98783b82c28164831948668e502ee20bd302aaaeff35c74dbda664` | Full-value transfer, configured minters/allowances, masterMinter, pause/blacklist | Reviewed proxy binding, exact implementation source and pinned masterMinter. No complete minter enumeration claimed. |
| `82f4da21cdb0464ca580be2847548393fa678d7e06310fc169d74663ede571fd` | Full-value base-unit transfers; registry MINTER_ROLE mint; blocking/pause; UI multiplier | Reviewed immutable beacon binding and deployed immutable access registry. Multiplier is not tax; current member list not claimed. |

Reviewed outer proxy source digests: legacy transparent `b49bec6077f927208196e052c2a55e5a37fe21fd8e9e1dc8e90f6f1116cf8c7e`; immutable beacon `922425867904c46fb129080ebcd685ba70e0afb5aaa9fdc47b5f9327cee41196`.

## Freshness, failures and request boundaries

- Existing adapters/providers remain in place. Only Mechanics calls enrichment; holder/market/supply/liquidity work does not call it.
- New RPC observations are pinned and deduplicated per inspection, at concurrency <=4 with a 14-second scheduling budget and 4-second per-read watchdog. No log history scan, transaction submission or background queue operation is added.
- Source responses are bounded to 4 MiB, cached for five minutes with original retrieval time, coalesced and capped at 32 entries. HTTP 429 temporarily cools the source origin; failed/malformed/mismatched responses are never cached as evidence. Cached source is always compared to newly read runtime before reuse.
- Current source/role state is not cached across token blocks. Source code caching does not make stale fee/minter state current.
- Robinhood public RPC was observed returning HTTP 200 / JSON-RPC -32000: `historical state ... is not available` for an older saved block while `latest` returned bytecode. The new path correctly withholds unverifiable observations; the previous code misleadingly continued showing its old runtime hint. This is a provider archive-retention limit, not a reason to present old state as current or to weaken verification.
- Existing Arc source bridge may carry its own pinned block. Those original evidence blocks are retained; they are not rewritten to pretend to be the outer report block. Every new source/implementation/state observation uses the saved token report block consistently.

## Reference methods

- [Sourcify lookup API](https://docs.sourcify.dev/blog/apiv2-lookup-endpoints/) — targeted contract lookups, no bulk scraping.
- [EIP-1967 slots](https://eips.ethereum.org/EIPS/eip-1967).
- [EIP-2535 Diamond loupe](https://eips.ethereum.org/EIPS/eip-2535) — interface observations are not routed execution proof.

## Release boundary

Review-only development commit and DRAFT PR. No production deployment, promotion, merge, PR #25 modification or production environment change is authorized/performed by this task.


## Measured before/after — real sources, 13 contracts

Production-source baseline is 4c9faae; comparison is the local development source, **not deployed production coverage**. For each token, token identity/block is fetched once and both versions run sequentially at that same freshly pinned block. Base-token loading is excluded from both timing columns. This avoids the Robinhood old-block pruning failure observed during repeated historical measurements. Original paired results and browser artifacts are outside the Git checkout; no generated snapshots/JSON/screenshots are committed.

Counts mean source-backed rows with an explicit useful result, preserving their evidence class. They do **not** turn getter/provider observations into complete cryptographic permission or trading proofs.

| Existing Mechanics row | Before | After | Qualification |
|---|---:|---:|---|
| Trading Taxes | 5/13 | 11/13 | Six additions are transfer-only evidence, not verified buy/sell rates |
| Mint Capability | 5/13 | 11/13 | Reviewed capability model; current membership/execution limits explicit |
| Owner / Admin | 8/13 | 12/13 | Getter or reviewed authority model, not universal privilege enumeration |
| Contract Architecture | 7/13 | 13/13 | Three old RH rows were weak opcode hints; now actual runtime/target evidence |

**Full buy/sell tax evidence remains 5/13 → 5/13.** Transfer evidence is now surfaced for those five Arc tokens and six newly reviewed implementations. All six new rows explicitly retain unknown DEX/hook fees. The goal is truthful additional information, not reporting 11/13 fully verified trading taxes.

| Network | Sample | Taxes row before → after | Mint | Owner/admin | Architecture |
|---|---:|---:|---:|---:|---:|
| arc | 6 | 5 → 5 | 5 → 5 | 5 → 5 | 4 → 6 |
| ethereum | 4 | 0 → 4 | 0 → 4 | 2 → 4 | 0 → 4 |
| robinhood | 3 | 0 → 2 | 0 → 2 | 1 → 3 | 3 → 3 |

### Exact test set and Mechanics-only latency

| Network / token | Exact contract | Shared report block | Before ms | After ms |
|---|---|---|---:|---:|
| arc / ARCY | `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | `0x190b78b` | 7781 | 8815 |
| arc / ARGUS | `0xece5ca8bf9220718e5727754026757512212cb3c` | `0x190b7ae` | 4801 | 5788 |
| arc / USDT-Arc | `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` | `0x190b7c2` | 3318 | 3128 |
| arc / UBI | `0x547dd73ce97c886f51e2d530e9b9ed2fd5844b56` | `0x190b7d1` | 7211 | 8147 |
| ethereum / USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` | `0x18fdb9c` | 397 | 1166 |
| ethereum / UNI | `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | `0x18fdb9d` | 250 | 775 |
| ethereum / DAI | `0x6b175474e89094c44da98b954eedeac495271d0f` | `0x18fdb9d` | 271 | 567 |
| ethereum / USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `0x18fdb9d` | 294 | 1543 |
| robinhood / AAPL | `0xaf3d76f1834a1d425780943c99ea8a608f8a93f9` | `0x55e775e` | 430 | 2675 |
| robinhood / TSLA | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | `0x55e7787` | 808 | 2475 |
| robinhood / LINK | `0x492641f648a4986844848e0befe66d14817bce34` | `0x55e77b7` | 416 | 1087 |
| arc / TOLLY | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | `0x190b81a` | 3274 | 3326 |
| arc / cirBTC | `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` | `0x190b828` | 4981 | 5936 |

Mean Mechanics-stage latency: **2,633 ms → 3,494 ms** (+861 ms). This is a data-depth upgrade, **not a speed improvement claim**. Source/implementation/permission reads add bounded work. Each process shares its normal per-source caches across the sequential set; provider latency is variable. Full browser scan times include unchanged other-card work and are measured separately. Arc's USDT-labelled token above is identified only by exact chain/contract and on-chain symbol; issuer identity is not asserted.

### Final four-row observations

| Network / token | Trading Taxes | Mint Capability | Owner / Admin | Contract Architecture |
|---|---|---|---|---|
| arc / ARCY | Buy 3% · Sell 3% · Transfer 0% | NOT DETECTED (existing reviewed source) | owner() getter: 0x9c07a97364e59afe744fdbe55951df929bd5d90e | EIP-1167 minimal proxy |
| arc / ARGUS | Buy 1% · Sell 1% · Transfer 0% | NOT DETECTED (existing reviewed source) | owner() getter: 0x7d613c6316ede9d257f3bf512777cb4ea4a6bee4 | EIP-1167 minimal proxy |
| arc / USDT-Arc | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NON-PROXY · runtime verified |
| arc / UBI | Buy 0% · Sell 0.01% · Transfer 0% | NOT DETECTED (existing reviewed source) | owner() getter: 0xfb0885bc62eb7147fa4d29f710864b83de35c5d1 | EIP-1167 minimal proxy |
| ethereum / USDT | Transfer 0% · DEX/hook fees NOT VERIFIED | Owner-authorized issuance | owner() getter: 0xc6cde7c39eb2f0f0095f41570af89efc2c1ea828 | NON-PROXY · runtime verified |
| ethereum / UNI | Transfer 0% · DEX/hook fees NOT VERIFIED | Capped / time-gated minter | Minter authority: 0x1a9c8182c09f50c8318d769245bea52c32be35bc | NON-PROXY · runtime verified |
| ethereum / DAI | Transfer 0% · DEX/hook fees NOT VERIFIED | Ward-authorized mint | wards authorization | NON-PROXY · runtime verified |
| ethereum / USDC | Transfer 0% · DEX/hook fees NOT VERIFIED | Allowance-limited mint | owner() getter: 0xfcb19e6a322b27c06842a71e8c725399f049ae3a | Legacy implementation slot |
| robinhood / AAPL | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| robinhood / TSLA | Transfer 0% · DEX/hook fees NOT VERIFIED | Registry MINTER_ROLE mint | Access registry: 0xe10b6f6b275de231345c20d14ab812db62151b00 | Reviewed immutable beacon proxy |
| robinhood / LINK | NOT VERIFIED | NOT VERIFIED | owner() getter: 0xf09afe78d3c7d359b334d7cb88995751f7ec5e13 | NON-PROXY · runtime verified |
| arc / TOLLY | Buy 0% · Sell 0% · Transfer 0% | NOT DETECTED (existing reviewed source) | NOT DETECTED (existing reviewed source) | NON-PROXY · runtime verified |
| arc / cirBTC | Buy 0% · Sell 0% · Transfer 0% | Capability detected | owner() getter: 0xbc22a4c5f2c1cdb50e2f55dbf9b5f73417d2e6cf | Legacy implementation slot |

### Remaining limitations by exact contract

- Arc `0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a`: taxes, mint and owner/admin remain NOT VERIFIED. Sourcify returned no verified source for this identity; the pinned runtime can establish nondelegation, but missing owner/admin/source semantics cannot establish fee or mint absence.
- Robinhood `0x492641f648a4986844848e0befe66d14817bce34`: taxes and mint remain NOT VERIFIED. Sourcify returned 404; getter/bytecode facts establish an owner observation and conservative outer non-proxy evidence, not mint/fee execution semantics.
- Secondary source checks were also live: `https://explorer.arc.io/api/v2/smart-contracts/0x3b0d0f9825850d3ab1491253b86c4cc26ff1250a` returned HTTP 403 in 412 ms; `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/0x492641f648a4986844848e0befe66d14817bce34` returned HTTP 403 in 272 ms. HTML denial pages were not treated as verified ABI/source. No paid/restricted provider was enabled to mask these limits.
- Ethereum USDT/UNI/DAI/USDC and RH AAPL/TSLA: token transfer fees are reviewed, but DEX/hook trading execution fees are explicitly NOT VERIFIED. No authorized simulation source was configured/enabled. No pool/hook association is invented to fill this gap.
- Proxy observation does not prove every upgrade route, and reviewed implementation capability does not imply active role membership or successful mint execution. Nested unresolved delegation fails closed. Arbitrary ABI-only mint/fee names and Diamond loupe candidates remain evidence, not verified capability/architecture conclusions.
- Public RPC historical retention and rate limits can remove live proof availability. An old invalid runtime hint is not preserved as verified architecture merely to inflate coverage. No new cross-block state cache is introduced.

## Tests and preservation

- Untouched production-source baseline: **353/353 PASS**.
- Final full automated regression: **375/375 PASS**, zero failures/skips. Includes 22 added safety tests (identity/bytecode/ABI mismatches, dirty ABI padding, runtime control flow, empty/self implementation, clone/legacy/beacon binding, stale mutable beacon slot, fee cap/forwarding/429, immutable registry permissions, bounded roles, source precedence, timeouts, malformed source/cache rejection, Diamond candidate rejection, unknown transfer tax and exact network/block identity).
- Existing Search E2E: **PASS**, unchanged test flow at 320/390/768/1440px; all three networks, five cards/twenty metrics. Used installed Edge via a launcher wrapper because the bundled Playwright Chromium binary is not installed; no browser-test behavior or UI was changed for this environment.
- Existing general browser regression: **PASS**, current homepage-to-detail flow, 429/report failures, 320/390/1440px. Fixture evidence is not counted as real coverage.
- Legacy `test:live` is not a valid current Search acceptance command: it imports retired `api/control` and invokes unrelated legacy routes. It was not used to trigger out-of-scope holder/unlock work. The explicit real-source Mechanics browser test above validates the current API instead; no claim that this obsolete helper passes.
- Real-source Search API/browser: **PASS**, 13 desktop contracts and USDC/AAPL/TOLLY at 390×844. No mocked Search responses. All five cards/twenty slots, contract/network identity, accessible source/technical evidence and no document overflow checked, including expanded evidence JSON.
- Two existing Mechanics assertions were updated for explicit missing Transfer evidence; two old Robinhood runtime tests now provide actual deployed runtime instead of contradictory hints and require unknown delegation to remain unverified. Holder assertions in the same test files are unchanged.
- UI, CSS, schema, endpoint handlers, workers, holder storage/RPC and unrelated section files are unchanged against 4c9faae. Adapter diffs are confined to Mechanics and its address decoder; other card functions are unchanged. No CI result or production rollout is claimed.
- Stronger replacement fields retain the previous evidence entries and their original blocks; source precedence does not erase the audit trail.
- After evidence retention was finalized, targeted real-source USDC/AAPL/TOLLY desktop and 390×844 scans were repeated: PASS, including fully expanded evidence without document overflow. Production was read-only checked again: still READY at 4c9faae / `dpl_BHgy1QKpWRkco75f41rrGEo4ZMLY`.

## Changed files

- `search/server/lib/mechanics-deep.js` — new bounded evidence enrichment.
- `search/server/lib/source-request.js` — selectively reused PR #25 source reader, used only by Mechanics here.
- `search/server/lib/arc-adapter.js`, `report.js`, `robinhood-adapter.js` — Mechanics-only integration.
- `search/server/lib/control.js` — strict canonical address decoding.
- `search/server/lib/arc-legacy-evidence.js` — preserve explicit existing transfer-tax evidence in combined row.
- `test/search-mechanics-deep.test.js`, `test/search-mechanics-live.cjs` — negative/unit and explicit real-source browser validation.
- `test/search-hardening.test.js`, `test/search-arc-legacy-parity.test.js`, `test/search-arc-market-cap-sanity.test.js` — Mechanics fixture/assertion updates only.
- `docs/SEARCH_MECHANICS_DEEP_AUDIT.md` — this audit.
