# Corrected priority scope — 27 October 2026

Branch: data/verified-mechanics-three-chain-pulse-20261026. No merge, push or deployment in this continuation.

## Frozen work
- Holder & Whale is OUT OF SCOPE. Unreleased changes from dcb558e to large-holders.js and its test were explicitly removed by b6fd43b; the original commit remains recoverable. Holder analysis, worker loop, RPC, snapshots, publication logic, field identifiers, sources and UI match deployed06ee0bf.
- The shared HTTP gateway has exactly one new Pulse-only route delegate. Existing Holder routes and authorization are byte-for-byte unchanged after that line is removed; a focused scope guard verifies this. No Holder endpoints or jobs are invoked by the new Pulse collector.
- Current main security protections (ab5978b LICENSE/.gitignore) were merged without overwriting V8 mobile compaction, the approved first-frame poster, animations or other working sections.
- The older SEARCH_DATA_RESUME_20261027.md records the earlier interrupted audit. Its Holder-cache description is historical and is NOT part of the corrected release diff.

## 1. Unlock & Supply: completed and blocked
Current four primary IDs remain lockedSupply, unlockedSupply, verifiedBurned, nextUnlock. Owner clarification was requested because the new requested primary list is totalSupply, circulatingSupply, burnAddressBalance, nextUnlock. No primary-row rename or schema migration was made without that answer.

The existing exact-contract API already supplies on-chain total supply and zero/dead balance as supporting context. In the paired nine-token baseline: totalSupply 9/9, burnAddressBalance 9/9, circulatingSupply 0/9, nextUnlock 0/9. These are data-availability counts, not a claim that the current four legacy primary rows display them.

Added unlock-windows.js and strict tests. Only exact-chain/contract SOURCE_REPORTED dated events with positive decimal amounts and HTTPS provenance are eligible. Today/7D/30D are UTC calendar windows over **known published events**, not a complete global schedule. Exact decimal sums avoid floating-point estimates. Duplicate events are deduplicated; conflicting amounts are rejected. Empty coverage stays NOT VERIFIED, never zero. Existing nextUnlock evidence receives these optional source-scoped windows where a verified event exists. Transfers, dead-address balances, mint permission timestamps and burn functions are never unlock evidence.

Real source findings:
- CoinGecko circulation remains disabled by existing commercial-use rights policy. No provider or license flag was enabled. Source-reported market cap/price is not used to invent circulating supply.
- Existing CoinBell calendar responds HTTP200 but contains no contract addresses. Ticker matches cannot establish Search token identity.
- DefiLlama ONDO protocol metadata responds HTTP200 with the exact Ethereum contract, but its emissions endpoint responds HTTP402 (paid plan). It was not enabled or repeatedly queried.
- Official Ondo Foundation documentation confirms exact ONDO contract and allocation/lock conditions, but does not establish the requested future date/amount with sufficient precision. Secondary calendars disagree between17and18January2027. No next unlock was invented from that conflict.
- Reviewed Ethereum unlock registry currently contains no eligible events. Generic lock durations or token mint availability are not converted into scheduled events.

## 2. Three-chain Pulse
Arc's original collector, edition history, number rules and default API response remain unchanged. One existing homepage Pulse request can request an optional chain bundle; switching chains adds no requests. No CSS, layout, animation or card markup changes were made.

New Ethereum and Robinhood editions are separately numbered from publication week26October2026, stored in separate directories under the existing durable Pulse volume, Ed25519-signed with the existing publication key configuration, read through the existing authenticated infrastructure, and archived independently. Correct/missing/wrong auth, concurrency, idempotence, restart reload, storage failure rollback, signature/chain/archive mismatch and prior-edition preservation are covered by focused tests. No Redis or paid infrastructure is introduced.

Monday06:00UTC publishes the **completed previous Monday-to-Monday UTC review**. For the first issue published26October, the coverage is19–26October. Dates and review period remain explicit. A completed-week article is not marked as current-week/live news. Next scheduled review:2November2026at06:00UTC (09:00Europe/Istanbul).

Real collector results:
- Ethereum:2/2 official source families checked (Ethereum Foundation RSS and official Go Ethereum releases). Two artifacts corroborate ONE Hoodi activation-delay development. They are not counted as separate news. Older superseded client releases are excluded. The other category is source status; the unlock slot never presents generic protocol news as a token unlock.
- Robinhood Chain:2/2 official source families checked (official Crypto newsroom and chain connection documentation). Chain4663/public endpoint identity verified. No qualifying dated chain development in this review interval:quiet_week, not fabricated brokerage/Pons news.
- A local real-source end-to-end run completed authenticated generation/signing/archive reads in about1second, reloaded both issue#1publications in a separate process using only the public verification key, and preserved the prior signed Ethereum edition after a simulated provider failure. No production service was modified.
- Production automation is NOT deployed or claimed operational for these new feeds. The approved worker/API update will be needed after owner approval. Current deployed endpoints do not yet implement the new network routes.

## 3. Contract & Mechanics
The paired exact-contract/same-block nine-token audit improved available tax-row evidence7/9→8/9. Mint8/9, Owner/Admin9/9, Architecture9/9 remained available. This is not a full-tax or security-score claim: ARCY establishes Transfer0%only; buy/sell/hook fees remain NOT VERIFIED. cirBTC now has reviewed legacy implementation/admin binding and source-backed minter/burn/operational-role evidence. Token burn capability is not evidence a burn occurred; buyback execution/allocation is not inferred.

Source/RPC failures remain distinguishable, including in the final normalized API data: unresolved Mechanics fields carry sanitized analysisDiagnostics rather than losing all details when generic unverified evidence is stripped. Stronger existing displayed values are retained, with additional valid admin/source evidence kept in details. No token address hardcoding or verification weakening.

## Tests and release state
- Focused unit tests:48/48PASS (Pulse, Mechanics, unlock windows).
- Desktop1440/mobile390 Pulse integration:PASS; original Arc content/styles preserved, three panels/headings/TAKE/archive work, one combined request, keyboard/reduced-motion, no overflow/runtime errors.
- Actual official sources and pinned RPC were tested separately; synthetic UI fixtures are not counted as real data coverage.
- Prior full-suite comparison is historical: untouched06ee0bf had14failures; the earlier data candidate had the same14names. No extra full suite was run after the owner requested focused tests only. Full regression is NOT claimed green.
- No merge/deployment/provider activation/credential change. Supply primary-row choice remains pending; circulation and exact unlock gaps remain explicitly unverified.
