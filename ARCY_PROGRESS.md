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
