# Mechanics V9 — diagnosis of the 16 non-strict cohort contracts and evidence changes

Baseline: V8 (`fbf570e`, PR #322), immutable 40-subject cohort
(`data/verified-coverage/radar-cohort-20261121.json`), strict 24/40 (60%). The denominator and the
strict rule (`scripts/measure-mechanics-v8.cjs`) are unchanged.

## How the diagnosis was made

`scripts/probe-mechanics-v9-diagnose.cjs` (read-only; CI workflow `mechanics-v9-diagnose.yml`, one job per
contract) records for every contract the deployed runtime shape, standard proxy slots, Sourcify status for the
address and for the clone target, and the shipped engine's own field results and failure reasons.
`scripts/probe-mechanics-v9-source.cjs` prints comment-stripped Sourcify sources and per-file SHA-256 lists so a
reviewer can compare bundles file by file. Measured on 2026-11-25/26 from a GitHub runner (Arc, Ethereum and
Robinhood public RPC, Sourcify v2). No production data, flags or workers were touched.

## Per-contract root cause

| Contract | Chain | V8 class | Measured cause | Kind | V9 |
| --- | --- | --- | --- | --- | --- |
| ARGUS `0xece5…cb3c` | Arc | Partial | EIP-1167 clone of `0x122c…1a`, exact source match; engine shows Buy 1%/Sell 1%/Transfer 0% but the rates belong to the reviewed V3 route (`ARGUS_V3_TOKEN_TAX`), source contains assembly (not template-reviewable) | scoped/conditional fee, **not a bug** | unchanged (Partial) |
| CRA `0x7085…f6f4` | Arc | Partial | clone of `0x1b74…e500` (`ArgusV4LaunchToken7`), hook/pool-scoped fees, reviewed profile `INITIALIZED_REWARD_LAUNCH_TOKEN` | hook fee ≠ token tax | unchanged (Partial) |
| ARCANUS `0x2931…d430` | Arc | Partial | same implementation as CRA | hook fee ≠ token tax | unchanged (Partial) |
| ARCOON `0x4621…4fed` | Arc | Unknown | Sourcify 404; no other permitted source; 3 299-byte non-proxy runtime | **missing evidence** | unchanged (Unknown) |
| FAZE `0x394d…fa2e` | Arc | Unknown | Sourcify 404; 2 665-byte runtime (Ownable selectors visible, no source) | missing evidence | unchanged (Unknown) |
| LONG `0x2164…c752` | Arc | Unknown | EIP-1167 clone of `0x0a8e…ea08`; neither address is verified anywhere | missing evidence | unchanged (Unknown) |
| oBrain `0x28f9…7f01` | Arc | Unknown | Sourcify 404 (AccessControl-style selectors, `supplyCap()`, `factory()`, no source) | missing evidence | unchanged (Unknown) |
| MSS2 `0x091f…3b65` | Arc | Unsupported | exact source (`MintStakeShareOFT`, solc 0.8.30) but staking/mint-curve contract with 168 selectors and inline assembly: execution path not reviewed | engine profile gap (large custom contract) | unchanged (Unsupported) |
| LDO `0x5a98…1b32` | Ethereum | Partial | MiniMe `doTransfer` moves the full amount, but every transfer calls an external controller `onTransfer` that can veto and holds `destroyTokens`/`transferFrom` power | external transfer authorization | unchanged (Partial) |
| AAVE `0x7fc6…dae9` | Ethereum | Partial | transparent proxy; implementation reviewed (`UPGRADEABLE_NO_DIRECT_MINT`), upgradeable by governance executor | token-wide zero tax of an upgradeable implementation is not a permanent fact | unchanged (Partial) |
| API3 `0x0b38…731b88a` | Ethereum | Unsupported | exact source (`Api3Token.sol`, solc 0.6.12), OpenZeppelin **3.x** ERC20 which is not in the pinned 4.x/5.x set (`ERC20_NOT_PINNED`) | engine profile gap | **promoted** (reviewed bundle) |
| STATICS `0x2d8d…eadd` | Robinhood | Unsupported | 44-byte Solady clone; Sourcify 404 for clone and implementation | missing evidence | unchanged |
| AI `0x2e8c…1e18` | Robinhood | Unsupported | same shape as STATICS | missing evidence | unchanged |
| FLOCK `0x5ab3…b691` | Robinhood | Unsupported | exact source, Chainlink `BurnMintERC20` bundle; bundle digest differs from the reviewed TAO digest only by the `node_modules/` path prefix (all 14 file hashes identical) | engine profile gap | **promoted** |
| STONKBROKER `0xe934…b50` | Robinhood | Unsupported | canonical OpenZeppelin 5.6 ERC20+Burnable+Permit `CollectionToken`; template rejected because OZ 5.6 `utils/Bytes.sol` was not pinned (`BANNED_ASSEMBLY`, file `Bytes.sol`) | engine pin gap | **promoted** (generic OZ template) |
| TENDIES `0x4524…fcf9` | Robinhood | Unsupported | exact source is a hand-written Yul object (`NoxaFunTokenExact.yul`): Sourcify record fails the Solidity schema check (`SOURCE_SCHEMA_INVALID`) | unreviewable custom logic | unchanged |

## Paired fixed-cohort result (same pinned block and recorded provider answers per subject)

CI run `45704186825` (commit `acfc788` of this branch vs main `fbf570e`, `BENCH_REPLAY=record|replay|augment`):

| | Verified | Partial | Unknown | Unsupported |
| --- | --- | --- | --- | --- |
| V8 (before) | 24 | 5 | 4 | 7 |
| V9 (after) | **27** (67.5 %) | 5 | 4 | 4 |
| Arc | 2 → 2 | 3 | 4 | 1 |
| Ethereum | 7 → **8** | 2 | 0 | 1 → 0 |
| Robinhood | 15 → **17** | 0 | 0 | 5 → 3 |

Newly verified: **API3** (Ethereum), **FLOCK** and **STONKBROKER** (Robinhood). No verification regression in any of the 64
benchmark rows; one additional non-cohort Robinhood token (`0xb0007d…`) also moved to fully verified through the `Bytes.sol` pin.
Requests: RPC 676 → 678 (+2 budgeted augmentation reads, FLOCK), Sourcify 59 → 59. Latency is `MIXED_REPLAY_WITH_LIVE_AUGMENTATION`:
overall p50 16 ms → 16 ms, p95 93 ms → 153 ms (the single augmented subject); the 39 recorded-only subjects are unchanged
(p95 5 027 ms → 5 027 ms). Authority (unchanged from V8): 1 confirmed upgrade authority, 7 incomplete, 0 truncated graphs;
burn capability verified for 11, burn executions verified 0, buyback executions verified 0.

## What changed

1. **Pinned OpenZeppelin `utils/Bytes.sol`** (releases 5.2.0, 5.4.0, 5.5.0, 5.6.0, 5.7.0) from the published npm tarballs
   (`scripts/collect-oz-hashes.cjs`, CI run over 38 releases). OZ ≥ 5.4 `Strings.sol` imports it, so every canonical
   5.4+ ERC20 stack with `Strings` was rejected for *library* assembly. A look-alike `Bytes.sol` that is not a published
   release file is still rejected (test). Reusable for any token, not only STONKBROKER.
2. **FLOCK** registered under the already reviewed `CCIP_BURN_MINT_ROLE_TOKEN` profile by its own full bundle digest
   (`44f9395f…`). Evidence: all 14 source files byte-identical to the reviewed TAO bundle; exact runtime match and the
   pinned `MINTER_ROLE`/`BURNER_ROLE`/`maxSupply` reads are still required, wrong role hashes fail closed.
3. **API3** reviewed profile `OWNER_MINTER_STATUS_SELF_BURN` (digest `667726c8…`, single file). Token side: `_transfer`
   unmodified, no fee code → zero token-side tax for buys, sells and transfers (DEX/hook fees remain NOT VERIFIED).
   The live owner is the **dead address** (`0x…dEaD`): the minter set can no longer change, but minter membership is a
   private mapping, so the card says *"Minter set frozen · owner is the dead address · current minters not enumerated"*
   and never claims that minting is disabled.

## Not changed on purpose (and why)

- **ARGUS / CRA / ARCANUS** keep the strict distinction between token deductions and hook/pool fees; one verified pool
  is not generalised to all pools.
- **LDO**: a veto through an external controller is a transfer *denial*, not a tax, but the controller callback is
  executable external code with balance-changing powers, so a permanent token-wide zero is not proven.
- **AAVE**: current implementation reviewed, but governance can replace it.
- **Six no-source contracts (ARCOON, FAZE, LONG, oBrain, AI, STATICS)**: no permitted provider holds a source for the
  deployed runtime. No bytecode-only tax claim is made. They are evidence gaps, not engine defects.
- **MSS2, TENDIES**: reviewable only by a full manual source review of a large custom contract / Yul object.
- The Blockscout PRO fallback (PR #74) was not enabled: licence/permission is unresolved and Robinhood Blockscout
  returned HTTP 403 from the CI runner.

## Reproduce

```sh
node scripts/probe-mechanics-v9-diagnose.cjs ARGUS,CRA      # live, read-only, one annotation pair per contract
V9_SOURCE=1 node scripts/probe-mechanics-v9-diagnose.cjs FLOCK
node scripts/probe-mechanics-v9-source.cjs 4663 0x5ab3d4c385b400f3abb49e80de2faf6a88a7b691 'BurnMintERC20\.sol' -1
BENCH_FIXED_COHORT=1 BENCH_REPLAY=record ... # paired benchmark: see docs/MECHANICS_V8_20261124.md
```

## Round 2 — review findings (same PR #324)

Paired fixed-40 result on `86b68b6` (CI run `45710217987`, record/replay/augment, same pinned blocks): **strict 24 → 29/40 (72.5 %)**,
Partial 5 → 4, Unknown 4 → 4, Unsupported 7 → 3. By network: Arc 2 → 3, Ethereum 7 → 9, Robinhood 15 → 17. The 27 round-1 strict
proofs were all preserved (the paired gate rejects any lost or silently changed verified field). Newly verified in this round:

| Contract | Why it is now strict | Limits kept |
| --- | --- | --- |
| **MSS2** (Arc) | Digest-pinned review (`e307a028…cffa`, OZ 5.5.0 ERC20 + LayerZero OFT): the only own override is an `_update` launch gate that can revert; inherited `_update` moves the full amount. Profile `UPDATE_GATE_FULL_AMOUNT_TOKEN` asserts the token-side deduction only. | A pre-launch revert is a denial, not a tax. No mint/owner/bridge claim; pool/hook fees not asserted. Unreviewed digests get nothing. |
| **AAVE** (Ethereum) | Same snapshot policy as MORPHO: strict zero only when `proxyBinding` is complete, `VERIFIED`, and its effective implementation equals the reviewed implementation; proof is flagged `mutable`, `upgradeable`, `snapshotOnly`. | Admin can upgrade; no permanence claim. Incomplete/mismatched path, no admin, or direct runtime stays partial (negative tests). |

Paired gate: a narrow `zeroTaxProxy` variant accepts the partial → strict change only for the same digest/runtime/block with the mutable +
snapshot-only flags and a complete effective binding (9 negative cases in `test/mechanics-bench-gate.test.js`). The generic rule is unchanged.

Still not strict, with the blocker: **LDO** (token source deducts nothing, but the external MiniMe controller is an upgradeable proxy that can
veto transfers and change balances; evidence now lists `tokenSourceDeduction`, `controllerTransferVeto`, `controllerBalanceChanges`,
`controllerLogic: UNRESOLVED`), **ARGUS / CRA / ARCANUS** (hook/pool-scoped or conditional rates; token-level independence not proven),
**TENDIES** (optimized Yul, partial Sourcify match, non-array ABI; the stable `UNSUPPORTED_SOURCE_LANGUAGE_YUL` reason is implemented and
unit-tested, but the recorded benchmark record does not carry a language field, so the benchmark still shows `MECHANICS_SOURCE_IDENTITY_UNVERIFIED`),
**ARCOON, FAZE, LONG, oBrain, AI, STATICS** (no legally usable runtime-bound source found; Sourcify 404, other explorers unlicensed or blocked → UNKNOWN/UNSUPPORTED).

API3 wording softened: a dead-address owner is an observed state ("no known accessible key"), not a cryptographic guarantee; current minters stay unknown.

Cost: RPC 676 → 678, Sourcify 59 → 59 (unchanged from round 1). Latency `MIXED_REPLAY_WITH_LIVE_AUGMENTATION`: overall p50 13 → 13 ms,
p95 77 → 206 ms driven by one augmented Robinhood subject (`0x5ab3d4…`, 14 → 206 ms, +2 requests); 39 recorded-only subjects p50 13 → 13 ms,
p95 5 022 → 5 022 ms. Per network (overall p50/p95 before → after): Robinhood 12/21 → 13/27, Ethereum 11/29 → 11/29, Arc 13/5 026 → 13/5 027.
Authority/burn coverage unchanged: 1 confirmed upgrade authority, 7 incomplete graphs, burn capability verified 11, burn executions 0, buyback executions 0
(no tx-level evidence exists for any; none was inferred).
