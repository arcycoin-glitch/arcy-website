# Search data continuation — 27 October 2026

## Scope and preserved work
Worktree: arcy-three-chain-data. Branch: data/verified-mechanics-three-chain-pulse-20261026. Base: deployed 06ee0bfab88c509a258cc03ec5227b46fee95f0c, which descends from latest origin/main 74e224c. Mobile card compaction and the approved Hero poster are retained without modification. No production operation is authorized by this data continuation.

Pending three-chain Pulse work from the interrupted request remains uncommitted in the same worktree. It is deliberately excluded from this Search-only change set; nothing was reset or discarded. Those source collectors/storage tests had 36 combined targeted passes, but Pulse UI/integration delivery was unfinished. Do not deploy those unreviewed files.

## Completed Search changes
- Complete source-digest profiles for the exact reviewed initialized reward-launch implementation and FiatTokenV2_2 implementation, with bytecode matching and pinned getters unchanged.
- A second reviewed legacy proxy source binds its real implementation and admin slots. New admin/upgrade evidence remains available even if an existing owner getter is kept as the displayed value.
- ARCY now establishes **token Transfer 0% only**. Buy/sell/DEX/hook fees remain unverified. A nonzero initialized portal is required before claiming no further mint entry point.
- FiatToken minter burn, pause/blacklist roles and proxy-upgrade scope are retained in technical evidence. Burn capability is not proof an operation occurred; dead-address balances are not supply-reducing burn proof.
- Unresolved fields retain source/RPC diagnostics rather than losing them.
- Ethereum holder candidate pages use the existing bounded successful-response cache: 15s, 32 exact URLs, concurrent reads coalesced. No balance or concentration cache was added. Every analysis still reads all candidate balances at its own pinned block.
- Explicit token/chain mismatch in holder responses fails closed. Candidate-source failure and pinned-RPC failure now have separate sanitized reasons/evidence. No partial census is promoted; existing source-ranked sample limitations remain.

## Real-source before/after
The nine before responses were captured from the live production Search API on 26 October UTC. After Mechanics analysis used live RPC at the **same stored block** and retained stronger existing evidence. This is a paired Mechanics comparison, not a claim that unrelated live providers were revalidated or that a source-ranked sample is a global census.

Token | Contract | Pinned block | Tax row | Mint | Owner/Admin | Architecture
--- | --- | --- | --- | --- | --- | ---
| arc / ARCY | `0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b` | `0x1ab56b8` | unknown → found | found → found | found → found | found → found |
| arc / cirBTC | `0x171a4217b86a807a64eb94757db6849fb4bdbaa0` | `0x1ab56b9` | found → found | found → found | found → found | found → found |
| arc / TOLLY | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | `0x1ab56ba` | found → found | found → found | found → found | found → found |
| ethereum / ONDO | `0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3` | `0x190fac4` | found → found | found → found | found → found | found → found |
| ethereum / USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `0x190fac4` | found → found | found → found | found → found | found → found |
| ethereum / USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` | `0x190fac4` | found → found | found → found | found → found | found → found |
| robinhood / LINK | `0x492641f648a4986844848e0befe66d14817bce34` | `0x5e0c4b8` | unknown → unknown | unknown → unknown | found → found | found → found |
| robinhood / PONS | `0x39dbed3a2bd333467115de45665cc57f813c4571` | `0x5e0c4bd` | found → found | found → found | found → found | found → found |
| robinhood / TSLA | `0x322f0929c4625ed5bad873c95208d54e1c003b2d` | `0x5e0c4b9` | found → found | found → found | found → found | found → found |

Field | Before | After | Interpretation
--- | --- | --- | ---
tradingTaxes | 7/9 | 8/9 | DATA_FOUND includes explicitly partial token-transfer proof; not verified full buy/sell fees.
mintCapability | 8/9 | 8/9 | Source-backed row availability; getter-reported values are not complete authority audits.
ownerAdmin | 9/9 | 9/9 | Source-backed row availability; getter-reported values are not complete authority audits.
contractArchitecture | 9/9 | 9/9 | Source-backed row availability; getter-reported values are not complete authority audits.

Reviewed source provenance:
- https://sourcify.dev/server/v2/contract/5042/0x1b74922c01ddfd9c77b37d02c0a236611e8fe500?fields=abi,sources,compilation,runtimeBytecode — digest f4abba6aa7071125168a9b9ea39cdfd08f01835d3c59aa74c55173c71e50daa1. Reviewed initialize, _update, ERC20 transfer path and caught reward callbacks. Fingerprint applies to matching implementations, never token addresses or tickers.
- https://sourcify.dev/server/v2/contract/5042/0x171a4217b86a807a64eb94757db6849fb4bdbaa0?fields=abi,sources,compilation,runtimeBytecode — proxy digest 316b86e4d73ad7a683188f2ac85162c763fd055d47d44c2be790d54b83a73a49. Reviewed legacy _implementation/_admin storage and ifAdmin upgrade gates.
- https://sourcify.dev/server/v2/contract/5042/0xc6061272419bb754a6c0386d1df81ddb3fe5cf3c?fields=abi,sources,compilation,runtimeBytecode — implementation digest d8d6edfc12f71433b5efe6ab623af4db5b160750902daa4f08fe337865087ceb. Reviewed full FiatToken transfer, minter allowance, supply-reducing burn and operational role paths.

## All-card baseline and genuine remaining gaps
Network | Tokens | Supply | Holders | Liquidity | Activity | Mechanics
--- | --- | --- | --- | --- | --- | ---
arc | 3 | 1/12 | 12/12 | 9/12 | 12/12 | 11/12
ethereum | 3 | 0/12 | 6/12 | 9/12 | 11/12 | 12/12
robinhood | 3 | 0/12 | 0/12 | 9/12 | 12/12 | 10/12

These are existing DATA_FOUND counts, **not all independently verified metrics**. Candidate memberships and market reports retain their original source classifications.

- Robinhood LINK: Sourcify HTTP404; Blockscout exact-token /counters and /holders HTTP403 (HTML response). Tax/mint source semantics and holder distribution cannot responsibly be supplied. No credential, restricted source or access-control bypass was introduced.
- Ethereum USDC: real /holders request exhausted the existing 8.5s deadline. Its source-reported count can survive; concentrations remain unknown. Warm caching helps an already successful source read, not a first request when the provider is down. No coverage increase is claimed for this outage.
- Arc holder COMPLETE publications were already 4/4 in this sample and are unchanged. Railway worker, checkpoint, signature and snapshot logic were not modified.
- Locked/unlocked supply lacks a reconciled complete vesting/escrow ledger; next unlock lacks contract-linked future evidence. No totalSupply-minus-burn arithmetic was substituted.
- LP status still requires actual custody/locker/withdrawal proof. Reserve amounts alone cannot establish it.
- Other transfers/taxes remain unknown when bytecode-matched reviewed source/getter execution evidence is absent. Verified source is not a safety endorsement.

## Validation status
- Focused Search unit tests: 30/30 PASS (large holders and Mechanics deep evidence).
- Earlier whole mixed worktree: 503/517 PASS, 14 FAIL. Untouched exact deployed baseline:489/503 PASS, the **same 14 named failures**. No expectations were removed or changed to hide these.
- Existing 14 failures span legacy Pulse fixture/current-cycle assumptions, pre-V8 source/visual guards, Hero CSS fixture and tiny burn formatting. Those unrelated failures remain out of scope. Full regression is not green.
- Search-only committed-tree full regression and desktop/mobile acceptance: pending final validation below.
- Production remains unchanged; no provider permission or environment configuration was modified.
