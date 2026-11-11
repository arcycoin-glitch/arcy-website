'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ID,apply}=require('../search/server/lib/mechanics-exact-gta6');
const make=()=>({network:ID.network,address:ID.address,source:{
 digest:ID.sourceDigest,runtimeMatch:'match',url:'https://sourcify.dev/server/v2/contract/1/'+ID.address
},fields:{},details:{observations:[]},fact:(value,method,extra,status)=>({
 value,method,status,dataState:'DATA_FOUND',evidence:[extra]
})});
test('exact verified GTA6 source reports source-backed, qualified mechanics with creator-origin control warning',()=>{
 const v=make();assert.equal(apply(v),true);
 assert.equal(v.fields.ownerAdmin.status,'VERIFIED_SOURCE_AND_STATE');
 assert.match(v.fields.ownerAdmin.value,/privileged transferFrom/);
 assert.match(v.fields.ownerAdmin.method,/allowance enforcement/);
 assert.match(v.fields.mintCapability.value,/Constructor-only/);
 assert.match(v.fields.tradingTaxes.value,/Token transfer 0%/);
 assert.match(v.fields.tradingTaxes.evidence[0].scope,/not a safety endorsement/i);
 assert.equal(v.details.observations[0].allowanceRaw,'0');
 assert.equal(v.details.observations[0].simulatedBlock,ID.proofBlock);
});
test('ticker lookalikes, other networks and unreviewed source digests get no special Mechanics claims',()=>{
 for(const mutation of [
  {address:'0x194779473b9964afd1ba05618d38ba8807c93f95'},
  {address:'0x684ac37cbed24f8d3b3e67c0df627747f1a04a51'},
  {network:'robinhood'},
  {source:{digest:'0'.repeat(64),runtimeMatch:'match'}},
  {source:{digest:ID.sourceDigest,runtimeMatch:'partial_match'}}
 ]){
  const v=make();Object.assign(v,mutation);
  assert.equal(apply(v),false);
  assert.deepEqual(v.fields,{});
  assert.equal(v.details.observations.length,0);
 }
});
test('existing mechanics findings are unchanged for nonmatching contracts',()=>{
 const v=make();v.address='0x'+'ab'.repeat(20);v.fields.tradingTaxes={value:'verified source finding'};
 assert.equal(apply(v),false);assert.equal(v.fields.tradingTaxes.value,'verified source finding');
});
