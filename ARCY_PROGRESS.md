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
