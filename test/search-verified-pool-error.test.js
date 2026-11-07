'use strict';
// A verified Arc liquidity pool is not an ERC-20 token, but no worker outage,
// stale classification or isolated getter revert may be displayed as proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const report=require('../search/server/api/report');
const progress=require('../search/server/api/progress');
const service=require('../search/server/lib/multichain-service');
const queue=require('../lib/holder-queue-client');
const A='0x5bc5ced48bec9260c8d626269f44e22808b8d2c1';
const B='0xf89005ccf237a59eeee1521e74b15c7d8d022ab7';
const req=(address=A,chain='arc')=>({method:'GET',query:{address,chain},socket:{remoteAddress:'127.0.0.190'}});
const response=()=>({code:200,headers:{},body:null,status(n){this.code=n;return this},setHeader(k,v){this.headers[k]=v;return this},json(d){this.body=d;return this}});
const status=(a=A,changes={})=>({ok:true,address:a,job:{state:'UNSUPPORTED',reasonCode:'HOLDER_CONTRACT_IS_LIQUIDITY_POOL',hasCompleteSnapshot:false,...changes}});
test('Search distinguishes authenticated worker-confirmed Arc pools from genuine RPC outages without invented card values',async()=>{
 const save=[service.report,queue.status];let calls=0;
 try{
  service.report=async()=>{throw Error('ERC20 totalSupply unavailable')};
  queue.status=async a=>{calls++;return status(a)};
  let r=response();await report(req(),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'CONTRACT_IS_LIQUIDITY_POOL');
  assert.equal(r.body.chainId,5042);assert.equal(r.body.network,'arc');
  assert.equal(r.body.address,A);assert.equal(r.body.holderAnalysis,'NOT_APPLICABLE');
  assert.equal(r.body.contractType,'CONCENTRATED_LIQUIDITY_POOL');
  assert.match(r.body.reason,/not an ERC-20 token/);
  assert.ok(!Object.hasOwn(r.body,'holderCount')&&!Object.hasOwn(r.body,'cards'));
  const first=calls;
  for(const o of [
   status(B), // Wrong contract cannot classify current address.
   status(A,{state:'FAILED'}),
   status(A,{reasonCode:'GETTER_REVERTED'}),
   status(A,{hasCompleteSnapshot:true}),
   {ok:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'}
  ]){
   queue.status=async()=>o;r=response();await report(req(),r);
   assert.equal(r.code,502);assert.equal(r.body.error,'CHAIN_SCAN_UNAVAILABLE');
  }
  queue.status=async()=>{throw Error('worker unavailable')};r=response();await report(req(),r);
  assert.equal(r.code,502);assert.equal(r.body.error,'CHAIN_SCAN_UNAVAILABLE');
  queue.status=async()=>{throw Error('should not be queried for non-Arc chains')};
  r=response();await report(req(A,'ethereum'),r);assert.equal(r.code,502);
  assert.equal(r.body.network,'ethereum');
  service.report=async()=>({ok:true,network:'arc',address:A,cards:{}});
  queue.status=async()=>{throw Error('valid report should never fetch worker status')};
  r=response();await report(req(),r);assert.equal(r.code,200);assert.equal(r.body.ok,true);
  assert.ok(first===1);
 }finally{service.report=save[0];queue.status=save[1];}
});
test('Search progress transport shows the verified pool explanation in its existing error line',async()=>{
 const old=[service.report,queue.status];try{
  service.report=async ({onProgress})=>{onProgress?.({phase:'identity',report:{ok:true,network:'arc'}});throw Error('non-token')};
  queue.status=async a=>status(a);
  const res={headers:{},written:[],writableEnded:false,statusCode:200,
   once(){},setHeader(k,v){this.headers[k]=v;return this},
   flushHeaders(){},write(t){this.written.push(t);return true},end(){this.writableEnded=true;return this},
   status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
  await progress(req(),res);
  const events=res.written.map(s=>JSON.parse(s));
  assert.equal(events[0].phase,'identity');
  assert.equal(events.at(-1).phase,'error');
  assert.match(events.at(-1).error,/concentrated-liquidity pool/);
  assert.equal(res.writableEnded,true);
 }finally{service.report=old[0];queue.status=old[1];}
});
