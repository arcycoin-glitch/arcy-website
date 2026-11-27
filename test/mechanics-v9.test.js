'use strict';
// Mechanics V9: reviewed-source additions proven on real contracts (FLOCK on Robinhood, API3 on Ethereum). Every value is bound to the
// complete source-bundle digest; absence of evidence never becomes a verified claim.
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const forensics=require('../search/server/lib/mechanics-v8-forensics');
const keccak=require('../lib/keccak');
const sel=s=>keccak(Buffer.from(s)).slice(0,10);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const block='0x1234',code='0x600160005500',TOKEN='0x1111111111111111111111111111111111111111';
const OWNER='0x2222222222222222222222222222222222222222',E18=10n**18n;
const FLOCK='44f9395ff609b012cff940ff06d4ebd486196ea888c42af96af73b7fe62e40a7',TAO='7aa78076f05db2951a641af2664d5c88cf0296e5551dc05b6890ddf1555f73f7',API3='667726c81d43fa7fa2157e26dda00ab03b4a4119c593f05ad950f3d36fd77649';
function fixture(digest,{calls={},network='ethereum'}={}){
 const log=[];
 const rpc=async(method,params)=>{
  log.push({method,params});assert.equal(params.at(-1),block,'every read is pinned');
  if(method==='eth_getCode')return code;
  if(method==='eth_getStorageAt')return word(0);
  if(method==='eth_call'){const v=calls[params[0].data.slice(0,10)];if(v===undefined)throw Object.assign(Error('execution reverted'),{code:3});return v;}
  throw Error('Unexpected '+method);
 };
 return {log,options:{network,address:TOKEN,block,rpc,sourceLoader:async()=>({digest,abi:[],runtimeMatch:'exact_match',url:'https://sourcify.dev/server/v2/contract/1/'+TOKEN,retrievedAt:'2026-11-26T09:00:00Z'})}};
}
async function inspect(x){let extra=null;const r=await deep.inspect({...x.options,onSupplementary:s=>{extra=s;}});return {...r,restriction:extra?.transferRestrictions||null};}

test('FLOCK is registered under the already reviewed CCIP BurnMintERC20 profile by its own full bundle digest; unknown digests stay unreviewed',async()=>{
 assert.equal(reviewed.PROFILES[TAO],'CCIP_BURN_MINT_ROLE_TOKEN');
 assert.equal(reviewed.PROFILES[FLOCK],'CCIP_BURN_MINT_ROLE_TOKEN');
 assert.notEqual(FLOCK,TAO,'different bundle path layout, therefore a separately pinned digest');
 const base={[sel('MINTER_ROLE()')]:keccak(Buffer.from('MINTER_ROLE')),[sel('BURNER_ROLE()')]:keccak(Buffer.from('BURNER_ROLE')),[sel('maxSupply()')]:word(1000n*E18),[sel('totalSupply()')]:word(400n*E18),[sel('decimals()')]:word(18),[sel('getCCIPAdmin()')]:addr(OWNER)};
 const r=await inspect(fixture(FLOCK,{network:'robinhood',calls:base}));
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
 assert.equal(r.fields.tradingTaxes.evidence[0].sourceDigest,FLOCK);
 assert.equal(r.fields.tradingTaxes.evidence[0].tokenTax.externalFees.hook,'NOT_VERIFIED');
 assert.equal(r.fields.mintCapability.value,'Role-gated mint · cap 1,000 · 600 remaining');
 assert.match(r.fields.mintCapability.evidence[0].scope,/not enumerable/);
 const wrongRole=await inspect(fixture(FLOCK,{network:'robinhood',calls:{...base,[sel('MINTER_ROLE()')]:word(1)}}));
 assert.notEqual(wrongRole.fields.mintCapability?.status,'VERIFIED_SOURCE_AND_STATE','a non-standard role hash fails closed');
 const other=await inspect(fixture('0'.repeat(63)+'1',{network:'robinhood',calls:base}));
 assert.notEqual(other.fields.tradingTaxes?.value,'Buy 0% · Sell 0% · Transfer 0%','an unreviewed digest never receives the reviewed claim');
});

test('API3 with the real dead-address owner: minter set is frozen, current minters are NOT claimed, tax proof is unchanged',async()=>{
 const DEAD='0x000000000000000000000000000000000000dead';
 const r=await inspect(fixture(API3,{calls:{[sel('owner()')]:addr(DEAD)}}));
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
 assert.equal(r.fields.mintCapability.value,'Minter set frozen · owner is the dead address · current minters not enumerated');
 const m=r.fields.mintCapability.evidence[0].mintAuthority;
 assert.equal(m.constraints.ownerCanChangeMinterSet,false);assert.equal(m.authorizedAccountsVerified,false);assert.equal(m.currentUsability,'NOT_VERIFIED');assert.equal(m.permissionRevoked,'NOT_VERIFIED');
 assert.match(r.fields.mintCapability.evidence[0].scope,/NOT claimed/);
 assert.doesNotMatch(r.fields.mintCapability.value,/NONE|disabled|no mint/i,'a frozen owner never proves that minting is disabled');
});

test('API3 (OZ 3.x ERC20 + Api3Token): strict zero token-side tax, owner-managed uncapped minters, self-declared burner; no claim when owner() is unavailable or zero',async()=>{
 assert.equal(reviewed.PROFILES[API3],'OWNER_MINTER_STATUS_SELF_BURN');
 assert.equal(forensics.PROFILES?.OWNER_MINTER_STATUS_SELF_BURN?.rule??'HOLDER_BALANCE_WITH_SELF_DECLARED_BURNER_STATUS','HOLDER_BALANCE_WITH_SELF_DECLARED_BURNER_STATUS');
 const ok=await inspect(fixture(API3,{calls:{[sel('owner()')]:addr(OWNER)}}));
 const t=ok.fields.tradingTaxes;
 assert.equal(t.value,'Buy 0% · Sell 0% · Transfer 0%');
 assert.equal(t.evidence[0].coverage,'TOKEN_TAX_ALL_TRANSFERS');assert.equal(t.evidence[0].tokenTaxScope,'TOKEN_CONTRACT_ONLY');
 assert.equal(t.evidence[0].sourceDigest,API3);assert.equal(t.evidence[0].tokenTax.externalFees.dex,'NOT_VERIFIED');
 assert.equal(ok.fields.mintCapability.value,'Owner-managed minters · uncapped');
 const m=ok.fields.mintCapability.evidence[0].mintAuthority;
 assert.equal(m.authority,OWNER);assert.equal(m.authorizedAccountsVerified,false,'minter mapping is not enumerated');assert.equal(m.currentUsability,'NOT_VERIFIED');
 assert.match(ok.fields.mintCapability.evidence[0].scope,/renounceOwnership\(\) always reverts/);
 assert.equal(ok.fields.ownerAdmin.value,'Owner: '+OWNER);
 for(const bad of [{},{[sel('owner()')]:word(0)}]){
  const r=await inspect(fixture(API3,{calls:bad}));
  assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%','tax proof is source-only and does not need owner()');
  assert.notEqual(r.fields.mintCapability?.value,'Owner-managed minters · uncapped','state-derived mint claim fails closed');
 }
});

const MSS2='e307a028f221cce924c89ee05d3a028fd48159c1da26af553661414c9a21cffa';
test('MSS2 digest-pinned profile: token-side zero deduction only; no mint/owner claim; unreviewed digest or delegating runtime gets nothing',async()=>{
 assert.equal(reviewed.PROFILES[MSS2],'UPDATE_GATE_FULL_AMOUNT_TOKEN');
 const r=await inspect(fixture(MSS2,{calls:{}}));
 assert.equal(r.fields.tradingTaxes.value,'Buy 0% · Sell 0% · Transfer 0%');
 const ev=r.fields.tradingTaxes.evidence[0];
 assert.equal(ev.sourceDigest,MSS2);assert.equal(ev.tokenTax.scope,'TOKEN_CONTRACT_ONLY');assert.equal(ev.tokenTax.externalFees.hook,'NOT_VERIFIED');
 assert.match(ev.scope,/denial, not a deduction/);assert.match(ev.scope,/not asserted/);
 assert.equal(r.fields.mintCapability?.status==='VERIFIED_SOURCE_AND_STATE'&&/NONE|disabled/i.test(r.fields.mintCapability.value),false,'no absence-of-mint claim');
 const other=await inspect(fixture('0'.repeat(63)+'2',{calls:{}}));
 assert.notEqual(other.fields.tradingTaxes?.value,'Buy 0% · Sell 0% · Transfer 0%');
});

test('Yul verified source with non-array ABI gets a stable unsupported-language reason, never a bypass',()=>{
 const vs=require('../lib/verified-source');
 const A='0x'+'1'.repeat(40),code='0x6001';
 const base={chainId:require('../lib/core').CHAIN,address:A,runtimeMatch:'match',runtimeBytecode:{onchainBytecode:code},sources:{'a.yul':{content:'x'}}};
 const y=vs.validate({...base,compilation:{language:'Yul'},abi:{}},A,code);
 assert.equal(y.reasonCode,'UNSUPPORTED_SOURCE_LANGUAGE_YUL');
 const bad=vs.validate({...base,compilation:{language:'Solidity'},abi:{}},A,code);
 assert.equal(bad.reasonCode,'MALFORMED_VERIFIED_SOURCE','non-Yul malformed records still fail closed');
 assert.equal(vs.validate({...base,compilation:{language:'Yul'},abi:[]},A,code).dataState,'DATA_FOUND','a valid array ABI is never rejected for language alone');
});
