'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recover}=require('../search/server/lib/arc-mechanics-recovery');
const {reviewed}=require('../lib/mechanics-hook');
const address='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const block='0x12abc';
const source='Sourcify bytecode-matched reviewed V4 hook + Arc RPC';
function fixture(){
 const hook={chainId:5042,network:'arc',address,block,hook:'0x'+'1'.repeat(40),
  runtimeMatch:'REVIEWED_COMPILER_TEMPLATE_IMMUTABLES_ONLY',
  hookSourceDigest:reviewed.hook,portalSourceDigest:reviewed.portal,
  source,scope:'Exact reviewed immutable V4 hook buy/sell rates'};
 const fact=value=>({value,status:'VERIFIED',dataState:'DATA_FOUND',source,
  evidence:[{...hook}]});
 return {ok:true,address,block,chainId:5042,
  contractFields:{buyTax:fact(3),sellTax:fact(3),transferTax:{...fact(0),evidence:[{
    source:'Sourcify',address,block,chainId:5042,network:'arc',method:'Mechanics summary subject binding'},
    {source:'Sourcify',block,
     sourceDigest:'f4abba6aa7071125168a9b9ea39cdfd08f01835d3c59aa74c55173c71e50daa1',
     profile:'ARGUS_V4_LAUNCH_TOKEN_7',scope:'Ordinary ERC-20 transfer behavior only'}]}}};
}
test('recovers 3/3/0 from contract-bound immutable reviewed V4 hook with exact pinned block',()=>{
 const candidate=recover(fixture(),{address,block});
 assert.equal(candidate.dataState,'DATA_FOUND');
 assert.equal(candidate.value,'Buy 3% · Sell 3% · Transfer 0%');
 assert.equal(candidate.status,'SOURCE_REPORTED');
 assert(candidate.evidence.some(e=>e.hookSourceDigest===reviewed.hook));
});
test('nearby successful source observation is historical, never falsely repinned',()=>{
 const result=recover(fixture(),{address,block:'0x12abf'});
 assert.equal(result.status,'HISTORICAL_ONCHAIN_VERIFIED');
 assert.equal(result.freshness.block,block);
 assert.equal(result.value,'Buy 3% · Sell 3% · Transfer 0%');
 assert.match(result.scope,/nearby on-chain block/);
});
test('foreign identity, wrong digest and stale or unreviewed sources fail closed',()=>{
 const overrides=[
  {address:'0x'+'2'.repeat(40)},
  {chainId:1},
  {block:'0x1'},
  {contractFields:{...fixture().contractFields,buyTax:{...fixture().contractFields.buyTax,source:'GoPlus'}}},
  {contractFields:{...fixture().contractFields,buyTax:{...fixture().contractFields.buyTax,evidence:[{...fixture().contractFields.buyTax.evidence[0],hookSourceDigest:'invalid'}]}}},
  {contractFields:{...fixture().contractFields,transferTax:{...fixture().contractFields.transferTax,evidence:[{...fixture().contractFields.transferTax.evidence[0],sourceDigest:'unreviewed'}]}}}
 ];
 for(const patch of overrides)assert.equal(recover({...fixture(),...patch},{address,block}),null);
 assert.equal(recover(fixture(),{address:'0x'+'3'.repeat(40),block}),null);
 assert.equal(recover(fixture(),{address,block:'0xffff'}),null);
});
