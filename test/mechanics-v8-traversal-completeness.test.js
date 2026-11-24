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
