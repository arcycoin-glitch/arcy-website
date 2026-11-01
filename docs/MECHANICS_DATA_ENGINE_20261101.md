# Contract & Mechanics data engine — 2026-11-01

Scope: Mechanics backend only. No UI, card, label, layout, API-contract, Radar, Pulse, Unlocks, Swap, Holder/Railway or provider-budget change.
Changed runtime files: `search/server/lib/mechanics-deep.js` (inside `inspect`; `enrich` and `validateSource` are byte-identical, pinned by the approved-baseline test), new `oz-template.js`, new `oz-library-hashes.js`.
Tooling only (CI / operator): `scripts/bench-mechanics.cjs`, `scripts/probe-mechanics-gaps.cjs`, `scripts/collect-oz-hashes.cjs`, three read-only workflows.

## Method (why the numbers are comparable)
Public RPC/Sourcify answers differ from run to run (rate limits, `-32001`, 404/429). Two live runs of the *same* code differ by several fields, so a live before/after is noise.
The benchmark therefore **records every provider answer once** (BEFORE-LIVE, main, GoPlus disabled exactly like Production) and **replays the identical evidence** to BEFORE (main) and AFTER (branch):
same pinned block, same RPC/Sourcify bodies, same failures. Replay hit/miss is counted, so a replay miss would be an *additional request* made by the new code.
Determinism check: BEFORE-REPLAY equals BEFORE-LIVE field-for-field (1188/1188 hits, 0 misses).

Sample (52 contracts, same list for every run): 12 Arc, 10 Robinhood radar, 9 Pons radar (Robinhood subset), 21 Ethereum (12 well-known + 9 radar). Includes the three regression contracts (ARCY, POLL, PONS).

## Result — verified field coverage (evidence available, same evidence for both columns)
| Chain (n) | Taxes before→after | Mint | Owner/Admin | Architecture |
|---|---|---|---|---|
| Ethereum (21) | 7 → **13** | 7 → **13** | 13 → **17** | 18 → 18 |
| Arc (12) | 6 → 6 | 7 → 7 | 5 → 5 | 10 → 10 |
| Robinhood (10) | 3 → 3 | 3 → 3 | 4 → 4 | 10 → 10 |
| Pons (9) | 0 → 0 | 0 → 0 | 0 → 0 | 9 → 9 |
| **All (52)** | 16 → **22** | 17 → **23** | 22 → **26** | 47 → 47 |

* Six Ethereum contracts changed; **no contract got worse**, no value that was already DATA_FOUND changed.
* Requests: RPC 1114 → 1114, Sourcify 74 → 74, replay misses 0 → the new analysis adds **no API or RPC call**.
* CPU for the analysis over 52 contracts: 3480 ms → 3484 ms (replay, no network). Live latency (mean/contract) 1046 ms → 1035 ms is within run-to-run noise and is **not** claimed as a change.
* Provider failures (HTTP ≥400 incl. expected Sourcify 404 for unverified contracts): 65 → 65.
* Coverage is not accuracy. No accuracy percentage is claimed: there is no independent ground truth for these fields. One internal consistency check exists: POLL (`FIXED_SUPPLY_BURNABLE_LAUNCH`, manually reviewed digest) is also accepted by the generic analysis and both give the same tax/mint conclusion.
* The live (unpaired) AFTER run shows how noisy single runs are: Arc taxes 3 vs 6 on the same code. Use only the replay pair for comparison.

## Why values stay NOT VERIFIED (the 30 contracts without a Taxes fact after this change)
| Cause | Contracts | Meaning |
|---|---|---|
| No verified source anywhere (Sourcify 404 for the contract and its implementation; Blockscout 403 from CI) | 17 | Pons ×9, Arc ×5, Robinhood ×3. No legal source of code → nothing can be proven. Selectors alone are never used. |
| Verified source, not built on the pinned OpenZeppelin ERC20 | 10 | Classic/custom templates (Tether, WETH, LINK, UNI, SHIB, PEPE…). Need a per-source reviewed profile (existing digest mechanism). |
| Verified, own code uses assembly | 2 | Uniswap-v4/clone style launch tokens. |
| Verified, own code overrides `_transfer` | 1 | Custom transfer path → no claim. |

Provider failures (RPC rate limit, `-32001`) additionally flip individual live results from run to run; they are separate from "insufficient evidence" and are recorded in `analysisDiagnostics.failures`.

## What changed
`oz-template.js` — deterministic source-structure analysis for tokens built on **unmodified OpenZeppelin ERC20** libraries:
* A library file counts only if its SHA-256 is pinned (`oz-library-hashes.js`, computed in CI from the published `@openzeppelin/contracts` 4.x/5.x tarballs; 296 digests, 40 library files). Names, paths, tickers and addresses are never used.
* Preconditions (all must hold or **no claim** is made): runtime/source already matched to the pinned block by Sourcify + independent `eth_getCode`; target not delegating; no assembly/delegatecall/selfdestruct in own code; no override of transfer/balance/supply/approve paths; no shadowing of library contract names; deployed contract inherits the pinned ERC20.
* Mint: all `_mint` calls in the constructor → "NONE DETECTED ✓"; all in `onlyOwner` functions → "Owner-authorized mint" (owner read at the pinned block; zero owner → "NONE ACTIVE · owner renounced"); all in `onlyRole` functions → "Role-gated mint" (holders not enumerated); anything else (ungated, helper, direct `_update`) → unresolved.
* An **ungated function that can change ownership or roles** (`_transferOwnership`, `_grantRole`…) invalidates every gate-based conclusion (found and fixed during development; covered by tests).
* Tax: always "Transfer 0% · DEX/hook fees NOT VERIFIED", `coverage: TOKEN_TRANSFER_ONLY`, `mutable:false`. Pool/router/hook fees stay separate and NOT VERIFIED. Burnable ≠ burned ≠ buyback (recorded only as a capability observation).
* Owner/admin: owner-gated function names listed from source; "Ownership renounced" only when `owner()` is zero **and** no un-analysed ungated function was found (otherwise the scope says so); "No token owner/admin" only when the source adds no state-changing function beyond the library surface.
* Reviewed digest profiles keep priority; an existing stronger fact is never replaced (`enrich` untouched).
* A source/ABI-matched `owner()` returning zero is recorded only as a diagnostic observation (project policy test "ABI zero owner cannot establish absence of all privileges" is unchanged).

Evidence class in the API stays `SINGLE_SOURCE` for source-structure facts (`VERIFIED_SOURCE`) and `ON_CHAIN_VERIFIED` only where pinned state was read (`VERIFIED_SOURCE_AND_STATE`), exactly like the existing reviewed profiles.

## Remaining limitations / next steps
1. Pons (and ~⅓ of new Robinhood/Arc tokens) have no verified source. Highest-impact next step: a legally permitted verified-source provider reachable from the Production runtime (Blockscout returns 403 from CI; Production reachability was not tested here) or Sourcify verification by the token deployers/factory. Bytecode selectors must not be used as a substitute.
2. Classic non-OpenZeppelin templates need per-digest reviewed profiles; the diagnostics (`diagnose`) now name the exact reason per contract.
3. Legacy ZeppelinOS-style proxies (3 Ethereum samples) remain `ARCHITECTURE_NOT_VERIFIED`: binding needs pinned `zos-lib` proxy hashes (not collected).
4. Public Ethereum RPC occasionally returns `-32001` for `eth_getCode` at the pinned block (token inspection, shared code, left unchanged).
5. Pre-existing test `shared per-minute gate and provider cooldown (real redis)` (Radar, not Mechanics) is timing-sensitive when `redis-server` is installed locally; it fails identically with these changes stashed and is skipped where Redis is absent (CI).
