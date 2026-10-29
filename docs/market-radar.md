# ARCY MARKET RADAR — 24h Uniswap v4 pool volume, first-party onchain (preview)

## Scope
Second-page **Token Research | Market Radar** switcher (PR #80 UI, unchanged layout). Existing five cards, 20 metrics, price chart, search, mobile behaviour, Pulse, Token Unlocks, Transparency and the home page are untouched. Radar shows **up to** ten tokens per network (Arc 5042, Ethereum 1, Robinhood Chain 4663), five rows per page, each linking to `/search/token/{network}/{exactContract}`.

## Data source (issue #89)
`lib/market-radar-onchain.js`, served by `GET /api/search?action=radar&chain=arc|ethereum|robinhood` (existing function; no new Vercel function).

1. Reads the public **Uniswap v4 PoolManager `Swap` events** of the last 24 h directly from each chain's RPC (`eth_getLogs`, bounded call/log/time budgets; an incomplete scan publishes nothing).
2. Resolves each pool id with the official **PositionManager `poolKeys`** and **proves it** by recomputing `keccak256(poolKey) == poolId`.
3. Values volume only for pools paired with an exact-contract USD anchor: Arc ERC-20 USDC `0x3600…0000` (6 decimals, checked), Ethereum USDC/WETH/ETH, Robinhood ETH/WETH and bridged USDC (derived at run time from the official L2 Gateway Router and verified by symbol/decimals). USD reference prices are **Chainlink ETH/USD and USDC/USD read onchain from Ethereum** (round freshness, positive answer, `answeredInRound` checked).
4. One pool per token (its highest-volume pool; same-token pools are never added), tokens deduplicated by network + full address, metadata (`symbol`, `decimals`, `name`) read from the contract; a token that cannot be read is skipped and counted.
5. 24h change = first-to-last observed swap price in that pool inside the window (labelled as such). Liquidity is **N/A** (Uniswap v4 keeps all balances in one PoolManager; not computed, never shown as zero).

Official deployment addresses: developers.uniswap.org/docs/protocols/v4/deployments (Ethereum, Arc), github.com/Uniswap/contracts/blob/main/deployments/4663.md (Robinhood), docs.robinhood.com/chain/protocol-contracts (L2 Gateway Router), docs.arc.io/integrate/defi/amm-and-pools (Arc USDC rules).

## Scope disclaimers (shown in the UI)
Uniswap v4 only — not whole-chain, not other DEXs (v2/v3, other venues), not token-wide aggregate volume. Pools with fewer than 2 swaps, unpriced pairs (no USD anchor), anchor-vs-anchor pools and pools beyond the key-resolution cap (200 most active) are excluded and **counted in `coverage`**. A network with no verified rows says so; it never hides the other networks.

## Licensing
No third-party market-data licence is involved in the default path: everything is public blockchain data read by ARCY itself. The server does not sell data. Third-party providers were assessed in `docs/market-radar-provider-audit-20261029.md`; **CoinGecko Pro stays off** and is selectable only with `MARKET_RADAR_PROVIDER=coingecko` plus `MARKET_RADAR_PUBLIC_DISPLAY_APPROVED=true`, `MARKET_RADAR_JSON_DELIVERY_APPROVED=true` and a server-only `COINGECKO_PRO_API_KEY`. A footer/credit line is never treated as a licence.

## Caching, limits
Server cache 600 s per network (+ edge `s-maxage=600`), failures negatively cached 60 s and never served as results; in-flight de-duplication; no stale result is shown as current (`asOf` is the chain head timestamp, head older than 15 min is refused). Hobby plan: Radar stays routed through `/api/search` (12-function limit).

## Verification
- `node --test test/market-radar-onchain.test.js test/market-radar.test.js`
- `node scripts/probe-market-radar-onchain.cjs [arc|ethereum|robinhood]` — live, read-only per-chain measurement (counts, field completeness, top rows). Run on a machine/Preview with RPC access; set `ETH_RPC_URL` / `ARC_RPC_URL` / `ROBINHOOD_RPC_URL` to a dedicated endpoint when public ones cap `eth_getLogs`.
- Compare each ranked token with its explorer page: exact contract, pool id, last swap tx.

## Safe rollout
Public Radar is OFF by default: `MARKET_RADAR_ONCHAIN_ENABLED=true` must be set per environment (Preview first). The switcher then appears only after at least one network returns verified rows. Do not merge or promote before the live per-chain measurement above and a real-browser mobile review.
