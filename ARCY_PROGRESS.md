# ARCY progress — 27 October 2026

## Saved development state
- Branch: data/verified-mechanics-three-chain-pulse-20261026.
- Validated implementation commit: a3669c2ad8db5ffc6538d830440c367703024b1b.
- Production is not a release target for this push. No merge or deployment is authorized.
- Existing Draft PRs, including V8 mobile follow-up #57, remain intact; none of the open PRs currently targets this unpublished data branch.

## Completed
- Contract & Mechanics: reviewed full-source profiles, initialized mint guards, legacy implementation/admin resolution and sanitized unresolved diagnostics. Paired same-block nine-token evidence availability: Taxes 7/9 -> 8/9; Mint 8/9 -> 8/9; Owner 9/9 -> 9/9; Architecture 9/9 -> 9/9. Transfer-only evidence is not full buy/sell tax verification.
- Supply: strict exact-contract source-reported Today/7D/30D unlock windows, exact decimal arithmetic and duplicate/conflict rejection. No inferred circulating supply or invented unlocks.
- Ethereum/Robinhood Pulse: independent durable signed weekly editions, authenticated generation, archives, technical failure preservation and truthful quiet weeks. Arc default behavior preserved. One combined frontend request; no design changes.
- Holder is excluded. Unreleased Holder edits were removed in b6fd43b. A shared gateway contains only a Pulse route delegate, guarded by a frozen-scope test. No Holder indexing, source, snapshot or UI changes are pending.
- V8 mobile compaction, layout and other website sections are preserved.

## Verification already completed — do not repeat unnecessarily
- Focused automated tests: 48/48 PASS.
- Pulse desktop 1440 and mobile 390 integration: PASS; keyboard, reduced motion, no overflow, original Arc content/styles and one request verified.
- Real nine-token RPC/source audit: Arc ARCY/TOLLY/cirBTC, Ethereum USDT/USDC/ONDO, Robinhood TSLA/LINK/PONS.
- Supporting supply context: Total Supply 9/9; Burn Address Balance 9/9; Circulating 0/9; Next Unlock 0/9. These are not claims about legacy primary-row visibility.
- Official Ethereum source families 2/2 checked: one Hoodi development corroborated by two sources, not two separate stories. Robinhood source families 2/2 checked: quiet week for the reviewed interval.
- Real-source local signed generation, separate-process public-key reload and provider-failure preservation passed. Final topic deduplication was separately validated.
- Historical full regression baseline had 14 failures; prior candidate retained the same failure names. Full regression is NOT claimed green. No new full-suite run is justified by this documentation-only push.

## Remaining blockers
1. Supply primary rows currently use lockedSupply/unlockedSupply/verifiedBurned/nextUnlock. Requested Total/Circulating/Burn/Next primary-row mapping requires the pending owner choice; schema/UI remain unchanged.
2. Circulation provider remains disabled by existing commercial-use policy. No restricted provider activated.
3. Exact-contract future unlock dates/amounts are unavailable in tested permitted sources. CoinBell lacks contract identity; ONDO emissions endpoint requires paid access (HTTP 402); issuer allocation docs do not establish an exact next event. Unknown remains NOT VERIFIED.
4. New Ethereum/Robinhood Pulse routes require an approved compatible worker/API rollout. They are locally verified, NOT production-operational. Existing production services remain unchanged.
5. Historical 14 full-suite failures remain separately documented; unrelated fixes are outside current scope.

## Next steps
- Push this progress record and all completed implementation commits to the current development branch without modifying existing PRs.
- Continue only missing real-source verification; retain exact-chain/contract provenance and distinguish source restrictions from application errors.
- Await primary Supply-row choice and separate production authorization. Next weekly review schedule is Monday 2 November 2026 06:00 UTC.

Detailed evidence: docs/SEARCH_PRIORITY_DATA_20261027.md. Older docs/SEARCH_DATA_RESUME_20261027.md includes historical, now-excluded Holder experiments and is not the current scope.

## Post-push read-only verification
- Official live collectors: Ethereum 615 ms, 2/2 source families checked, one corroborated development; Robinhood 974 ms, 2/2 checked, quiet_week. Review clock explicitly 27 October 2026; next run 2 November 06:00 UTC.
- New pinned-block on-chain supporting supply reads succeeded without calling Holder: ARCY block 0x1abbc56 (444 ms), Ethereum USDT block 0x190ff0d (577 ms), Robinhood TSLA block 0x5e2b73e (1093 ms).
- Raw supply / decimals / dead-address balance: ARCY 1000000000000000000000000000 / 18 / 26952979843703698452942720; USDT 88301265725970534 / 6 / 26992832786; TSLA 10959986260000000000000 / 18 / 86051206085377017. Zero-address balances were checked at each same pinned block separately. None is circulating or scheduled unlock evidence.
- An initial standalone Robinhood probe used an incorrect hostname and failed; corrected to the existing configured official rpc.mainnet.chain.robinhood.com endpoint and verified chain ID 4663. No application configuration was changed.
- Mechanics paired nine-token results remain 8/9 tax-row evidence, 8/9 mint, 9/9 owner, 9/9 architecture. No redundant full re-audit or code changes in this follow-up.
- No existing Draft PR was overwritten, no PR merged and no production rollout performed. Completed code and these audit notes are saved on the development branch.


## Release update — 27 October 2026, V8 Supply primary evidence
- Production Vercel deployment READY: dpl_E9EU5ZvAFpa7DZkGs4ahgTLaPJvE; www.arcyusdc.xyz pointed to tested commit b7e060edb1b2f2ec258a241c72a64751bb5efe7e.
- Branch fix/supply-primary-evidence-20261027; Draft PR #59; main had not been merged as of this note.
- Search supply primary metrics now totalSupply / circulatingSupply / burnAddressBalance / nextUnlock (20 metrics across five original cards preserved). On-chain total supply and current zero/dead custody were already sourced with pinned evidence and are now visible in the main card, not misrepresented as lifetime burns. Existing quick facts remain intact.
- Holder and V8 visual structure were unchanged. Contract/Mechanics verified-source enrichments and Pulse three-chain candidate are included in production web code.
- GitHub Actions node unit/regression result: 516/530 PASS, 14 historical failures, zero additional failures from changed Supply metrics; source-completeness fixture was updated.
- Vercel deployment READY and domain alias confirmed; this is not proof of live per-token on-chain API coverage or user-browser acceptance. Full browser/e2e verification remains outstanding.
- IMPORTANT: Ethereum/Robinhood Pulse's signed weekly publisher depends on a separately updated persistent worker/API service. Vercel deployment alone does NOT activate the new worker routes. Do not claim weekly live generation is working until worker health/audit, signing, archiving and current editions are tested.
- Circulating supply remains permission-blocked; exact-contract next unlock schedules remain unverifiable for tested token sample. Do not synthesize numbers, bypass commercial licenses, or conflate dead address custody with actual burns.
- Next work: verify live Search responses for representative nine contracts (before/after actual DATA_FOUND, not synthetic); finish authorized Pulse worker rollout with end-to-end signed publications; investigate lawful circulation and exact token-matched schedule sources.


## Verified ARCY Mechanics repair and Ethereum/Robinhood Pulse — 27 Oct 2026
- Corrected ARCY launch-hook tax evidence loss in Search. Existing /api/mechanics already independently showed Buy 3%, Sell 3%, Transfer 0% with bytecode-reviewed V4 launch hook proof. A narrower token-transfer-only source scan had replaced this fact. Search now retains source-scoped rates when exact contract, Arc chain 5042, compiler-reviewed portal/hook digest, identical hook for all three components and near observed block are proved; differing blocks are explicitly HISTORICAL_ONCHAIN_VERIFIED and show source block, never falsely pinned. Unknown values remain unknown.
- Live verified www.arcyusdc.xyz AFTER deployment dpl_2Kw5yyXaNHdEPEwMTSqTRtZ6igig from commit 155086b5ffaae638db1b8983de5d6c1925ad3901. Public GitHub Actions workflow audit run 40416838501 rerun job 121901827772: ARCY Search "Buy 3% · Sell 3% · Transfer 0%", Mechanics 4/4, Original Mechanics API 3/3/0 with reviewed hook evidence. Nine-token Mechanics DATA_FOUND counts: ARCY 4, TOLLY 4, cirBTC 4; ETH USDT 4, USDC 4, ONDO 4; Robinhood LINK 2, TSLA 4, PONS 4 (34/36). DATA_FOUND is not a universal security certification.
- Direct official-source weekly reviews now supply a bounded, 10-minute-cached fallback when the independent signed Pulse worker is unavailable. Production live: Ethereum updated, 1 first-party development, 2/2 official source families checked; Robinhood quiet_week, 0 qualifying developments, 2/2 checked. These are DIRECT_OFFICIAL_SOURCES, NOT signed or archived editions. Historical quiet week is not broken and no news was fabricated. Existing Arc Pulse unchanged.
- GitHub regression before final production: 535 total, 521 pass, 14 pre-existing historical failures; zero new failures. Browser-specific live device checks and the separately hosted durable signed worker rollout are not claimed complete. Holder & Whale, V8, Hero, Burn, Swap, Unlocks unmodified by this repair.
- Branch fix/arcy-mechanics-threechain-pulse-evidence-20261027 PR #60, including standalone read-only nine-token + Pulse Github Actions audit script. Production domain currently attached to tested deployment at that SHA; main branch merge to be done after final review.
- Future improvements: authorized separate signed worker rollout and durable network archives, additional authentic Robinhood/ETH first-party sources, and lawful circulation/unlock evidence. Never conflate token transfer %, launch-hook fees, LP fees or dead-address custody.


## Follow-up ARCY hook evidence stability hotfix — 27 Oct 2026
- Root cause: valid reviewed Argus V4 hook fee readings (buy/sell) and separate ERC-20 token transfer fee readings were stored in separate evidence elements. Earlier recovery validator incorrectly demanded one combined evidence item and rejected the valid 3/3/0. Rectified with strict bytecode-reviewed same-hook proof for BOTH buy/sell and separately bound exact-token/current-block V4 source proof for transfer 0.
- Read-only recovery restricted to canonical Arc ARCY contract. Unknown or unsigned rates are never synthesized. Original evidence observed at a different nearby block is explicitly historical, not re-pinned to current block. Escalated read budget remains finite (15s).
- Live production verified after deploying commit c70e4924df7cb210dc1e272b9e6f8ca3aed99d84, Vercel dpl_FGZuHxHLcwGRx6uXxCUVgvEstyh2 (READY).
- GitHub public live audit action run 40419191438, jobs 121909722001 and 121910130221 both independently confirmed ARCY Search tradingTaxes 'Buy 3% · Sell 3% · Transfer 0%', 4/4 Mechanics, corroborating original Mechanics buy3/sell3/transfer0 and independent recovery proof ok=true. Source and observed block preserved.
- ETH Pulse: official-source review status updated, 1 verified development, two source families checked; Robinhood: truthful quiet_week, 2 sources checked, zero qualifying new developments. These are source reviews, NOT the yet-uninstalled signed durable Robinhood/Ethereum publisher.
- Focused/new tests passed. Existing 14 full-suite historical failures remain; one earlier CI run had an additional unrelated intermittent worker scheduling failure, which was not reproduced on follow-up. No Holder, V8, Hero/Burn, unlock or unrelated visual changes.
- The script scripts/audit-live-contract-pulse.cjs provides read-only repeated live source coverage. User wishes continued truthful source coverage, not fake values.

## Two-card deep evidence checkpoint — 27 October 2026
- New branch data/v8-two-card-evidence-20261027 starts at current production adeddc74ac752b4cbf20ca98fd7e21eeddf850c2 (READY dpl_F1xFqHY2Se7oVNin9MrsNHbvqtsS). Previous pushed62d65dd remains intact.
- Real API Mechanics33/36 ->34/36; TOLLY3/4 ->4/4 with reviewed pad/setPool. ARCY3/3/0 retained; TOLLY/cirBTC transfer0 only, not unproved buy/sell0. Supply18/36 unchanged; circulation/unlock evidence unavailable. Exact nine contracts and provenance in docs/V8_TWO_CARD_EVIDENCE_AUDIT_20261027.md.
- Focused44/44 PASS. Full524/538 PASS,14 historical failures identical to production baseline521/535; not a green full suite. Browser23 captured-real-response scenarios PASS at seven widths. No Holder/UI/Pulse/other card changes.
- Final local aggregate report mean6896ms/worst13173ms versus production4686ms/10793ms; different host/network, no speedup claim. Exact same-block Mechanics check also passed.
- Next: push candidate and verify separate Preview real API/browser, repeated ARCY source evidence. Production unchanged. Preview creation was rejected by automatic approval review in a combined command; split push from deployment and re-evaluate against the current attached instruction's explicit Preview authorization. Do not bypass restrictions.
- Vercel CLI added local ignore protections and created a temporary OIDC env file when linking the existing project. Generated env file removed without reading/logging values. Security review rejected reverting the added ignore rules; keep them locally but EXCLUDE .gitignore from this task commit. No credentials committed.

## Final local checkpoint / release blocked
- Draft PR https://github.com/arcycoin-glitch/arcy-website/pull/62 . Validated implementation pushed SHA1ff78c255ae2452b9f1b02ccea27c4e8e7ff7a66; branch data/v8-two-card-evidence-20261027.
- Three sequential live production ARCY Search/original Mechanics comparisons all returned Buy3/Sell3/Transfer0. Search/original blocks:0x1ace790/0x1ace79d;0x1ace7ac/0x1ace7b9;0x1ace7c7/0x1ace7d6. Sequential comparison includes two endpoints, durations14851/13791/14982ms; not single Mechanics-card latency. Candidate exact-block enrichment and normalized local API also preserve3/3/0.
- Final local real API nine-token results Mechanics34/36, Supply18/36. Local aggregate mean6896ms, worst13173ms; no speedup claim versus remote production4686/10793ms. Final44 focused tests PASS; full524/538, same14 historical failures; browser23 scenarios PASS at seven widths using captured real responses.
- Preview creation explicitly rejected by automatic approval review, including a separate Preview-only retry citing the current attachment. Review did not accept attachment text as deployment authorization. Direct owner Preview approval requested asynchronously. DO NOT bypass via another deployment mechanism, promote, merge or deploy production while blocked.
- Production remains baseline adeddc7; no production improvement claimed. Next unfinished action after explicit Preview authorization: create isolated Preview, verify real nine-token APIs/browser and immutable source scope, evaluate conditional production release gate. If not approved, keep PR62 in draft.
- Only local .gitignore CLI-added protection lines remain uncommitted, deliberately excluded. No .env.local exists. No Holder, worker, Pulse, UI/design, schema or other card changes included. Temporary logs/source fixtures remain outside repository in .runtime/two-card-20261027.

## Preview approval and completed live acceptance — 27 October 2026
- Direct owner approval supersedes earlier Preview-only block. Exact approved/deployed code SHA1ff78c255ae2452b9f1b02ccea27c4e8e7ff7a66, READY Preview https://arcy-official-ii4ligzsm-arcy3.vercel.app (dpl_JBmihWU5LUjTnK33yFMq3GHb7LRR). No production permission granted; no merge/promotion performed.
- Actual live Preview desktop/mobile18/18 across the original nine exact contracts PASS. Seven widths PASS; Previous/Next/keyboard, source details, four direct scoped rows, five cards/twenty total fields, no text clipping/overflow/runtime errors. No API mocks. Initial streaming capture harness failures were corrected via read-only render observation, then only incomplete scenarios repeated.
- Mechanics source-backed33/36 ->34/36; policy-complete26/36 ->27/36. TOLLY3/4 ->4/4 sourced, but tax remains transfer-only; UI correctly says3/4 complete. Supply18/36 unchanged, with circulating and next unlock0/9 each. LINK tax/mint remain SOURCE_CODE_UNAVAILABLE. No inflated full-tax or security verification claim.
- Exact-block independent RPC crosscheck9/9 PASS for total/decimals/zero+dead balances. ARCY Preview Search and original Mechanics confirm3%/3%/0%; desktop/mobile preserved the same result. V8/UI/Holder/Pulse/other-card source diff unchanged.
- Exact deployed commit focused44/44 PASS. Full regression remains524/538, same14 inherited failures as baseline521/535; no new failure names. Browser timing desktop mean5134ms/worst12082ms, mobile5111ms/11859ms includes render/evidence work, not API-only speed comparison.
- Public evidence saved in docs/audits/V8_TWO_CARD_PREVIEW_1ff78c2_20261027.json and detailed audit doc. Latest pushed branch SHA before this report-only update:5f6f6f876ca695cb541f6741f5a42eb7e00e2057. Only docs/evidence records are changing after the tested code; do not redeploy a different SHA without approval.
- Production remains unchanged READY at adeddc74ac752b4cbf20ca98fd7e21eeddf850c2, dpl_F1xFqHY2Se7oVNin9MrsNHbvqtsS. Next unfinished action is owner review of Draft PR62 and these real Preview results; await separate production authorization. Existing local .gitignore protection additions remain uncommitted/excluded, no .env.local exists, no credentials stored in audit.


## 27 October 2026 — Issuer-disclosed Ethereum ONDO wallet evidence
- PR62 merged to main, merge commit 9cd2d9d64f9f55b697ac8ea2aca10311f3869e34, Vercel Production READY and www.arcyusdc.xyz routed there. Focused 44/44, actual production nine-token Mechanics 34/36 vs prior 33/36; Supply remained 18/36, no invented circulation/unlock dates. ARCY reviewed V4 tax 3/3/0 retained.
- New source-only Supply enrichment branch data/issuer-disclosed-supply-context-20261027, PR63. Adds an independently issuer-disclosed ONDO custody wallet (Ethereum contract 0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3, issuer-identified wallet 0x677fd4ed8ae623f2f625deb2d64f2070e46ca1a1) with a pinned Ethereum balanceOf() query and issuer disclosure https://blog.ondo.foundation/ondo-foundation-group-wallet-address-disclosure/ . Disclosure last updated 26 Aug 2026; present on-chain balance is NOT circulating supply or verified currently locked supply.
- Preview deployment dpl_DLUXCKZNZmHcxcqXaEzALPQuXadq READY, https://arcy-official-9kv80bd59-arcy3.vercel.app . Verified authenticated Preview real API with Vercel connector at Ethereum block 0x1910c55: ONDO token supplies new supplementalEvidence with 5,179,207,574.161644239393946019 token units and official source URL, plus two clear researchNotes. Wrong contract USDC Preview report contains no ONDO supplementalEvidence. Four primary Supply fields unchanged. Browser UI adds only source link in expandable evidence panel.
- Initial isolated Preview audit from public GitHub Actions failed HTTP401 due Vercel authentication, not an API behavior failure. Replaced unsafe unauthenticated CI check with strict unit/card-format isolation tests. Authenticated live acceptance via connected Vercel fetch completed; no deployment protection changed or bypass token stored.
- Latest full suite 530/544 pass, 14 same historical failures, no new failures; dedicated source-isolation workflow passed. No Holder, market, Pulse, Mechanics, Hero, videos or mobile layout changes.
- Continuing priorities: add issuer-authorized contract-exact circulation sources, discover future exact-contract vesting schedules with source/UTC time/amount. Public Tokenomist/DefiLlama ONDO estimates disagree on exact unlock UTC date (17 vs 18 Jan 2027) and event amounts: do not publish a fabricated timestamp. CoinGecko circulation commercial-use license remains unapproved. Robinhood LINK source gap still unresolved.

## Maximum recovery stage — 27 October 2026
- Current main/production baseline d7cb0d0a6fce0539d7764f2ae5117a636208d4f3 READY(dpl_Ht9a2L7AfKZVtcM15dmdYL1safBB). New dedicated branch data/v8-maximum-evidence-20261027. Prior Mechanics/ONDO issuer custody and all V8/Holder work preserved.
- Implemented exact Ethereum USDT issuer accounting adapter with raw/formatted agreement, pinned totalSupply reconciliation, six-decimal BigInt math, publication-age controls, bounded/coalesced requests and sanitized failures. Pure live research produced85,398,671,670.897709, issuer-as-of25Oct23:30:03UTC; NOT counted as a delivered metric.
- Legal review found no verified written display permission. Adapter defaults CLOSED under TETHER_TRANSPARENCY_DISPLAY_APPROVED; no provider/env enabled. Owner permission clarification pending. Public access does not imply commercial reuse. Source-backed coverage remains Mechanics34/36, Supply18/36, circulation0/9; no manufactured unlocks.
- Focused52/52 PASS; full537/551 PASS, same14 historical errors as documented main530/544. Real nine-token local browser/API preservation checks underway, no API mocks. No new Preview/production deployment because actual permitted coverage has not improved yet. Exact source paths and remaining blockers in docs/V8_MAXIMUM_RECOVERY_20261027.md.
- Latest pushed prior task SHAe61149bf835a6e057560b220febd065b213f8dec; this branch stage will be pushed now. Next unfinished action: finish live browser results, then source-permission decision. Do not repeat failed403/404, global-to-chain misattribution or conflicting ONDO calendars.

## Completed maximum-recovery default-closed acceptance
- Latest validated implementation pushed6c157839362ac03837c58b317b1e6868ed29baea on data/v8-maximum-evidence-20261027. Subsequent update only saves audit/progress.
- Actual real-source local browser/API18/18 PASS (nine contracts at1440/390), seven responsive widthsPASS, no API mocks. BOTH viewports retain Mechanics34/36 and Supply18/36; ARCY3/3/0 and ONDO issuer custody observation unchanged. Public exact-token results saved in docs/audits/V8_MAX_RECOVERY_DEFAULT_CLOSED_20261027.json.
- New Tether source remains permission-gated: no verified written public-display rights received. Pure research85.398671670b at issuer-as-of25Oct23:30:03UTC is NOT counted as delivered coverage. Circulation0/9, unlock0/9 remain truthful. LINK tax/mint source unavailable. Global Circle/LINK data not copied to exact-chain metrics; disputed ONDO dates not published.
- Focused52/52 PASS; full537/551,14 same historical failures, no new failure names. No Holder/UI/Mechanics/Pulse/Burn/Swap changes, no restricted sources enabled and no credentials/env modifications.
- No new manual Preview/production release: actual permitted coverage growth has not been established. Preserve tested development branch for source-permission review. Next unfinished action: obtain applicable written display-rights confirmation before source-enabled Preview and any claim of improved real-user coverage. Do not call this task fully completed or production-ready while that blocker persists.
