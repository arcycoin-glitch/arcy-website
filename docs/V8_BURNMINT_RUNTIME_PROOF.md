# Reviewed BurnMint runtime evidence — 27 October 2026

## Proof boundary
Robinhood LINK (chain4663,0x492641f648a4986844848e0befe66d14817bce34) has no Sourcify upload; its explorer source route is403. No claim that a testnet token is the mainnet token is made. A different verified deployment supplies source dependencies, and the COMPLETE parent runtime is locally recompiled and compared to the exact current token runtime.

Reference: https://sourcify.dev/server/v2/contract/421614/0xa8c0c11bf64af62cdca6f93d3769b88bdd7cb93d?fields=all . Reference contract is BurnMintERC677Helper; the independently compiled target is its parent src/v0.8/shared/token/ERC677/BurnMintERC677.sol:BurnMintERC677, NOT the helper and not its unrestricted drip(). All17transitive sources were reviewed, including ERC677, ERC20Burnable, owner proposal/acceptance and EnumerableSet. Sources are used for analysis; no third-party source or full compiled bytecode is redistributed. The registry stores only a fingerprint and compiler-declared immutable locations, plus public reference provenance. Parent source is MIT; an inherited ERC677 file is marked UNLICENSED, so no blanket MIT-license claim is made for the source bundle. No restricted commercial API or copied website article is used.

Exact compiler0.8.19+commit.7dd6d404, optimizer enabled26000runs, Paris EVM, metadata bytecodeHash:none. Full runtime7756bytes, including terminal metadata, equals deployed code after zeroing ONLY compiler-declared immutable words:
- decimals:start625,length32; upper bits must encode0..36.
- maxSupply:start1095/2243/2285,length32each; all copies must match.
No metadata stripping, opcode approximation, source-name match or selector-only validation. Full normalized SHA256(bytes):f7d5d6b4b79d57aa53c042cabe1dc571d89908566c23cf0d698566235f7ed593.
Full transitive source digest:817024e6aba5757bf907b1fccd09ee06cc83ed2caf620f3ec7e9463a70fe6558 (existing mechanics-deep.digest convention).

Reproduction: fetch the public verified reference JSON; obtain exact solc0.8.19 in an isolated development directory; save exact target eth_getCode JSON. Run:
node scripts/verify-reviewed-burnmint.cjs reference.json /absolute/path/to/solc/module token-rpc-code.json
The offline script checks reference identity/runtime verification, recursively closes imports, recompiles the parent, verifies immutable offsets/source digest/whole-runtime fingerprint, then checks the target. Production does not install/run a compiler or download this reference source.

## Field evidence
- Trading Taxes: Transfer0% only. Complete ERC20/_transfer moves the full amount. transferAndCall callbacks or pool/hook restrictions may revert; external buy/sell fees are NOT VERIFIED.
- Mint: mint() is onlyMinter, validAddress and optional immutable-cap constrained. getMinters() enumeration is bounded32; up to4members are independently checked with isMinter() at the same pinned block. maxSupply getter must match the runtime immutable. No transaction execution or universal mint-at-this-instant guarantee.
- Owner/Admin: exact onlyOwner grant/revoke of mint/burn roles plus current owner(). External bridge reserve, multisig/timelock membership, DEX or other-contract authority is not inferred. Stronger role semantics replace only the former getter-only row; old observations remain in evidence.
- Architecture retains existing conservative whole-runtime non-delegation evidence. Proxy targets must still pass existing execution binding before implementation analysis applies.
- Burn/buyback remain detailed observations: onlyBurner gates supply-reducing burn and burnFrom. Capability is not an actual burn, unlock, circulating supply or buyback claim.

New read-only live proof at block0x5ebaa02 established exact runtime match, transfer0 and current minter membership. Actual runtime immutable cap1,000,000,000 tokens at18decimals was READ, not hardcoded into the analyzer.

## Validation and release
Focused60/60PASS; full540/554PASS with SAME14historical failures, baseline main530/544. New negative tests mutate executable/metadata bytes, corrupt repeated immutables, supply invalid decimals, omit runtime review, deny membership and reject generic synthetic selectors. New source is generic by compiled-runtime fingerprint, no token/chain-address override. ARCY3/3/0 and ONDO custody evidence unchanged; Tether permission gate remains CLOSED.
Local actual nine-token browser/API desktop passed Mechanics36/36 versus production34/36; Supply18/36 unchanged. Final mobile/Preview results will be added to progress. Source-backed counts do not mean all buy/sell fees are verified: only ARCY selected launch-pool buy/sell evidence remains established; eight other rows are transfer-only. Source upload on Robinhood remains unavailable, but its execution semantics now have independent local recompilation proof.

## Exact integrated Preview outcome
READY Preview27c5ca71f321b14395d6c1ef31880837d7d92741 / dpl_BJboSLM6TFPEuLxDjLvmotUvLhkX at https://arcy-official-4sp5rzoy2-arcy3.vercel.app . This includes the exact currently deployed approved compact three-network UI(a691b70) with zero UI diff. Actual nine-token desktop1440/mobile390 browser/API18/18 checks PASS, no mocks. Seven responsive widthsPASS; additional LINK Previous/Next, keyboard and row geometry testsPASS. Original Preview Mechanics and Search preserve ARCY3/3/0, at blocks0x1ada022/0x1ada02d respectively (different actual blocks retained).
Do NOT overstate batch coverage: local source-backed36/36 became35/36 on BOTH integration Preview viewports because TOLLY ownerAdmin hit Arc RPC_RATE_LIMIT. LINK is4/4 on both. Single paired diagnostic at SAME block0x1ad9f5f showed unchanged production also failing TOLLY owner on429 while Preview returned Pool setup completed. This is external provider variability, not invented no-owner data or a new code regression. Eight source-backed tax rows still cover only ordinary token transfer; external DEX buy/sell unknown. All eighteen Supply missing circulation/unlock rows remain correctly unverified; Tether gate stays closed.
Integrated focused72/72PASS; full552/566PASS,14same historical failures against updated-main542/556. Public evidence preserves ALL batch outcomes plus paired failure/recovery: docs/audits/V8_RECOMPILED_RUNTIME_PREVIEW_20261027.json. No failure was dropped or silently replaced. A later production run must report its actual observed counts, not automatically claim36/36.
