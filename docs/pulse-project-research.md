# Pulse V3 project research

The current homepage reads `/api/pulse?view=projects&chain=arc|ethereum|robinhood` on first opening each tab. This is a versioned view inside the existing function. Legacy Pulse reads, weekly publication, signing, and numbered archives use their existing paths. The project view carries no weekly edition number and writes no state to the publisher.

The curated catalog binds each development to a project identity, publication date, official URL, and reviewed chain-specific claim. Aave's forum adapter verifies the original post's author, timestamp, and body. The other sources require a matching headline, nearby publication date, and chain-specific claim in the reviewed page. Returned research text is editorial copy from the catalog. Upstream markup and URLs discovered in upstream content are never rendered. A successful check establishes what the publisher reported, with usage, execution and deployment claims attributed to the source.

The collector deduplicates project identities, considers at most two reviewed developments per project, and ranks verified developments from the last 28 days first. Older verified material appears as historical background with the original date. On a source outage or mismatch, the card retains its reviewed profile and explains the missing verification. Any remaining unfilled slots have explicit coverage status. The collector makes up to three first-party requests per cold tab for the current catalog, with five distinct source URLs across all tabs. It uses the existing three-second bounded fetch, request coalescing, a six-hour source cache, and cooldown for HTTP 403 and 429 with bounded `Retry-After` support. These controls are per server instance, with public response caching for the project view.

## Reviewed source coverage on November 13, 2026

| Network | Within 28 days | Historical profile |
| --- | --- | --- |
| Arc | [Morpho, Nov 5](https://morpho.org/blog/the-morpho-effect-october-2026), [Aave, Nov 2](https://governance.aave.com/t/al-development-update-october-2026/25979) | [Uniswap, Sep 16](https://blog.uniswap.org/uniswap-is-live-on-arc) |
| Ethereum | [Morpho, Nov 5](https://morpho.org/blog/the-morpho-effect-october-2026), [Aave, Nov 2](https://governance.aave.com/t/al-development-update-october-2026/25979), [Uniswap, Oct 22](https://blog.uniswap.org/aggregator-hooks-are-now-live) | None |
| Robinhood Chain | [Morpho, Nov 5](https://morpho.org/blog/the-morpho-effect-october-2026), [Uniswap, Oct 22](https://blog.uniswap.org/aggregator-hooks-are-now-live) | [Chainlink, Jul 1](https://www.prnewswire.com/news-releases/robinhood-chain-launches-and-adopts-chainlink-to-unlock-access-to-the-onchain-economy-for-millions-of-users-302816242.html) |

Arc chain relevance is corroborated by Circle's mainnet announcement. Robinhood's chain documentation identifies Morpho, Uniswap, and Chainlink by role. Ethereum references are explicitly scoped to Ethereum in the reviewed publications. [Arc mainnet announcement](https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet), [Robinhood Chain documentation](https://docs.robinhood.com/chain/)

The initial catalog uses attributable first-party releases from established projects. Additional projects and developments require editorial review. It does not ingest arbitrary repository commits or infer deployment, transaction volume, market depth, or an exact token address. The cards have no token analysis links.

The fixture browser test measures three columns at 1440 and 800 px, the carousel at 390 and 320 px, keyboard tab selection, visible source dates, external link safety, document width, and the Arc and Ethereum archive views. Use `node --test test/pulse-projects.test.js` for collector fixtures and `node test/pulse-projects-browser.cjs` with Playwright Chromium for the DOM checks.
