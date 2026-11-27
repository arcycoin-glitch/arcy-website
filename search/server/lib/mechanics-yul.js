'use strict';
// #337 (TENDIES 4663:0x4524…fcf9): a Sourcify record whose chain, address and exact runtime bytecode match the deployed contract
// but which is a hand-written Yul object without a Solidity ABI. Used only to name that failure precisely; mechanics-deep's
// validateSource stays byte-identical (PR26 freeze) and the field stays NOT_VERIFIED.
const CODE=/^0x(?:[0-9a-f]{2})+$/i;
function matchedYul(d,{chainId,address,code}){
 return String(d?.chainId)===String(chainId)&&typeof d?.address==='string'&&d.address.toLowerCase()===String(address).toLowerCase()&&
  ['match','exact_match'].includes(d?.runtimeMatch)&&CODE.test(code||'')&&d.runtimeBytecode?.onchainBytecode?.toLowerCase()===code.toLowerCase()&&
  String(d.compilation?.language||'').toLowerCase()==='yul'&&!Array.isArray(d.abi);
}
// Reviewed exact-runtime Yul sources (complete runtime review, #337 / #355). Keyed by the same source digest mechanics-deep uses.
// f2e77c7e…: NoxaFunTokenV15 (TENDIES 4663:0x4524…fcf9), solc 0.8.30 IR, runtimeMatch=match. Verbatim review of the runtime object:
// exactly 5 sstore — approve allowance, transferFrom allowance decrement, fun_transfer cumulative tx.origin buy counter, balance
// debit and balance credit of the SAME value (single Transfer(from,to,value) log); no runtime write to totalSupply (constructor-only
// mint); no call/delegatecall/callcode/selfdestruct/create; one read-only staticcall getPool(this,pairToken,poolFee) to the
// immutable dexFactory; every parameter is an immutable; no owner/admin storage and no setter selector. Launch-block and
// launchBlock < number <= restrictionEndBlock buy limits (max wallet, cumulative buy) can revert; they never deduct.
const REVIEWED=Object.freeze({'f2e77c7eb10de049e0e7d13c779c1240b4f9ac7e9fd78c85634a6cfe4e955525':'IMMUTABLE_LAUNCH_RESTRICTIONS'});
function digestOf(sources){return require('node:crypto').createHash('sha256').update(JSON.stringify(Object.entries(sources||{}).map(([p,x])=>[p,x?.content]).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
// Returns a checked-source object (same shape mechanics-deep uses) only for a matched AND reviewed Yul record; null otherwise.
function reviewed(d,opts){
 if(!matchedYul(d,opts)||!d.sources||!Object.values(d.sources).every(x=>typeof x?.content==='string'))return null;
 const digest=digestOf(d.sources);if(!Object.hasOwn(REVIEWED,digest))return null;
 return {abi:[],digest,runtimeMatch:d.runtimeMatch,compilation:d.compilation,immutableReferences:d.runtimeBytecode?.immutableReferences,reviewedYul:REVIEWED[digest]};
}
module.exports={matchedYul,reviewed,REVIEWED,digestOf};
