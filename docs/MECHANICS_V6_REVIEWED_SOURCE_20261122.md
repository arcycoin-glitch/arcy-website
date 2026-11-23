# V6 reviewed-source additions and evidence precision

This change extends the existing digest profiles. It adds no address/symbol rules, profile RPC selectors, storage slots,
network providers or public UI rows. FOBO, TAO, YFI, CVX, LDO, SKY, DELTA and HMM keep their existing profiles.

## Newly reviewed execution path: GnosisToken

| Identity | Value |
|---|---|
| Network / chain | Ethereum / 1 |
| Contract | `0x6810e776880c02933d47db1b9fc05908e5386b96` |
| Pinned live probe | `0x193f294` / 26473108 |
| Full source digest | `1d7a05b0de7c2f71ce081d8a80a381973dbd7749e6eef357b033aac690166ee8` |
| Runtime keccak256 | `0xe648613a94b5db10fc0bb665e7e9961440a9d75876ddc9b3dbec1f9e0e2dc43a` |
| Compiler | `solc 0.4.10+commit.f0d539ae` |
| Method | Sourcify source record identity + exact equality of record `runtimeBytecode.onchainBytecode` and pinned `eth_getCode`, then complete-source path review |

Source: [complete Sourcify record](https://sourcify.dev/server/v2/contract/1/0x6810e776880c02933d47db1b9fc05908e5386b96?fields=abi,sources,compilation,runtimeBytecode).
The full source content is preserved in `test/fixtures/mechanics-v6/gnosis-source.json`; its digest is tested.
The downloaded record reports `runtimeMatch: match`, an accepted Sourcify status in the existing validator. This does
not bypass chain/address/runtime checks or use an ABI-only classification.

The constructor allocates a fixed ten million units at 18 decimals and validates the allocation total. `owners[]`
contains allocation recipients; it is not an administrative role. The complete runtime has only transfers, approval
and getters. There is no future supply-increase path, token administrator, transfer restriction, fee deduction,
reflection, callback, burn entry point or upgrade path. Absence findings require a direct non-delegating runtime.

Gain: one previously unreviewed contract; mint and owner/admin facts, supplementary restriction absence and token
transfer-tax evidence. Transfer-only evidence remains **partial** and is not counted as a complete Buy/Sell/Transfer
tax answer. The new profile needs **zero** extra RPC reads after the existing runtime/source verification.

## Tax execution precision

SPX uses complete-source digest `b898a411f0d2a803636e5fdc63e79ceadd4bc5495fd76c4e88c0014d54605cad`.
Source: [Sourcify SPX record](https://sourcify.dev/server/v2/contract/1/0xe0f63a424a4439cbe457d80e4f4b51ad25b2c56c?fields=abi,sources,compilation,runtimeBytecode).

The next ordinary pair buy increments `_buyCount` before computing its fee. At count 69 and threshold 69, the buy rate
is already 0%, while a wallet transfer remains 15% and a sell remains 70%. The previous implementation incorrectly
used the pre-increment buy count for all directions. Sell tax changes only after the strict sell threshold is passed.
The same eight layout-checked pinned storage reads prove these rates; the budget is unchanged.

Evidence now also records floor rounding, owner-endpoint exemption, the contract-origin sell exception, and the
important distinction that `_isExcludedFromFee` skips buy limits/counter updates **without** bypassing fee deduction.
Collected tokens are held by the token and swapped to ETH for the tax wallet. This is neither reflection nor buyback
nor burn. Pool and hook fees remain separately NOT VERIFIED.

Torch uses complete-source digest `ca5d5fac92a6000b4bcc5e5f5de8f68d62d7264b57738b2a918cacb23e365109`.
Source: [Sourcify Torch record](https://sourcify.dev/server/v2/contract/4663/0x000050e18ffa3f8f7ad170eb9cef160eb3ed1111?fields=abi,sources,compilation,runtimeBytecode).
Its existing three pinned getters still establish the current token buy rate. Evidence distinguishes the immutable
timestamp decay schedule, factory-recipient exemption, zero-value and mint bypass, and token event accounting of the
70/30 creator/router split. The external fee router's actual payout, burn or buyback execution and V4 hook fees remain
NOT VERIFIED. A pool-manager-origin token tax is not a V4 hook fee.

These changes improve two existing tax findings and correct a boundary case; they do not invent a newly verified
percentage for another contract. No generic reflection, arbitrary marketing fee, unreviewed hook or proxy fee rule
is inferred from names/selectors.

## Mint and burn proof levels

Reviewed mint evidence records separately: runtime function presence, authority-source identification, verified
authority identifier, verified authorized accounts, current usability, and permission revocation. Constraints retain
cap/remaining capacity separately. No positive executable-mint claim is made without execution evidence.

- CCIP/TAO proves role identifiers and cap state, not current role membership. A full cap prevents positive issuance
  now; it does not revoke the role and burns can restore capacity. The CCIP registry admin is not token mint authority.
- YFI proves the governance address and governance-managed minter mapping, not the mapping's complete membership.
- CVX proves the current operator and supply capacity, while the external operator-refresh governance stays unreviewed.
- LDO proves the controller identity and its mint/arbitrary-holder-destroy capabilities. The controller contract's
  own ability to authorize execution remains NOT VERIFIED.
- SUPER distinguishes an active owner identity from irreversible owner-zero revocation of its only mint authority;
  remaining capacity is not inferred without pinned supply.
- PAXOS separates supply-controller identity from its external execution and replaceable proxy implementation.
- Constructor-only fixed-supply sources record runtime mint function absence, rather than permission revocation.

Burn details distinguish BEAM/LDO arbitrary-holder destruction without allowance from FOBO approved-spender burn and
CCIP BURNER_ROLE burnFrom, which still consumes allowance. Capability does not imply verified active burner membership.
BEAM count/member observations are reused only for the same source digest and pinned block. A missing admin enumeration
does not become a claim that a current admin can grant roles. MiniMe rejects noncanonical boolean values for the
`transfersEnabled` observation.

Validation: 26 focused tests passed (`mechanics-v6-reviewed-evidence`, `mechanics-reviewed-tokens`, `mechanics-v6`). The
full-suite, paired-replay and fixed-cohort totals are reported by the parent engineering audit, not inferred here.
