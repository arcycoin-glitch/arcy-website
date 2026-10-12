# ARCY SEARCH — source-backed 20-field coverage and rollout gate

## Scope

This upgrade modifies **backend evidence only**, not the homepage, multichain
picker, second-page skeleton, five analysis cards, 20 field definitions, canonical
owl, Burn, Unlocks, Arc Pulse, Research, Swap, X/Telegram/GitHub links or chart iframe.

The service MUST display NOT VERIFIED for unavailable, incomplete, contradictory
or unsupported evidence. No default zero, holder guess, fake candle or presumed
circulating supply is permitted.

## Source hierarchy

| Network | Field family | Primary evidence | Limitations |
| --- | --- | --- | --- |
| Arc (5042) | Supply & contract | Arc RPC pinned ERC-20 getters and mature first-party Arc source adapter | **Do not replace 3% ARCY tax** with conflicting GoPlus observation. |
| Arc | Holders | Reconciled original Arc holder worker publication, explicitly date-labelled | Historical snapshot ≠ live distribution. |
| Arc | Price/volume/liquidity | Original working Arc DEX/source readers | Source-reported market observations; tracked pools, not chain-wide census. |
| Ethereum (1) | Supply | Pinned Ethereum RPC | Burn-address balances are not lifetime buyback/burn. |
| Ethereum | Holder count / ranking | Blockscout indexed count + pinned RPC-ranked balances when reconciled | On mismatch, GoPlus **SOURCE_REPORTED** top-wallet sample only; not on-chain-verified ranking. |
| Ethereum | Market/DEX | DEX Screener token-pairs/v1/ethereum/{contract} | Report only exact-network and exact-token matching pools; up to 30. |
| Ethereum | Taxes / mint / proxy | GoPlus Ethereum token-security analysis; on-chain owner/getter wins | Simulated/detected, not a complete role audit. Missing transfer tax remains explicitly missing. |
| Robinhood (4663) | Supply | Pinned Robinhood RPC | Never equate total minted stock token supply to circulating supply or to underlying shares. |
| Robinhood | Holder sample | Blockscout current count if available, else GoPlus exact-token count + ranked top-10 | Source-reported; top-20 not inferred from only 10 entries. Public explorer may return HTTP 403. |
| Robinhood | Price/volume/liquidity | DEX Screener token-pairs/v1/robinhood/{contract} | Token-market values, not underlying company valuation; up to 30 pools only. |
| Robinhood | Taxes / proxy | GoPlus chain 4663, plus pinned RPC getter/storage evidence when available | Proxy detection does not prove upgrade-admin authority. |
| All | Discovery by ticker/name | Official issuer/Robinhood registry first; Blockscout index + exact-chain DEX pool index as unverified candidates | A name, ticker, logo or liquidity does not prove official contract ownership. |
| All | LP custody / circulating supply | Leave NOT VERIFIED until exact-contract validated primary records are available | Pool reserves cannot prove LP locks; total supply is not circulating supply. |

## Upstream terms and source references

- DEX Screener API terms explicitly allow commercial and noncommercial use **with restrictions**,
  particularly no competing API business, unauthorized re-licensing or redistribution:
  https://docs.dexscreener.com/api/api-terms-and-conditions .
  This site returns a small attributed research summary, **never** raw API payloads
  or a developer API replacement. Review these restrictions if ARCY SEARCH changes its business model.
- DEX Screener public API routes/rate limits:
  https://docs.dexscreener.com/api/reference .
- GoPlus describes its Security API as open and license-free for builders:
  https://www.gopluslabs.io/en/security-api .
  Observations are **SOURCE_REPORTED**, not independent security attestations.
- Robinhood Blockscout public counters sometimes answer 403. A free **Blockscout PRO**
  key can optionally be configured as `BLOCKSCOUT_API_KEY` in Vercel's server-only
  environment to improve holder count availability:
  https://www.blog.blockscout.com/build-on-robinhood-chain-with-the-blockscout-pro-api/ .
  Never place that key in front-end HTML, error messages or evidence source URLs.
- GeckoTerminal chart remains a **provider-owned official iframe**. Independent raw
  historical OHLCV extraction stays disabled until a separate license is established.

## Coverage measurement (illustrative and time-dependent)

Measured against 20 fields per actual scanned contract in isolated development
on October 12, 2026. Source availability and block height will change:

- Arc ARCY: 18/20; Arc ARGUS: 19/20.
- Ethereum UNI: 18/20; ONDO: 17/20; USDC: 16–17/20.
- Robinhood AAPL and TSLA: 15/20.

**This is not 90% of all possible tokens.** An unsupported field cannot honestly
be filled just to reach a coverage target. More broadly, six or more source-backed
families are now usable across three networks with bounded fallbacks.

## Safeguards

1. Numeric observations require the exact network and 40-hex contract match.
   No quote-token USD price is reused as a base-token price.
2. DEX Screener `marketCap` is labelled `MARKET_CAP`; `fdv` is labelled `FDV`.
   These figures are token values, **not** underlying securities market capitalizations.
3. Liquidity and volume are sums of the *returned subset* of token pools.
   They are not network-wide or market-wide totals; missing provider fields are NOT VERIFIED.
4. GoPlus top-10 wallet percentages are accepted only from ten distinct, descending,
   sane fractional observations (ratio in 0..1). Converted to percent, **never**
   presented as pinned on-chain proof. Top-20 stays missing without 20 ranked observations.
5. The external market request URL is constructed from a fixed vendor host, fixed
   network enum and validated contract. Search candidates from DEX have NOT VERIFIED identity.
6. Prices/candles are not fabricated. Source rate limiting, bounded JSON,
   60–120 second caching and in-flight de-duplication protect upstream quotas.
7. Roll out only after a **fresh Vercel preview of this exact commit** confirms
   Arc/ETH/Robinhood token search, five cards and native/mobile rendering.
   Keep production on its known working deployment if the preview fails.

## Validation commands

```sh
npm test
node --test test/search-dex-market.test.js
node --test test/search-goplus-evidence.test.js
```

Check live-source smoke tests on Arc ARCY/ARGUS, Ethereum USDC/UNI/ONDO,
Robinhood TSLA/AAPL. Source-backed counts and prices can legitimately change.
