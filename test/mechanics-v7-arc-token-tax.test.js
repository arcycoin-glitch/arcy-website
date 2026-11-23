'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deep=require('../search/server/lib/mechanics-deep');
const reviewed=require('../lib/mechanics-hook').reviewed;
const TOKEN='0x'+'11'.repeat(20),BLOCK='0x1234',digest='2fe87a0ede258f1d3827f837a1a42c860542e346867f64fe5c89fdb7feefe90b';
const word='0x'+'0'.repeat(64);
function options(runtimeMatch='match'){
 return {network:'arc',address:TOKEN,block:BLOCK,sourceLoader:async()=>({digest,abi:[],runtimeMatch,sourceAssurance:'EXACT_DEPLOYED_BYTECODE_MATCH'}),
  rpc:async(method,params)=>{
   assert.equal(params.at(-1),BLOCK);
   if(method==='eth_getCode')return '0x600160005500';
   if(method==='eth_getStorageAt')return word;
   if(method==='eth_call')return word;
   throw Error(method);
  }};
}
test('direct Arc fixed-supply token certifies fee-free successful token transfers, not Arc hook fees',async()=>{
 const r=await deep.inspect(options()),f=r.fields.tradingTaxes;
 assert.equal(f.value,'Buy 0% · Sell 0% · Transfer 0% · token fees only (DEX/hook fees excluded)');
 assert.equal(f.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(f.evidence[0].taxProofClass,'REVIEWED_FULL_EXECUTION_NO_TOKEN_DEDUCTION');
 assert.equal(f.evidence[0].tokenTax.maxWalletRestriction,'MAY_REVERT');
 assert.equal(f.evidence[0].tokenTax.externalFees.hook,'NOT_VERIFIED');
});
test('existing Arc reviewed portal/hook tax dominates independent token-only 0% finding',async()=>{
 const prior={value:'Buy 1% · Sell 1% · Transfer 0%',dataState:'DATA_FOUND',status:'SOURCE_REPORTED',
 source:'Sourcify / Arc RPC',chainId:5042,network:'arc',
 evidence:[{chainId:5042,address:TOKEN,block:BLOCK,
  hook:'0x'+'33'.repeat(20),hookSourceDigest:reviewed.hook,portalSourceDigest:reviewed.portal,
  runtimeMatch:'REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY'}]};
 const r=await deep.enrich({...options(),card:{fields:{tradingTaxes:prior}}});
 assert.equal(r.fields.tradingTaxes.value,prior.value);
 assert.equal(r.fields.tradingTaxes.status,prior.status);
 assert.ok(r.fields.tradingTaxes.evidence.some(e=>e.retainedFrom==='Additional validated observation; existing displayed value preserved'));
});
test('Arc fixed token cannot infer all-direction 0% from unreviewed runtime identity',async()=>{
 const r=await deep.inspect(options('UNKNOWN'));
 assert.equal(r.fields.tradingTaxes.value,'Transfer 0% · DEX/hook fees NOT VERIFIED');
 assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE');
});
