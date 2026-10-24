# ARCY SEARCH — Unlock & Supply evidence ledger (prototype)

Scope: *isolated read-only prototype only*. Nothing in this document authorizes a Search page layout change or a production deployment.

## Four required indicators

| Metric | Present evidence | Current policy | Why |
| --- | --- | --- | --- |
| Locked Supply | Exact-contract metadata-linked funded vesting event(s), GoPlus holder subset lock signals | `NOT VERIFIED` for total amount until **complete lock-contract coverage and release restrictions** are proven | A future funded installment is not the token's complete locked supply. |
| Unlocked Supply | ERC-20 totalSupply() from Arc RPC, selected third-party circulation data | `NOT VERIFIED` until a complete, reconciled vesting + lock state is established | `totalSupply - selected lock balances` can misrepresent unreported locks, burned custody and circulating supply. |
| Verified Burned | Exact bytecode-matched immutable reviewed nonburnable profile + on-chain supply evidence | **Zero can be verified only** for the reviewed immutable source profile `FIXED_SUPPLY_CAPPED_ERC20`; otherwise `NOT VERIFIED` | Address transfers to zero/dead are not proof of `totalSupply` reduction or lifetime burns. |
| Next Unlock | Contract-linked vesting getter with exact token match, funded Arc RPC balance, GoPlus holder subset or contract-selected project documentation | Show only source-reported future date and amount with **source and coverage** | The date is not guaranteed globally earliest if only a subset of vesting contracts was discovered. |

## Existing exact-chain inputs

- Arc mainnet chain ID: **5042**. The current readers `lib/core.js`, `api/supply.js`, `api/unlock.js` are Arc-specific. Ethereum (1) and Robinhood (4663) are **not supported by this reader**, never silently fallback to Arc.
- `api/supply.js`: `totalSupply()`, `decimals()`, ERC-20 `balanceOf(0x0)`, `balanceOf(0xdead)`, at a single block. Treat the latter only as custodial balances. These can populate the **evidence context**, not the four-metric burned count.
- `lib/unlock-sources.js::vesting`: contract-selected metadata `vestingContracts` (max four inspected), source-matched `token()`, `nextUnlockTime()`, `nextUnlockAmount()`, Arc RPC funding test.
- `lib/security-evidence.js::unlock`: future lock signals from GoPlus holder subset, verified against token balances; coverage is partial.
- `lib/unlock-sources.js::documentation`: a **contract-selected** metadata statement with exact Arc address and dated positive amount. Project-reported, not independent lock enforcement.
- `lib/unlock-sources.js::tokenomist`: intentionally returns unverified without exact Arc contract identity. A token name/ticker alone is not sufficient.
- `lib/supply-facts.js`: uses bytecode match from Sourcify/explorer and on-chain Arc RPC to establish defensible nonburnable zero only for explicitly reviewed immutable profile; otherwise returns null.

## Explicitly not computed

1. Locked / unlocked percentages from a partial holder sample.
2. A burned-supply percentage derived from `0xdead` custody balance.
3. An exact next unlock from a ticker-only calendar record.
4. A zero unlock or zero burn merely because no source is found.
5. Token locked supply from LP token locks: LP liquidity and ERC-20 vested supply are different questions.

## Prototype API and UI

- Read-only lab: `/research/unlock-supply-lab.html`, loads `/ui-model.js`.
- Upon an address scan, calls `/api/unlock?address=<exactArcAddress>&chainId=5042` and `/api/supply?address=<exactArcAddress>`. Each failure is isolated.
- Source attempts, sample coverage, reasons, reported date and amount are inspectable.
- `/api/mechanics` is **only** fetched after the user requests it, so ability to burn and real historical burned supply remain distinct.
- The original second-page Search HTML and `search.css`/`search-contract.css` files must stay byte-for-byte unchanged until separately approved.

## Next joint iteration

1. Verify a full token address and gather its known vesting/lock contract addresses and source-verified release schedule.
2. Implement per-source coverage accounting and token-identity checks on Arc first, then separate ETH and Robinhood readers.
3. Reconcile total supply, tokenomics allocations, on-chain vesting balances, release authorizations and already-released amounts before promoting total locked/unlocked values.
4. For burned supply, reconcile historical mint/burn and supply-reducing mechanisms for the exact implementation; keep historical and dead-address custody metrics apart.
5. Only after source coverage improves, decide final placement of these four indicators in the user's existing second-page Search design.
