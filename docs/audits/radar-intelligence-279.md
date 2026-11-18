# Radar Intelligence Engine — issue #279

Date: 2026-11-18 (UTC 2026-11-17). Branch `claude/radar-intelligence-release-candidate`, Draft PR #280.
Status: **IMPLEMENTED · TESTED · SHADOW VERIFIED (CI, read-only)** — NOT merged, NOT deployed, NOT production verified.

## File allowlist (what changed)

| Area | Files |
|---|---|
| Integrated #277 (Codex, cherry-picked with authorship) | `lib/radar-v2/pre-catalyst.js`, `scripts/probe-radar-pre-catalyst.cjs`, `test/radar-pre-catalyst*.{js,cjs}`, `docs/audits/radar-pre-catalyst-275.md`, `docs/audits/radar-275-production/*` |
| Integrated #278 (cherry-picked) | `lib/radar-v2/index.js`, `test/radar-v3-discovery.test.js` |
| New engine | `lib/radar-v2/intel/{fetch,seal,registry,github,governance,explorer,onchain,engine}.js`, `lib/radar-v2/intel/project-registry.json` |
| Changes to #277 code | `pre-catalyst.js`: path-scoped official sources (bare shared hosts never official); `ONCHAIN_RESERVE_SAMPLES` history source; decimal Pons `launch.block` accepted |
| Scripts / tests / CI | `scripts/probe-radar-intel.cjs`, `scripts/radar-registry-propose.cjs`, `test/radar-intel.test.js`, one probe step added to the existing `market-radar-source-probe.yml` |

Untouched (blob-checked against main `42a110d`): `index.html c4a27c26`, `search/index.html 39cedc0b`, `search/market-radar.js dc4fef8d`, `search/market-radar.css 48a31369`, `search-upgrade.css 6ee36dc6`. No route, public DTO, `arcy-discovery-2` score, Vercel function, cron, database, Railway `/data` or worker change. Because no frontend byte changed, the 320/390/800/1024/1440 px layouts are identical by construction; the #277 captures in `docs/audits/radar-275-production/` remain the visual baseline. A preview-deployment screenshot pass was **not** repeated.

## Pipeline

DISCOVER (existing Radar section snapshots only; Pons launches routed out of Robinhood by exact contract; duplicates/invalid/wrong-chain rows dropped) → IDENTIFY (owner-reviewed registry, exact `chainId:address`) → VERIFY (GitHub file at a pinned commit must still contain the exact address; fork/owner mismatch rejected; contradiction recorded) → DETECT CATALYST (open GitHub milestone due ≤90 d with issues; pending/active vote in the registered Snapshot space) → ANALYZE ACTIVITY (releases, commits, authors; token Transfer logs with router-hop following → distinct final buyers, top-buyer share, buy/sell overlap) → CHECK HISTORY (#277 two-source 24h ≥700 % veto, plus 31 daily on-chain samples per exact pool from reviewed V2/V3/Uniswap V4 venues with block-bound liquidity witnesses) → ASSESS RISK (bytecode, EIP-1967 slots, Blockscout verified ABI surface, holder concentration, `transfer(pool)` eth_call from a real recent buyer, reviewed Liquidity & Exit engines) → RANK (#277 deterministic evaluator; ≤5 per network; never padded) → REFRESH (TTL caches per evidence kind; immutable past samples memoised).

Outputs per candidate: `eligibility` (EXCLUDE/REVIEW/ELIGIBLE), `evidenceConfidence` (share of 9 required proofs verified), unchanged `discoveryScore`, `risk` (critical vetoes), `runup`, sources, `decisionHash`, and for ELIGIBLE only a ≤300-character Info reason. REVIEW rows form a research queue with the missing proof and cheapest next evidence action. `opportunityVersion: arcy-opportunity-1`.

Trust boundaries: evidence is sealed in-process (WeakSet + deep freeze). Caller/JSON `publisherVerified` or `CONFIRMED_PUBLIC_EVENT` objects are dropped. A domain such as `github.com`, `x.com`, `medium.com` is never official by itself; official sources are non-shared domains or `https://github.com/<org>/<repo>/` prefixes from the registry. The fetcher allows only `api.github.com`, `hub.snapshot.org`, `eth.blockscout.com`, `robinhoodchain.blockscout.com`, HTTPS/443, no credentials in URLs, no redirects, 8 s timeout, 512 KiB cap, daily and per-run budgets, one 429/503 retry then cooldown, circuit breaker after 4 consecutive failures, ETag revalidation. The GitHub token (CI `GITHUB_TOKEN`) is sent only to `api.github.com`.

## Real sources connected

| Source | Use | Live status in CI probe |
|---|---|---|
| Existing Radar API (4 sections) | candidates | OK, 4×HTTP 200 |
| Arc / Robinhood / Ethereum public RPC (existing clients) | history, demand, contract, sell, exit | Arc OK with pacing (one token still 429); Robinhood OK (one V4 pool HTTP 400); Ethereum `eth_getLogs` HTTP 403 for history |
| Reviewed Liquidity & Exit V2/V3/V4 engines | exit quotes | OK: verified quotes on 7 pools |
| Blockscout Ethereum | verified ABI, holders | OK |
| Blockscout Robinhood | verified ABI, holders | **HTTP 403** from GitHub runners (public tier; existing Search uses a PRO key fallback that is not configured here) |
| GitHub REST | identity/activity/milestones | wired; **0 calls** because no project is registered |
| Snapshot Hub | governance | wired; 0 calls (no registered space) |
| CoinGecko OHLCV | — | **not used**: Demo has no commercial licence; one OHLCV read per candidate would exceed the Demo budget (see #277) |

## Measured results (CI run 44187516676, section snapshots 2026-11-17 22:11 UTC)

| Network | Candidates | ELIGIBLE | REVIEW | EXCLUDE | On-chain inspected |
|---|---|---|---|---|---|
| Arc | 5 | 0 | 4 | 1 (AF: verified exit quotes cost >5 % even at $1k; on-chain price disagrees >25 % with provider price) | 3 |
| Ethereum | 10 | 0 | 10 | 0 | 3 |
| Robinhood | 9 (1 Pons launch routed to Pons) | 0 | 9 | 0 | 3 |
| Pons Launch | 3 | 0 | 3 | 0 | 3 |

- Registry: version `2026-11-18.0`, **0 approved projects** → every candidate lacks identity, product continuity and a dated catalyst. Zero eligible is the honest result; nothing was padded.
- History coverage: 4 pools produced daily on-chain series (SPCX 31, NVDA 31, AF 31, ARCOON 28 candles). `RUNUP_CLEARED` 2 (SPCX, AF), verified 8x 0, 24h 8x 0, `RUNUP_NOT_VERIFIED` 25 (unreviewed factory: XAUt, PONS; ETH-quoted pools blocked by Ethereum RPC 403; budget policy skipped 15 lower-ranked unregistered rows).
- Highest research-queue confidence: GTA6 (Ethereum) 0.556 — on-chain buyers 214 in 3 h, exit ≥$5k, verified bounded mint, standard ABI, sell simulation OK; missing identity, product, catalyst, history.
- Cost, cold run: 14 Blockscout calls, 0 GitHub, 0 Snapshot, 0 CoinGecko credits; RPC Arc 192 / Ethereum 47 / Robinhood 328; 104 s with one-at-a-time pacing. Warm rerun inside TTL: 0 HTTP, RPC 90 / 26 / 115 (failed reads are not cached), 29 s, 30 cache hits.
- Precision, false-positive rate, lead time: **NOT MEASURED** — no approved registry entries and no time-separated history dataset. Plan: keep daily engine reports as CI artifacts for ≥60 days, then score each REVIEW/ELIGIBLE decision against the later on-chain series with no look-ahead.

## Real defects found by live probes (fixed in this branch)

1. Production Pons rows report `launch.block` as a decimal number; #277 accepted only hex, so every real Pons launch read `PONS_FACTORY_NOT_VERIFIED`.
2. Production currently still shows PONS and PRIORS in both Robinhood and Pons; #278 fixes this, so it remains open until #278/#280 is deployed.
3. Constant-rate block-at-time search failed on Arc/Robinhood; replaced by a bracketed search.
4. Arc public RPC rejects 10k-block log spans; Robinhood rejects >100k; Arc returns 429 to bursts — spans capped, calls paced, one 429 retry.
5. An unreadable log window was briefly reported as "0 verified buyers"; now `NOT_VERIFIED`.

## Remaining blockers

1. **Owner registry review** (human): run `node scripts/radar-registry-propose.cjs --network <n> --address <a> --repo <owner/repo> --path <file>` and add a reviewed entry. Live GitHub checks found addresses in project-owned repositories for PRIORS (`priors-agents/priors`, user-owned, homepage priors.trade), HOOKR (`Hookr-fun/hookr-contracts`, org without verified domain), WPRL (`PearlBridgeXYZ/*`); none has GitHub domain verification and none has an open dated milestone. These are leads, not affiliation.
2. **Ethereum history**: the configured public Ethereum RPC answered 403 to the needed `eth_getLogs`. A different free endpoint via the existing `ETH_RPC_URL` setting is needed.
3. **Robinhood contract source**: public Blockscout 403 from CI; `BLOCKSCOUT_API_KEY` (existing optional setting) or another approved explorer is needed for mint/admin proof.
4. **Arc contract source**: no explorer API configured for Arc, so Arc mint/admin stay bytecode-only (`NOT_PROVEN`).
5. **Unreviewed venues** (Ramses V3, Aero Slipstream, Synthra Arc V3): no history or exit until they are reviewed into the Liquidity & Exit engines.
6. **Production wiring**: the engine is shadow-only. Running it inside the public request path would add ~100 s cold work; the safe option is an owner decision (existing CI probe as a scheduled run, or a separately reviewed background slot). The Info button text is produced but not shown anywhere.

## Release status

IMPLEMENTED: yes. TESTED: 42 new engine tests + 15 #277 tests; full Node 22 + Redis `npm test` 1352/1353 locally (only failure is the network-dependent `exitquote` test, which also fails on plain main in this sandbox) and green in CI on every commit. SHADOW VERIFIED: yes (read-only CI probe). MERGED: no. DEPLOYED: no. PRODUCTION VERIFIED: no.
