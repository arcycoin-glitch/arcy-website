'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describe}=require('../search/server/lib/mechanics-v8-forensics');
const {recorder}=require('../search/server/lib/mechanics-v8-evidence');
const token='0x'+'a'.repeat(40),impl='0x'+'b'.repeat(40),member='0x'+'c'.repeat(40),block='0x123';
const digest='f'.repeat(64),stamp=recorder({chainId:1,network:'ethereum',address:token,block,provider:'test RPC'});
const proof={sourceDigest:digest,implementation:impl};
const observation=(value=true,extra={})=>({method:'hasRole',role:'BURNER_ROLE',member,value,sourceDigest:digest,implementation:impl,block,...extra});
function run(observations,overrides={}){
 return describe({profile:'ROLE_MINTER_BURNER_VOTES',proof:{...proof,...overrides.proof},stamp,
  details:{subjectAddress:token,block,observations,...overrides.details}}).burnAuthorization;
}
test('pinned source-bound burner role is verified only for matching execution context',()=>{
 const r=run([observation()]);
 assert.equal(r.verificationStatus,'VERIFIED');
 assert.deepEqual(r.value,[member]);
});
test('stale block, wrong source or implementation never promotes burner role',()=>{
 for(const patch of [{block:'0x124'},{sourceDigest:'e'.repeat(64)},{implementation:token},
   {address:impl},{member:'invalid'}]){
  assert.equal(run([observation(true,patch)]).verificationStatus,'UNKNOWN');
 }
});
test('conflicting true/false membership fails closed',()=>{
 assert.equal(run([observation(true),observation(false)]).verificationStatus,'UNKNOWN');
});
test('unbound token context or proof implementation never promotes role',()=>{
 assert.equal(run([observation()],{details:{subjectAddress:null}}).verificationStatus,'UNKNOWN');
 assert.equal(run([observation()],{proof:{implementation:null}}).verificationStatus,'UNKNOWN');
});
