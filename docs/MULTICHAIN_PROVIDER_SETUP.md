# Multichain provider setup

Configure these as server-side environment variables. Do not expose RPC URLs or
Blockscout keys through `NEXT_PUBLIC_*` variables or browser code.

## Ethereum mainnet

- `ETHEREUM_RPC_URL` — required for Ethereum on-chain reads. It must serve
  Ethereum mainnet and return `0x1` for `eth_chainId`. Use an endpoint you
  operate or a provider's no-cost public tier; the application validates the
  chain before using it. The legacy `ETH_RPC_URL` remains a fallback alias.
- `ETHEREUM_RPC_FALLBACK_URLS` — optional comma-separated fallback endpoints;
  each is independently checked for chain ID 1. The legacy
  `ETH_RPC_FALLBACK_URLS` remains supported.

No Ethereum endpoint is configured in the audited local environment, so live
Ethereum verification is blocked until `ETHEREUM_RPC_URL` is set.

## Robinhood Chain holder indexing

- `BLOCKSCOUT_API_KEY` — optional server-side Blockscout free-tier API key.
  When present, holder discovery uses Blockscout's multichain REST API at
  `api.blockscout.com/4663/api/v2`. The key is redacted from returned evidence.
- Without this key, holder discovery uses Robinhood Chain's public RPC and a
  resumable ERC-20 `Transfer` scan from genesis. A full snapshot is published
  only after every candidate balance is read at one pinned block and the sum
  reconciles exactly to `totalSupply()`.
- `ROBINHOOD_RPC_URL` — optional RPC override. The default is Robinhood's
  published mainnet endpoint and must return chain ID `0x1237` (4663).
- `ROBINHOOD_RPC_FALLBACK_URLS` — optional comma-separated fallback endpoints;
  each is independently checked for chain ID 4663.

Genesis scans can require many bounded RPC requests. Run them through the
existing durable holder worker and persistent storage configuration described
in `HOLDER_PUBLICATION_ARCHITECTURE.md`; Vercel's ephemeral filesystem cannot
retain a partial scan between separate invocations. No partial holder count or
concentration metric is represented as complete.

## Worker chain

Run a separate worker process with `ARC_HOLDER_CHAIN_ID=4663` and a durable
storage configuration for Robinhood Chain. The worker accepts only queue
requests for its configured chain ID. Do not point a Robinhood queue at an
Arc-only worker.
