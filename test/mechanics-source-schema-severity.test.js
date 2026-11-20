'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {explain}=require('../search/server/lib/mechanics-gaps');
const {annotateCard}=require('../search/server/lib/mechanics-coverage');
const unknown=()=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reasonCode:'UNREVIEWED_MECHANICS',reason:'Not reviewed',evidence:[]});
const diagnostics=(...causes)=>({sourceVerification:{matched:false,provider:null,assurance:null},failures:causes.map(reason=>({source:'Sourcify',reason}))});

test('invalid source ABI/schema is NOT described as published bytecode mismatch',()=>{
 for(const field of ['tradingTaxes','mintCapability','ownerAdmin','transferRestrictions']){
  const out=explain(field,unknown(),diagnostics('SOURCE_SCHEMA_INVALID'));
  assert.equal(out.reasonCode,'MECHANICS_SOURCE_SCHEMA_INCOMPLETE');
  assert.equal(out.reason,'Bytecode matched; source ABI/metadata incomplete.');
  assert.match(out.explanation,/identity and deployed-bytecode checks succeeded/);
  assert.match(out.explanation,/execution remain unreviewed/);
  assert.equal(out.value,null,'schema defects cannot imply tax or permissions');
  assert.equal(out.dataState,'NOT_VERIFIED');
  assert.equal(out.verificationGap.cause,'MECHANICS_SOURCE_SCHEMA_INCOMPLETE');
 }
});

test('actual bytecode and chain identity mismatches remain material and distinct',()=>{
 for(const cause of ['SOURCE_BYTECODE_MISMATCH','SOURCE_IDENTITY_MISMATCH']){
  const out=explain('mintCapability',unknown(),diagnostics(cause));
  assert.equal(out.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED');
  assert.match(out.reason,/mismatch/);
  assert.doesNotMatch(out.reason,/ABI|metadata incomplete/);
  assert.equal(out.value,null);
 }
});

test('mismatch wins over a parallel schema failure; proxy ambiguity wins over both',()=>{
 const both=explain('ownerAdmin',unknown(),diagnostics('SOURCE_SCHEMA_INVALID','SOURCE_BYTECODE_MISMATCH'));
 assert.equal(both.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED');
 const proxy=explain('ownerAdmin',unknown(),diagnostics('SOURCE_SCHEMA_INVALID','IMPLEMENTATION_EXECUTION_UNRESOLVED'));
 assert.equal(proxy.reasonCode,'MECHANICS_IMPLEMENTATION_UNRESOLVED');
});

test('already independently reviewed field is never overwritten by source diagnostics',()=>{
 const field={value:'Owner-controlled mint',dataState:'DATA_FOUND',status:'VERIFIED_SOURCE_AND_STATE',evidence:[{source:'Pinned independent observation'}]};
 assert.equal(explain('mintCapability',field,diagnostics('SOURCE_SCHEMA_INVALID')),field);
});

test('mechanics report annotation preserves UNKNOWN tax/mint/owner with distinct metadata explanation',()=>{
 const detail=diagnostics('SOURCE_SCHEMA_INVALID');
 const card={fields:{
  tradingTaxes:{...unknown(),analysisDiagnostics:detail},
  mintCapability:{...unknown(),analysisDiagnostics:detail},
  ownerAdmin:{...unknown(),analysisDiagnostics:detail},
  contractArchitecture:{value:'NON-PROXY',dataState:'DATA_FOUND',evidence:[{method:'RPC'}]}
 }};
 const next=annotateCard(card);
 for(const field of ['tradingTaxes','mintCapability','ownerAdmin']){
  assert.equal(next.fields[field].reasonCode,'MECHANICS_SOURCE_SCHEMA_INCOMPLETE');
  assert.equal(next.fields[field].dataState,'NOT_VERIFIED');
  assert.equal(next.fields[field].value,null);
 }
 assert.deepEqual(next.fields.contractArchitecture,card.fields.contractArchitecture);
 assert.equal(card.fields.tradingTaxes.reason,'Not reviewed','input remains unmodified');
});
