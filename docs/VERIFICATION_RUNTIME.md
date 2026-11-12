# ARCY Autonomous Verification Runtime

Opt-in runtime that tells, for every displayed Search metric, whether the value is current, where it came from, whether a second independent operator confirmed it, whether sources disagree, whether it may be called VERIFIED, and whether it changed since the last trusted observation.

- Flag: `ARC_AUTONOMY_VERIFICATION_RUNTIME_ENABLED=1`. **Default OFF.** OFF adds nothing to any response.
- ON adds one top-level `verification` object to a Search report. Cards, fields, values, statuses and reason codes are never modified.
- Code: `lib/verification/{freshness,source-identity,metric-catalog,onchain-observer,runtime}.js`, hooked once in `search/server/lib/multichain-service.js` after the existing `block-age` and `evidence-class` annotators.

## Verification states (strict MetricEvidence contract, unchanged)

| State | Meaning | Carries a value |
|---|---|---|
| `VERIFIED_ONCHAIN` | Two registered RPC operators returned the identical value at the same block number **and hash**, the block is fresh, and the displayed value equals that reading | yes |
| `INDEPENDENTLY_CROSS_CHECKED` | Two independent non-RPC operators reported the **identical** value at the same observation time with known fresh age | yes |
| `SINGLE_SOURCE` | Displayed, but not independently confirmed (one operator, tolerance-only agreement, unknown age, no confirmation path) | yes |
| `CONFLICTING` | Operators disagree on the value or on the block hash; both original values are kept | no |
| `STALE` | The current observation is older than the metric's policy | no |
| `UNAVAILABLE` / `NOT_VERIFIED` | No usable reading, or the reading cannot be trusted (invalid/future time, display mismatch) | no |

Only the first two are verified (`verified:true`). A tolerance agreement between market providers is never published as exact agreement: it stays `SINGLE_SOURCE` with reason `WITHIN_TOLERANCE_NOT_EXACT`, and both raw values are kept in `consensus.values`.

## Freshness policies (Stale Detection Engine)

| Policy | Data class | Clock | Limit | Why |
|---|---|---|---|---|
| `onchain-state` | supply, burn custody, owner, implementation | pinned block timestamp | 15 min | a report on an older block is not current chain state |
| `contract-mechanics` | capabilities, roles | pinned block timestamp | 6 h | code changes only through upgrades/role changes |
| `holder-snapshot` | holder count, concentration | pinned block timestamp | 24 h | matches the existing evidence-class limit; age of the block, not of the file |
| `market-price` / `market-change` | price, 24h change | provider timestamp | 5 min (retrieval ≤ 2 min) | spot price moves continuously |
| `market-liquidity` | pool liquidity, pair count | provider timestamp | 15 min (retrieval ≤ 5 min) | reserves change per swap |
| `market-volume` | 24h volume | provider timestamp | 60 min (retrieval ≤ 15 min) | a rolling window moves slowly |
| `market-derived` | market cap / FDV / turnover | provider timestamp | 5 min (retrieval ≤ 2 min) | inherits the strictest input |
| `unlock-event` | unlock calendar | event time / source review | review ≤ 7 days | a past event is HISTORICAL, never current |

Rules: an HTTP 200 is not freshness; a provider without a data timestamp yields `SOURCE_AGE_UNKNOWN` (shown, never FRESH, never VERIFIED); a cached response older than the retrieval limit is `STALE`; timestamps beyond 60 s of clock skew are `FUTURE_TIMESTAMP`; malformed, zone-less or pre-2015 timestamps are `INVALID_TIMESTAMP`; a block ahead of the observed head or with broken time order is `BLOCK_INCONSISTENT`. Freshness is computed only from the current observation, never from the ledger's `lastTrusted`.

## Operator independence

Independence is decided by the operator, not the URL. Registry in `lib/verification/source-identity.js`; Arc endpoints are attributed per the official list at https://docs.arc.io/arc/references/rpc-endpoints (`rpc.mainnet.arc.io` → Circle, `rpc.quicknode.mainnet.arc.io` → QuickNode, dRPC, Blockdaemon).

| Network | Primary (default) | Independent (default) |
|---|---|---|
| Ethereum | `ethereum-rpc.publicnode.com` (Allnodes) | `eth.drpc.org` (dRPC) |
| Arc | `rpc.mainnet.arc.io` (Circle) | `rpc.quicknode.mainnet.arc.io` (QuickNode) |
| Robinhood | `rpc.mainnet.chain.robinhood.com` (official) | `robinhood.drpc.org` (dRPC) |

- Same operator → the second endpoint is not called (`SAME_OPERATOR`). Unlisted hosts under an official domain fall back to that network's official operator, never a new one. Unknown hosts are `DOMAIN_FALLBACK` and never upgrade evidence (`OPERATOR_UNVERIFIED`).
- GeckoTerminal and CoinGecko are one operator.
- Residual risk: two registered companies can still share upstream infrastructure; the registry records the documented operator, not a proof of separate hardware.
- Override per network: `ARC_VERIFICATION_RPC_URL_<ARC|ETHEREUM|ROBINHOOD>` (HTTPS only, `off` disables).

## Budget and cooperation with the Provider Watchdog

Per report with the flag ON: ≤ 9 read-only calls on the primary and ≤ 8 on the independent endpoint (`chainId`, block header, `totalSupply`, `decimals`, two burn balances, head on primary, `owner()` and EIP-1967 slot only when those are displayed), concurrency 3 per endpoint, 2.5 s per call, 4 s overall, **no retries**. Market metrics make **no new requests**: the existing licence-gated cross-check (`SEARCH_MARKET_CROSSCHECK_APPROVED`) is reused when it ran.

Each endpoint contributes one watchdog event per observation. HTTP 429 → `COOLDOWN` and the provider is skipped (not retried) until the cooldown ends; malformed or wrong-chain → `UNAVAILABLE`; recovery goes through probes. State is process-local (bounded) and, when durable storage exists, persisted through the Provider Watchdog ledger so a cooldown survives restarts.

## Evidence Ledger and change detection

When `ARC_VERIFICATION_LEDGER_DIR` or `ARC_HOLDER_PUBLISHED_DIR` exists, every metric record is written through the existing Evidence Ledger (lock + fsync + atomic rename; regression, time conflicts and corruption fail closed). Without storage the runtime reports `ledger.history: NOT_PRESERVED` and `change.kind: HISTORY_UNAVAILABLE`. Writes are bounded: an unchanged reading is rewritten at most once per minute per metric per process; ledger operations time out at 1.5 s with concurrency 4.

Change kinds: `FIRST_OBSERVATION`, `FIRST_TRUSTED_OBSERVATION`, `UNCHANGED`, `VALUE_CHANGED` (trusted → trusted, with from/to), `COVERAGE_RESTORED`, `COVERAGE_REDUCED`, `SOURCE_COVERAGE_CHANGED`, `UNVERIFIED_VALUE_CHANGE`, `UNVERIFIED_OBSERVATION`, `PROVIDER_DISAGREEMENT`, `NO_CURRENT_TRUSTED_READING`, `NO_CURRENT_READING`. `history` is always marked `historical:true` with its own `observedAt` and age.

## Metric matrix

| Metric ID | Field | Kind | Freshness | Verification | Current sources | Independent sources | Limitations |
|---|---|---|---|---|---|---|---|
| `supply.total_supply` | supply.totalSupply | ONCHAIN | onchain-state (15 min) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). | ERC-20 totalSupply() only. Rebasing or bridged supply is reported as the contract reports it. |
| `supply.burn_address_balance` | supply.burnAddressBalance | ONCHAIN | onchain-state (15 min) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). | Current balance of 0x0 + 0x…dEaD only; not lifetime burned and not other burn sinks. |
| `supply.non_burn_supply` | supply.nonBurnSupply | ONCHAIN_DERIVED | onchain-state (15 min) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). | totalSupply minus burn-address custody. It is NOT circulating supply: locked, treasury and vesting balances are included. |
| `supply.burn_address_pct` | supply.burnAddressPct | ONCHAIN_DERIVED | onchain-state (15 min) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). | Share of supply held at the two standard burn addresses at the analysis block (18 decimal places). |
| `holders.holder_count` | holders.holderCount | INDEXER | holder-snapshot (24 h) | NONE | arc: Signed worker holder publication (A/X Explorer enumeration reconciled to Arc RPC); ethereum: Blockscout / GoPlus; robinhood: Robinhood Blockscout | None today. An enumeration is only as complete as the indexer; a second indexer would be required. | Holder completeness depends on the enumerating indexer. Arc snapshots that reconcile exactly to totalSupply are complete for that block, but still single-operator. |
| `holders.largest_wallet_pct` | holders.largestWalletPct | INDEXER | holder-snapshot (24 h) | NONE | arc: Signed worker holder publication; ethereum: Blockscout candidates re-read by Ethereum RPC / GoPlus; robinhood: Robinhood Blockscout + RPC | Balances can be re-read by RPC; the RANK (that no larger wallet exists) depends on the indexer. | Pool, exchange and contract wallets are classified only where attribution evidence exists. |
| `holders.top10_pct` | holders.top10Pct | INDEXER | holder-snapshot (24 h) | NONE | arc: Signed worker holder publication; ethereum: Blockscout / GoPlus; robinhood: Robinhood Blockscout + RPC | As largestWalletPct. | Concentration of the ten largest indexed holders. |
| `holders.top20_pct` | holders.top20Pct | INDEXER | holder-snapshot (24 h) | NONE | arc: Signed worker holder publication; ethereum: Blockscout; robinhood: Robinhood Blockscout + RPC | As largestWalletPct. | Concentration of the twenty largest indexed holders. |
| `liquidity.liquidity_usd` | liquidity.liquidityUsd | MARKET | market-liquidity (15 min) | MARKET_CROSSCHECK | arc: DEX Screener (GeckoTerminal fallback); ethereum: DEX Screener / GeckoTerminal; robinhood: DEX Screener (GeckoTerminal fallback) | GeckoTerminal (CoinGecko) when the licence-gated cross-check is enabled and both providers return the same pool set. | Sum of returned pools; not a chain-wide pool census and not executable exit liquidity. |
| `liquidity.volume_24h` | liquidity.volume24h | MARKET | market-volume (1 h) | MARKET_CROSSCHECK | arc: DEX Screener; ethereum: DEX Screener / GeckoTerminal; robinhood: DEX Screener | GeckoTerminal when enabled; providers differ in window edges, so agreement is tolerance-based only. | Pools younger than 24 hours report a partial window. |
| `liquidity.dex_pair_count` | liquidity.dexPairCount | MARKET | market-liquidity (15 min) | NONE | arc: DEX Screener; ethereum: DEX Screener; robinhood: DEX Screener | None: providers index different pool sets by design. | Count of pools the provider returned, not of all pools. |
| `liquidity.turnover_24h` | liquidity.liquidityTurnover24h | MARKET_DERIVED | market-derived (5 min) | NONE | arc: Derived: same-provider volume / liquidity; ethereum: Derived; robinhood: Derived | Inherits its market inputs; never stronger than SINGLE_SOURCE. | A turnover ratio is not exit-safety evidence. |
| `activity.price_usd` | activity.priceUsd | MARKET | market-price (5 min) | MARKET_CROSSCHECK | arc: DEX Screener; ethereum: DEX Screener / GeckoTerminal / Chainlink where reviewed; robinhood: DEX Screener | GeckoTerminal when enabled (tolerance 3 %); exact agreement is not expected between market providers. | Pool-derived spot price of the returned pools. |
| `activity.valuation` | activity.valuation | MARKET_DERIVED | market-derived (5 min) | NONE | arc: Derived: Arc RPC totalSupply × market price; ethereum: Provider-reported or derived; robinhood: Derived | Never on-chain verified: the price component is market data even when supply is on-chain. | FDV uses total supply; market cap requires circulating supply, which is usually not verified. |
| `activity.change_24h` | activity.change24h | MARKET | market-change (5 min) | NONE | arc: DEX Screener; ethereum: DEX Screener / GeckoTerminal; robinhood: DEX Screener | Not compared: the existing cross-check covers liquidity, volume and price only. | Provider window definition. |
| `activity.volume_24h` | activity.volume24h | MARKET | market-volume (1 h) | MARKET_CROSSCHECK | arc: DEX Screener; ethereum: DEX Screener / GeckoTerminal; robinhood: DEX Screener | As liquidity.volume24h. | Same value as the Liquidity card field; verified separately per card. |
| `mechanics.trading_taxes` | mechanics.tradingTaxes | SOURCE_ANALYSIS | contract-mechanics (6 h) | NONE | arc: Reviewed source/hook profiles + Arc RPC; ethereum: Sourcify/Etherscan source + GoPlus; robinhood: Reviewed source + Robinhood RPC | None: a second source-analysis engine would be required. | Transfer-path fees only unless buy/sell paths are separately proven. |
| `mechanics.mint_capability` | mechanics.mintCapability | SOURCE_ANALYSIS | contract-mechanics (6 h) | NONE | arc: Source/bytecode review + role reads; ethereum: Source review / GoPlus; robinhood: Source review + role reads | None. | Absence of a mint selector is not proof that minting is impossible. |
| `mechanics.owner_admin` | mechanics.ownerAdmin | ONCHAIN | contract-mechanics (6 h) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). Only when the displayed value is an owner() getter result. | owner() is one getter; it does not enumerate roles, timelocks or multisig signers. |
| `mechanics.contract_architecture` | mechanics.contractArchitecture | ONCHAIN | contract-mechanics (6 h) | INDEPENDENT_RPC_SAME_BLOCK | arc: Arc RPC; ethereum: Ethereum RPC; robinhood: Robinhood RPC | Second registered RPC operator at the same block number and hash (Ethereum: dRPC vs PublicNode/Allnodes; Arc: QuickNode vs Circle; Robinhood: dRPC vs the official endpoint). Only when the displayed value is an EIP-1967 implementation slot. | An empty implementation slot does not prove non-upgradeability. |

## Rollback

Unset the flag (already the default). Nothing else imports the runtime; the only change to an existing module's behaviour is the consensus fix below.

## Change to the existing consensus engine

`consensus.evaluate` with an `EXACT` policy returned `NOT_COMPARABLE / VALUE_TYPE_MISMATCH` for two different values of the same type. Two operators reporting different supply at one block is a conflict, so it now returns `CONFLICTING / VALUES_DISAGREE`; differing value types remain `NOT_COMPARABLE`. The runtime is the engine's only consumer.
