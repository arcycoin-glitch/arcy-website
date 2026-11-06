# Contract & Mechanics — final pass (2026-11-06)

Baseline: main = Vercel Production `aaabf00` (PR #167, #168, #169 merged). PR #170 (Pulse) untouched.
Cohort: the fixed 38 contracts in `scripts/mechanics-audit-cohort-20261105.json` (audit branch `audit/mechanics-final-20261106`).

## Production baseline (public API, run 42186063943)
| Network | API DATA_FOUND | Complete UI rows |
|---|---|---|
| Arc (9 measured, syrupUSDC skipped by holder-queue guard) | 24/36 | 22/36 |
| Ethereum | 18/40 | 17/40 |
| Robinhood | 26/40 | 21/40 |
| Pons | 32/32 | 24/32 |

Pons: all PR #168 sibling gains are visible in Production (8/8 tokens, four fields). The tax row is
"Transfer 0% · DEX/hook fees NOT VERIFIED" by design, so it is not a complete UI row.
ARGUS: Production shows Buy 1% · Sell 1% · Transfer 0% and the mint row renders as NONE DETECTED (PR #169).

## Change: reviewed exact-source profiles (`search/server/lib/mechanics-reviewed-tokens.js`)
Keyed only by the full Sourcify source digest. Source text was read from Sourcify in CI
(`scripts/probe-mechanics-sources.cjs`, run 42186634991) and reviewed line by line.

| Token | Digest | Finding |
|---|---|---|
| PEPE (ETH) | fc4c77a3… | No fee code; constructor-only mint; holder self-burn; owner 0x0 ⇒ blacklist/setRule frozen (existing blacklist entries stay blocked) |
| SPX6900 (ETH) | b898a411… | Launch tax 15%/70% decays to final 0%/0% once the buy counter passes the thresholds; read from 8 pinned storage slots with layout anchors (fail closed); owner 0x0; fee wallet can only swap contract-held fees; constant supply |
| SUPER (ETH) | 0e3f0eca… | OZ 3.x ERC20Capped; owner can mint up to cap; full-value transfers |
| BEAM (ETH) | df2d7e98… | MINTER_ROLE mint (no cap); BURNER_ROLE can burn ANY holder's tokens without approval; role counts reuse the existing bounded enumeration |
| MowCat MOW (RH) | ed77a6f1… | Fixed supply, no admin, no fees |
| TorchToken TORCH (RH) | ca5d5fac… | Immutable buy tax (2% now) on tokens leaving a recognised pool, paid to the fee router; sell/transfer 0%; no owner |

Absence/authority claims require a direct non-delegating runtime. Token tax is always separated from pool/hook fees.

## Validation (run 42187807677 / 42187807695)
- Paired replay gate PASS on 62 contracts (standard bench samples + cohort), replay complete:
  tax 36→41, mint 36→41, owner/admin 45→49, architecture 58→58. No verified field lost or rewritten.
- Extra requests: +11 RPC reads (all `augReviewed`, 2 contracts, ≤8 each), 0 Sourcify, 0 GoPlus, 0 explorer.
- Suite: 1026 pass / 0 fail / 2 skipped (CI). Locally 1026/1026.
- Cohort in-process (fix branch): Ethereum 18→28 API, 17→24 UI; Robinhood 26→32 API, 21→26 UI; Pons unchanged 32/24.
  Arc code is unchanged; Arc runs vary 21–25 with public RPC HTTP 429.

## Remaining NOT VERIFIED (external limitations, not reworked)
- Arc FAZE, AF, oBrain, syrupUSDC, LONG implementation: no Sourcify source (Blockscout fallback needs operator approval).
- Arc public RPC rate limiting (HTTP 429) makes Arc per-run results noisy; failures stay fail-closed.
- Ethereum DACITY, GDLR: no verified source. XAUt, PAXG: proxy delegation proven, implementation source not reviewed (Tether source gate stays closed).
- Robinhood BONER: no Sourcify source; delegating runtime without standard slots. CASHCAT: published source does not match deployed bytecode. Anthropic: no verified source.
- Buy/sell for plain no-fee tokens stays "DEX/hook fees NOT VERIFIED": pool and hook fees are not token taxes.
