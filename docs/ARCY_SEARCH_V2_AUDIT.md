# ARCY Search V2 baseline audit

Audited: 2026-10-09 UTC

## Architecture

The browser performs eight independent request paths per scan: token metadata, supply,
circulating/unlock evidence, holder publications, liquidity summary plus deferred LP
custody, market activity, and contract mechanics. The approved production presentation
has five cards: Supply & Unlock, Holders & Whales, Market & Activity, Liquidity & Exit,
and Contract & Mechanics. Contract-control evidence is part of the compact Mechanics
card and must remain there unless the product owner explicitly approves a layout change.

The durable Railway worker owns holder queue/index/reconciliation/published snapshots.
Vercel only reads signed holder publications and queues work; it never reconstructs holder
history in a user request. Pulse uses the same durable-worker publication pattern.

## Baseline evidence

* Full local regression suite: 178/178 passed when executed outside the filesystem/network
  sandbox required by durable-storage and loopback tests.
* Production browser scan of ARCY completed with 13/20 summary fields evidenced.
* Canonical API timing baseline, ARCY contract, fresh scan: token 2.4s, supply 2.2s,
  holders 0.7s from a COMPLETE publication, market-circulation 4.8s when unsupported,
  liquidity 3.7s, mechanics 7.7s, unlock evidence 4.7s when unsupported, and market
  activity 1.7s.

## Prioritized findings

| Severity | Finding | Affected area | Safe direction |
| --- | --- | --- | --- |
| High | The Token Unlocks calendar is generated at request time from three upstream pages. It has CDN caching but no durable edition, six-hour worker refresh, audit trail, or last-known-good publication. | `api/unlocks.js` | Move collection/persistence to the existing Railway durable worker; Vercel serves a signed latest-good edition and retains it on refresh failure. |
| High | Unsupported circulating supply and next-unlock checks exhaust sequential adapters, increasing perceived Search latency despite returning an honest `NOT VERIFIED`. | `api/market.js`, `api/unlock.js`, `lib/fields.js` | Bound and parallelize independent exact-contract adapters while retaining evidence priority and fail-closed rules. |
| Medium | The canonical domain redirects API requests to `www`; direct probes must follow redirects. Browser scans function correctly, but operational smoke checks must be redirect-aware. | domain configuration / production checks | Retain the canonical redirect; make production tests follow redirects and report the final host. |
| Medium | Mechanics is evidence-heavy and is the slowest ARCY card in the baseline. Its correctness protections are strong; optimization must preserve reviewed-source and pinned-block checks. | `api/mechanics.js`, `lib/control.js`, `lib/verified-source.js` | Profile and coalesce independent reads; do not weaken proxy, tax, or role verification. |
| Low | `lib/redis-config.js` remains for backward-compatible worker storage, while Search request paths read signed publications and do not require Redis. | worker storage modules | Preserve existing durable publication architecture; do not reintroduce Redis into Search critical paths. |

## Deliberately preserved

Pulse weekly editions, holder worker/publications, Search card layout, Hero/video, Buyback
& Burn, Unlocks presentation, Arc Pulse presentation, Swap, analytics, and all existing
source/evidence semantics remain out of scope for visual change.
