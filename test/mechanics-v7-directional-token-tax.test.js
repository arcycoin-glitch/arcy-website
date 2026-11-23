'use strict';
// Exact-runtime, complete-execution tax proof tests. We never infer buy/sell 0 from
// a transfer getter, ABI name, proxy selector or an unreviewed callback.
const test=require('node:test'),assert=require('node:assert/strict');
const mechanics=require('../search/server/lib/mechanics-deep');
const reviewed=require('../search/server/lib/mechanics-reviewed-tokens');
const policy=require('../search/mechanics-policy');
const TOKEN='0x'+'11'.repeat(20),BLOCK='0x1234',DIRECT='0x600160005500';
const digestFor=p=>Object.entries(reviewed.PROFILES).find(([,name])=>name===p)?.[0];
const fixtures=(profile,{runtime=DIRECT,runtimeMatch='exact_match',directSource=true}={})=>{
 const calls=[],digest=digestFor(profile);
 const rpc=async(method,params)=>{
  calls.push({method,params});assert.equal(params.at(-1),BLOCK);
  if(method==='eth_getCode')return runtime;
  if(method==='eth_getStorageAt')return '0x'+'0'.repeat(64);
  if(method==='eth_call')throw Object.assign(Error('execution reverted'),{code:3});
  throw Error(method);
 };
 return {calls,network:'ethereum',address:TOKEN,block:BLOCK,rpc,
  sourceLoader:async()=>directSource?({digest,abi:[],runtimeMatch}):null};
};
test('all-direction 0% requires digest-reviewed complete transfer path + direct pinned runtime',async()=>{
 for(const profile of ['FIXED_SUPPLY_LEGACY_ALLOCATION','FIXED_SUPPLY_OZ_BURNABLE','FIXED_SUPPLY_NO_ADMIN','FIXED_SUPPLY_SELF_BURN','GOVERNANCE_MINTER_SET','OPERATOR_SCHEDULED_CAPPED_MINT']){
  const f=fixtures(profile),r=await mechanics.inspect(f);
  const t=r.fields.tradingTaxes;
  assert.equal(t.value,'Buy 0% · Sell 0% · Transfer 0% · token fees only (DEX/hook fees excluded)',profile);
  assert.equal(t.status,'VERIFIED_SOURCE_AND_STATE');
  assert.equal(t.evidence[0].coverage,'TOKEN_TAX_ALL_TRANSFERS');
  assert.equal(t.evidence[0].taxProofClass,'REVIEWED_FULL_EXECUTION_NO_TOKEN_DEDUCTION');
  assert.equal(t.evidence[0].directRuntime,true);
  assert.equal(t.evidence[0].sourceDigest,digestFor(profile));
  assert.equal(t.evidence[0].runtimeMatch,'exact_match');
  assert.deepEqual([t.evidence[0].tokenTax.buy,t.evidence[0].tokenTax.sell,t.evidence[0].tokenTax.transfer],['0','0','0']);
  assert.equal(t.evidence[0].tokenTax.externalFees.dex,'NOT_VERIFIED');
  assert.equal(t.evidence[0].tokenTax.externalFees.hook,'NOT_VERIFIED');
  assert.equal(t.evidence[0].tokenTax.externalFees.router,'NOT_VERIFIED');
  assert.deepEqual(policy.assess({fields:{tradingTaxes:t}},{network:'ethereum',chainId:1,address:TOKEN,block:BLOCK}).rows,[true,false,false,false]);
 }
});
test('unreviewed controller callbacks and restrictions remain transfer-only, never buy/sell zero',async()=>{
 for(const p of ['MINIME_CONTROLLED','PAXOS_SUPPLY_CONTROLLED','OWNER_RULES_BLACKLIST_FIXED_SUPPLY']){
  const r=await mechanics.inspect(fixtures(p));
  const t=r.fields.tradingTaxes;
  assert.equal(t.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');
  assert.equal(t.status,'VERIFIED_SOURCE');
  assert.equal(t.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');
  assert.equal(t.evidence[0].tokenTax.buy,'NOT_VERIFIED');
 }
});
test('non-direct or unknown-source execution never qualifies for all-direction 0%',async()=>{
 const clone=await mechanics.inspect(fixtures('FIXED_SUPPLY_OZ_BURNABLE',{runtime:'0x6000f4'}));
 assert.equal(clone.fields.tradingTaxes,undefined,'DELEGATECALL alone is not an audited direct fee path');
 const noSource=await mechanics.inspect(fixtures('FIXED_SUPPLY_OZ_BURNABLE',{directSource:false}));
 assert.equal(noSource.fields.tradingTaxes,undefined);
});
test('unknown runtimeMatch cannot generate a strong proof, even with a reviewed source digest',async()=>{
 const r=await mechanics.inspect(fixtures('FIXED_SUPPLY_OZ_BURNABLE',{runtimeMatch:'UNREVIEWED'}));
 assert.equal(r.fields.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');
 assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE');
});
