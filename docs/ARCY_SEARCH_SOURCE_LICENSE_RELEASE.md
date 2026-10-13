# ARCY SEARCH — production data licensing and full-card release checklist

**Reviewed 13 October 2026.** The approved homepage, premium detail page, three networks, five cards, Pulse, Burn, Unlocks, Research, Swap and official GeckoTerminal iframe are **locked**. Do not change the UI skeleton to solve licensing.

## Current source decisions

| Provider | ARCY use | Documentation | Current production policy | What resolves the decision |
| --- | --- | --- | --- | --- |
| First-party Arc/Ethereum/Robinhood RPC and issuer registries | ERC-20 supply, contract metadata, source-linked identity | Onchain mainnets, issuer first-party data | **ENABLED** under existing infrastructure/usage constraints | Stay read-only; require exact chain + contract and evidence |
| DEX Screener | Compact display of price, tracked pool liquidity, 24h volume and change, FDV vs market cap, indexed name matches | https://docs.dexscreener.com/api/api-terms-and-conditions | **DISABLED** in Vercel production when `DEXSCREENER_PUBLIC_DISPLAY_APPROVED` is absent | Obtain a written clarification that attributed, non-redistributable *research-card* display by ARCY SEARCH is permitted under competition/redistribution clauses, or documented legal authorization |
| GoPlus Security | Limited contract-control/tax checks, source-reported holder count/top-10, not a full audit | https://docs.gopluslabs.io/reference/api-license-agreement-new | **DISABLED** in Vercel production when `GOPLUS_PUBLIC_DISPLAY_APPROVED` is absent | Resolve section 6 commercial-use clause; add actual GoPlus logo **and** 'Powered by GoPlus' display in approved design and adhere to rate limits and any restrictions |
| GeckoTerminal official iframe | Provider-owned live chart for Arc and Ethereum | https://support.coingecko.com/articles/5271373977-how-to-embed-geckoterminal-charts-on-my-website | **Separate provider-owned EMBED** | Leave first-party embed and source link in place; do not confuse iframe with raw OHLCV republication. Confirm the embed's terms and any provider-specific required logo/attribution. |
| CoinGecko API / copied logos | Circulating supply/logo | https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses | **DISABLED** without a compatible commercial subscription | License subscription (would require explicit cost approval) or verified direct issuer-supplied evidence. Do not hotlink unlicensed art. |

**This is a product engineering review of public contract clauses, not legal advice or a representation that any provider has consented.**

### Important technical distinction

`/api/search?action=health` now exposes **current runtime access switches**, not legal consent or live upstream availability. A Vercel **preview** may return full DEX/GoPlus figures even while a **production** deployment will return NOT VERIFIED. Never accept preview coverage as proof of production-card coverage. In production, use the health response and 3-chain live API coverage check **after** promotion.

Before permissions, these production-like figures have been observed (values change):
- Arc ARCY: **18/20**
- Ethereum USDC: **8/20** vs 17/20 preview
- Robinhood TSLA: **3/20** vs 15/20 preview

Enabling only DEX Screener in a development simulation without GoPlus permission recovered approx. ETH USDC 12/20 and Robinhood TSLA 10/20. This simulation does NOT authorize toggling either flag in production.

## Permission inquiry #1 — DEX Screener

Official terms/help contact: **legal@dexscreener.com** — https://docs.dexscreener.com/privacy/terms-and-conditions

**Subject:** DEX Screener API usage clarification — ARCY SEARCH public token-research cards

Hello DEX Screener team,

We are preparing a free, public, research-first website at https://www.arcyusdc.xyz named ARCY SEARCH. It searches Arc, Ethereum, and Robinhood Chain tokens by exact contract and presents a limited set of source-attributed research facts: token supply/holder observations, contract-control flags, and market/pool information.

We would like to use the public DEX Screener API for **compact summary values only**—a chain- and contract-matched pool price, tracked-liquidity subtotal, 24-hour volume/change, number of returned pools, and provider-reported market cap or FDV with the appropriate label. We would link users to the specific DEX Screener source/pool, respect provider limits, briefly cache summaries, and **would not provide an API relay, relicense original responses, sell datasets or market ourselves as a replacement for DEX Screener's trading/market product**.

Could you please confirm whether this limited **public presentation of extracted metrics** fits within the API license's commercial-use, direct-competition and reselling/making-available restrictions? If permitted, are specific attribution, caching, licensing or paid-plan conditions required? We can adjust the integration to comply and will keep public use disabled until resolved.

Thank you,
ARCY SEARCH team
https://www.arcyusdc.xyz

## Permission inquiry #2 — GoPlus Security

Official provider contact: **support@gopluslabs.io** — https://docs.gopluslabs.io/reference/support

**Subject:** GoPlus Security API permission & branding for ARCY SEARCH token research

Hello GoPlus Security team,

We are preparing ARCY SEARCH (https://www.arcyusdc.xyz), a free, research-first token information website covering Arc, Ethereum and Robinhood Chain. We would like to show **a few API-sourced, exact-contract risk observations** in existing research cards: simulated buy/sell taxes, detected mint/proxy/owner properties, token holder count and a clearly marked partial top-10 holder sample. Each observation is labeled **SOURCE_REPORTED**, not independently audited; we do not claim the sample is a complete wallet census.

We have reviewed the GoPlus API License Agreement. We understand it calls for an official logo plus **Powered by GoPlus** acknowledgement and requires explicit written permission to use original API data directly in revenue-generating commercial activities. The current website is free to visitors, but it promotes our own ARCY token and may introduce monetization in the future.

Can you please clarify whether we may publicly show these limited source-attributed metrics under the free API license, including this promotional/possible future-commercial context? If written authorization is needed, how should we obtain it? Please also supply the approved **GoPlus logo/brand asset and placement requirements** so our attribution is compliant before public activation. We will respect your API rate limit and do not intend to redistribute raw API responses.

Thank you,
ARCY SEARCH team
https://www.arcyusdc.xyz

## Production release checklist — do not bypass

- [x] Approved premium skeleton preserved in staging branch.
- [x] Six-section dated Pulse #003 archived separately; current Pulse must not recycle old news.
- [x] Contract-matched chain reports / initial unit tests and preview API checks.
- [x] Runtime provider flags are detected and publicly diagnosed without revealing secrets.
- [ ] Provider permission/terms for actual public use are documented and approved, or replaced with licensed/direct onchain alternatives.
- [ ] GoPlus compliant official logo + Powered by GoPlus attribution implemented **before** any GoPlus production use.
- [ ] Production env flags set **individually only for an authorized provider**; never just to inflate metrics.
- [ ] Exact release commit SHA deployed and 320/390/768/1440px browser tests, Pulse archive, search, direct token paths, Swap/Burn/Unlocks, time-range chart tests passed.
- [ ] In an actual Vercel **production** runtime, test Arc ARCY / Ethereum USDC + ONDO / Robinhood TSLA + AAPL and record found/20, latency, source+contract evidence, and exceptions.
- [ ] Preserve old production deployment ID/alias for rapid rollback; do not change aliases/merge production before explicit owner GO.

### Safe fallback when permission is refused

Keep rejected providers disabled and use direct chain RPC/verified first-party data only, show `NOT VERIFIED` for unsupported fields, keep the official GeckoTerminal provider-owned iframe and direct provider links, and explain the resulting reduced public-data coverage. Never silently enable a different unlicensed API as a substitute.

## Permission record (to fill after response)

| Provider | Contact date | Reply and scope | Decision | Attribution / quotas | Expiration/review |
| --- | --- | --- | --- | --- | --- |
| DEX Screener | NOT SENT | Pending | OFF | Pending | Pending |
| GoPlus | NOT SENT | Pending | OFF | Required logo + Powered by GoPlus; written permission if monetizing directly | Pending |
