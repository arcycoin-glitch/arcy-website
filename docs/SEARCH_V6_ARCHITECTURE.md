# ARCY SEARCH V6 engineering and source audit

Development starts at validated V5 `67e8880b8bfd3aa9a709a94e56fc12497ae6ec2c`, not current main. On 2026-10-19 the latest production deployment was READY at `4f78998472a8d93a3c190c892381efb35e1a02cc`. PR32 remains the V5 dependency. V6 is a separate stacked draft branch. PR31 (`c448b93dfa670850d047d47a7bba30d5e763d994`) was reviewed; only its eight-file holder attribution foundation was transferred and reconciled with V5. No reset, merge, production deployment or provider activation.

## Pipeline and evidence boundaries

`api/search` strictly validates GET/query keys, applies the existing 24/minute limit and dispatches JSON or progressive NDJSON. Exact chain and contract identity and deployed bytecode are established before pinned getters. Async-local analysis scopes bound RPC concurrency, coalesce exact reads and independent subscribers, and never reuse a completed report as latest chain state. All progressive frames retain five cards and twenty schema fields on one block anchor. Client version/network/abort checks reject obsolete searches. Optional provider failures retain valid partial evidence, never report a truncated stream as complete.

Each adapter independently supplies field-level provenance. The common formatter rejects missing/wrong-chain proof, contradictory primary token identity and mismatched current on-chain block proof. Historical COMPLETE fields retain their original block, timestamps and historical classification. Auxiliary implementation/admin addresses may differ from the token: they are not mistaken for a different primary token proof.

The reviewed V4 Mechanics source digests, runtime matching, proxy resolution and source/state interpretation remain intact. V6 adds practical limitations inside the existing evidence disclosure, not new risk scores or unreviewed permission claims. ABI-only pause, blacklist, timelock and role interfaces remain interface observations; implementation architecture alone does not prove upgrade authority. Tax, mint and authority conclusions remain limited to their reviewed evidence paths.

## Root causes addressed

1. A source-reader cache hit or concurrent join previously returned a body without running the new consumer's validator. Each consumer now checks schema and byte limits, including cache hits. Concurrent reads with different deadlines or size budgets no longer join an incompatible request.
2. Repeated optional-provider failures had 429 cooldown but no transient-outage circuit. Three consecutive transient failures open a bounded 30-second provider circuit; the next request after the interval probes recovery. Valid cache entries retain only their original TTL; expired evidence is never served as current. Forbidden/schema errors are not retried into success. HTTP-date Retry-After is supported, alongside the existing bounded cooldown policy.
3. Source-reader in-flight work lacked its own concurrency cap. A reader admits at most eight requests; excess optional work fails closed with a structured capacity code. Existing independent providers remain usable. RPC concurrency retains the V5 bound of eight.
4. Arc/Robinhood serially waited for supply/precision before starting independent name/symbol/burn reads. Those getters now run together after chain/code/block validation. No block/evidence check is skipped.
5. Completed Ethereum holder and Mechanics cards could wait for unrelated slow sources. They now emit their verified snapshots independently; final enrichment can still update the same anchored card.
6. PR31 candidate metadata needed additional boundary checks. V6 rejects duplicate or unsorted candidate ranks, invalid percentages, mismatched evidence blocks, unsupported role promotion and a BURN_ADDRESS label on a nonzero/nondead address. Address/balance pairing survives same-block reranking.
7. Public error details could echo upstream exception text. They now contain only fixed error categories. Operational aggregates never store addresses, raw URLs, RPC params, exception messages or arbitrary labels.

## Source and missing-data audit

| Area | Permitted evidence retained | What remains unverified |
|---|---|---|
| Identity | exact-chain RPC and reviewed issuer/Robinhood registry matches | tickers, logos and market pair names do not prove issuer identity |
| Supply | pinned totalSupply and zero/dead balanceOf | circulating supply requires an exact-contract permitted circulation source; custody is not an official burn/buyback event |
| Holders | Arc authenticated/legacy historical COMPLETE; current explorer count separately labeled; Ethereum complete small census or pinned explorer-candidate balances | a candidate sample is not global completeness; no balance-based owner inference; incomplete reconciliation never becomes concentration |
| Address roles | deterministic zero/dead custody; conservative reviewed-proof classifier | issuer treasury, vesting, exchange/bridge custody and pool roles remain UNKNOWN without independently reviewed exact-address evidence; no named registry was invented |
| Mechanics | existing full-source fingerprints, source/runtime binding, pinned execution/getters and reviewed profiles | unknown upgrade authorization, role enumeration and unsupported tax paths remain unknown; no risk rating |
| Market | existing approved exact-contract DEX observations; existing Arc source path; existing exact-contract Chainlink fallback for Ethereum WETH/USDC | pool subtotals are not complete network activity or guaranteed exit capacity; LP owner/lock assertions require separate verified pool evidence |
| Stock tokens | official Robinhood registry metadata + pinned token state | shares-per-token metadata does not independently prove economic backing, custody ownership or market liquidity |

Compliant alternatives reviewed in the existing code: public read-only chain RPC for supply and custody; issuer-operated Robinhood registry for stock metadata; exact Chainlink reference feeds for WETH/USDC; explorer counts with explicit source-reported scope. None provides an honest substitute for every missing circulation or LP-lock metric. No CoinGecko circulation, raw OHLCV, GoPlus or newly licensed feed was enabled. Existing production DEX approval is not copied to this new preview branch. A default restricted preview must therefore not be compared with an approved-profile local run as if permissions were identical.

Every missing field retains its precise reason code and explanation in the existing compact-card disclosure. All twenty field observations and sources in acceptance are recorded separately in the V6 results. Values are not filled to avoid empty cards.

## Operations and security

Health now advertises progressive capability and bounded per-process diagnostics: fixed provider/network categories, request outcome counts, fixed latency buckets, cache hit/miss/coalescing counts and aggregate network coverage. Counters reset on cold start and are not cross-region or durable population measurements. Raw exception strings and token/account identifiers are excluded. The existing worker remains independent; health explicitly reports worker liveness UNKNOWN because consuming a historical COMPLETE publication is not proof of a live heartbeat. No paid telemetry service or heartbeat infrastructure was provisioned.

Security review covers unchanged read-only RPC allowlists; strict gateway inputs; exact network/contract/block evidence; no secrets in logs or error payloads; bounded memory and source bodies; escaped textContent and fixed Ethereum explorer address links; existing logo host/content validation; existing provider permission gates; unchanged historical COMPLETE signature rules; no X writes or blockchain transactions. Tests include source 403/429/outage/recovery, stale-cache rejection and cross-chain isolation. These are controls and test observations, not a claim that all unknown contract permissions have been audited.

## Reproduction and rollback

Use the existing Node runtime and Playwright installation; no new dependencies. Run `node scripts/search-v6-acceptance.cjs` for Node plus fixture/browser quality gates. `--real` adds the ten-contract real-source desktop/mobile suite under the caller's existing permission profile. Installed Edge can be selected with `ARCY_BROWSER_CHANNEL=msedge`. The real-browser harness uses the V5 contract fixture and writes excluded local artifacts. Run `node scripts/search-v6-benchmark.cjs before` and `after` sequentially with identical permissions and an immutable sibling `arcy-search-v6-baseline` checkout at the V5 SHA. Provider timings measure fetch response headers; full reports include subsequent body and evidence processing. Never label these service timings as DOM rendering latency.

The exact V5 commit remains preserved and V6 is additive on a separate branch. Safe rollback is to retain production and reject/close this draft, or, after an owner-approved deployment, use the known immutable prior deployment. No rollback, branch rewriting or production promotion was performed during this task. Preview confirmation and final measured acceptance outcomes belong in the draft PR and results document. Passing tests alone does not establish production readiness.
