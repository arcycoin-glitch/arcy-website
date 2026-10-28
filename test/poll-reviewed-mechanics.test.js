'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mechanics=require('../search/server/lib/mechanics-deep');
const poll='0xf76b1d00bd3d63a37246b5f512074e864010e33d';
const block='0x1234',code='0x600160005500';
const digest='7efbe9dc6a4a5b3d698f0d876e29844422bc000da755223e04738ff11dd13802';
function fixture(profile=digest){
 const calls=[];
 const rpc=async(method,params)=>{
  calls.push({method,params});
  assert.equal(params.at(-1),block);
  if(method==='eth_getCode')return code;
  if(method==='eth_call')return '0x'+'0'.repeat(64);
  if(method==='eth_getStorageAt')return '0x'+'0'.repeat(64);
  throw Error('Unexpected RPC method '+method);
 };
 return {calls,options:{network:'arc',address:poll,block,rpc,
  sourceLoader:async()=>({digest:profile,abi:[],runtimeMatch:'exact_match',
   url:'https://sourcify.dev/server/v2/contract/5042/'+poll,retrievedAt:'2026-10-28T17:34:42Z'})}};
}
test('POLL exact source digest is the reviewed constructor-only burnable LaunchToken profile',()=>{
 assert.equal(mechanics.PROFILES[digest],'FIXED_SUPPLY_BURNABLE_LAUNCH');
});
test('POLL complete verified source proves constructor-only supply, no token admin and no transfer tax',async()=>{
 const x=fixture(),r=await mechanics.inspect(x.options);
 assert.equal(r.details.reviewedProfile,'FIXED_SUPPLY_BURNABLE_LAUNCH');
 assert.equal(r.fields.mintCapability.status,'VERIFIED_SOURCE');
 assert.match(r.fields.mintCapability.value,/NONE DETECTED/);
 assert.match(r.fields.mintCapability.evidence[0].scope,/once at deployment/);
 assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE');
 assert.match(r.fields.ownerAdmin.value,/No token owner\/admin/);
 assert.match(r.fields.ownerAdmin.evidence[0].scope,/Independent launchpad\/pool/);
 assert.equal(r.fields.tradingTaxes.status,'VERIFIED_SOURCE');
 assert.equal(r.fields.tradingTaxes.evidence[0].coverage,'TOKEN_TRANSFER_ONLY');
 assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);
 assert.equal(r.fields.contractArchitecture.status,'ON_CHAIN');
 assert.ok(x.calls.every(x=>['eth_getCode','eth_call','eth_getStorageAt'].includes(x.method)));
});
test('Different verified source digest never inherits POLL mint/fee/admin claims',async()=>{
 const x=fixture('a'.repeat(64)),r=await mechanics.inspect(x.options);
 assert.equal(r.fields.tradingTaxes,undefined);
 assert.equal(r.fields.mintCapability,undefined);
 assert.equal(r.fields.ownerAdmin,undefined);
 assert.equal(r.fields.contractArchitecture.status,'ON_CHAIN');
});
test('Enrichment fills previously unverified 3/4 mechanics rows with source-restricted evidence',async()=>{
 const x=fixture();
 const missing=(reasonCode)=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode,evidence:[]});
 const card={description:'POLL Mechanics',fields:{
  tradingTaxes:missing('TAX_NOT_VERIFIED'),mintCapability:missing('MINT_NOT_VERIFIED'),
  ownerAdmin:missing('OWNER_ADMIN_NOT_VERIFIED'),contractArchitecture:missing('PROXY_NOT_VERIFIED')
 }};
 const r=await mechanics.enrich({...x.options,card});
 assert.equal(Object.values(r.fields).filter(f=>f.dataState==='DATA_FOUND').length,4);
 assert.equal(r.fields.mintCapability.value,'NONE DETECTED ✓');
 assert.equal(r.fields.ownerAdmin.status,'VERIFIED_SOURCE');
 assert.match(r.fields.tradingTaxes.value,/DEX\/hook fees NOT VERIFIED/);
});
