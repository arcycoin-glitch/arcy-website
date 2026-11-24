'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {traversalStatus}=require('../search/server/lib/mechanics-v8-authority');

test('fully visited controller nodes are TRAVERSED, not necessarily verified authority',()=>{
 assert.equal(traversalStatus([{kind:'ADMIN'}],[]),'TRAVERSED');
});
test('unbound contract/controller sources are INCOMPLETE',()=>{
 assert.equal(traversalStatus([{reason:'CONTROLLER_SOURCE_UNBOUND'}],[]),'INCOMPLETE');
 assert.equal(traversalStatus([{reason:'CONTROLLER_DELEGATION_UNBOUND'}],[]),'INCOMPLETE');
});
test('node, depth, request and deadline budget stops are explicitly TRUNCATED',()=>{
 for(const reason of ['GRAPH_NODE_OR_DEPTH_LIMIT','GRAPH_BUDGET','GRAPH_DEADLINE']){
  assert.equal(traversalStatus([], [{reason}]),'TRUNCATED');
  assert.equal(traversalStatus([{reason}],[]),'TRUNCATED');
 }
});
test('ordinary provider read failure is incomplete, not an authorization denial',()=>{
 assert.equal(traversalStatus([],[{reason:'CONTROLLER_READ_FAILED'}]),'INCOMPLETE');
});

test('real traversal reports truncation when controller-node budget is exhausted',async()=>{
 const auth=require('../search/server/lib/mechanics-v8-authority');
 const subject='0x'+'a'.repeat(40);
 const roots=Array.from({length:8},(_,i)=>auth.root('0x'+String(i+1).repeat(40),'EXTERNAL_CONTROLLER','Observed','OBSERVED_CONTROLLER'));
 const graph=await auth.trace({subject,roots,codeAt:async()=> '0x6000',sourceAt:async()=>null,
  call:async()=>null,abiFn:()=>false,decodeArray:()=>[],
  stamp:(entry,evidenceType,method,verificationStatus)=>({...entry,evidenceType,method,verificationStatus}),
  deadline:Date.now()+10000});
 assert.equal(graph.traversalStatus,'TRUNCATED');
 assert.equal(graph.nodes.length,auth.LIMITS.nodes);
 assert(graph.skipped.some(x=>x.reason==='GRAPH_NODE_OR_DEPTH_LIMIT'));
 assert(graph.edges.every(x=>x.verificationStatus!=='CONFIRMED_AUTHORITY'));
});
