'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const w=require('../lib/verification/provider-watchdog');

const T=Date.parse('2026-11-11T00:00:00.000Z');

test('429 immediately cools the provider, then requires two successful recovery probes',()=>{
 let s=w.create('arc-primary','arc');
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.RATE_LIMIT,httpStatus:429,at:T});
 assert.equal(s.state,w.STATES.COOLDOWN);assert.equal(s.http429,1);
 const gate=w.eligibility(s,T+1000);assert.equal(gate.mode,'SKIP');assert.equal(gate.trafficAllowed,false);
 const due=Date.parse(s.cooldownUntil);assert.equal(w.eligibility(s,due).mode,'PROBE');

 s=w.recordSuccess(s,{at:due,latencyMs:120});assert.equal(s.state,w.STATES.PROBING);assert.equal(s.recoverySuccesses,1);
 assert.equal(w.eligibility(s,due+1).trafficAllowed,false);
 s=w.recordSuccess(s,{at:due+1000,latencyMs:110});assert.equal(s.state,w.STATES.HEALTHY);assert.equal(s.recoverySuccesses,0);
 assert.equal(w.eligibility(s,due+1001).trafficAllowed,true);
});

test('transient failures degrade first and become unavailable only at the bounded threshold',()=>{
 let s=w.create('eth-primary','ethereum');
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.TIMEOUT,at:T});assert.equal(s.state,w.STATES.DEGRADED);assert.equal(s.timeouts,1);
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.TRANSPORT,at:T+1000});assert.equal(s.state,w.STATES.DEGRADED);
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.PROVIDER_ERROR,httpStatus:503,at:T+2000});
 assert.equal(s.state,w.STATES.UNAVAILABLE);assert.equal(s.consecutiveFailures,3);assert.ok(s.cooldownUntil);
 assert.equal(w.eligibility(s,T+3000).mode,'SKIP');
});

test('wrong-chain and malformed providers fail unavailable immediately',()=>{
 for(const kind of [w.FAILURE_KINDS.WRONG_CHAIN,w.FAILURE_KINDS.MALFORMED]){
  const s=w.recordFailure(w.create('rh-primary','robinhood'),{kind,at:T});
  assert.equal(s.state,w.STATES.UNAVAILABLE);assert.equal(s.consecutiveFailures,1);assert.ok(s.cooldownUntil);
 }
});

test('degraded provider may carry traffic but a recovery probe state may not',()=>{
 let s=w.create('arc-backup','arc');
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.TIMEOUT,at:T});
 assert.deepEqual(w.eligibility(s,T+1),{mode:'TRAFFIC',reasonCode:'DEGRADED_PROVIDER',probeDue:false,trafficAllowed:true,nextProbeAt:null});
 s=w.recordSuccess(s,{at:T+2,latencyMs:50});
 assert.equal(s.state,w.STATES.PROBING);assert.equal(w.eligibility(s,T+3).mode,'PROBE');
});

test('latency history is bounded and summary exposes only secret-free operational facts',()=>{
 let s=w.create('arc-primary','arc');
 for(let i=1;i<=40;i++)s=w.recordSuccess(s,{at:T+i,latencyMs:i});
 assert.equal(s.latencyMs.length,w.MAX_LATENCY_SAMPLES);assert.deepEqual(s.latencyMs,[...Array(32)].map((_,i)=>i+9));
 const out=w.summary(s);
 assert.equal(out.latency.samples,32);assert.equal(out.latency.p50Ms,24);assert.equal(out.latency.p95Ms,39);assert.equal(out.latency.maxMs,40);
 const forbidden=new Set(['url','headers','authorization','secret','message','error']);
 const walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){assert.equal(forbidden.has(key),false,'forbidden watchdog key: '+key);walk(child);}};
 walk(out);
 assert.equal(out.http429,0);
});

test('cooldown reuses the repository deterministic backoff and honors bounded Retry-After',()=>{
 assert.equal(w.cooldownMs(1),5*60*1000);
 assert.equal(w.cooldownMs(2),10*60*1000);
 assert.equal(w.cooldownMs(20),w.POLICY.cooldownCapMs);
 assert.equal(w.cooldownMs(1,12*60*1000),12*60*1000);
 assert.equal(w.cooldownMs(1,60*60*1000),w.POLICY.cooldownCapMs);
});

test('invalid identities, failures, latency and serialized state fail closed',()=>{
 assert.throws(()=>w.create('https://secret.invalid','arc'),e=>e.code==='WATCHDOG_INVALID_IDENTITY');
 assert.throws(()=>w.create('provider','bsc'),e=>e.code==='WATCHDOG_INVALID_IDENTITY');
 const base=w.create('provider','arc');
 assert.throws(()=>w.recordFailure(base,{kind:'UNKNOWN',at:T}),e=>e.code==='WATCHDOG_INVALID_FAILURE_KIND');
 assert.throws(()=>w.recordFailure(base,{kind:w.FAILURE_KINDS.RATE_LIMIT,httpStatus:500,at:T}),e=>e.code==='WATCHDOG_INVALID_HTTP_STATUS');
 assert.throws(()=>w.recordSuccess(base,{at:T,latencyMs:-1}),e=>e.code==='WATCHDOG_INVALID_LATENCY');
 assert.equal(w.validState({...base,requests:1}),false);
 assert.throws(()=>w.summary({...base,requests:1}),e=>e.code==='WATCHDOG_CORRUPT_STATE');
});


test('a failed recovery probe never permits ordinary traffic before another two successes',()=>{
 let s=w.create('arc-primary','arc');
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.RATE_LIMIT,httpStatus:429,at:T});
 const due=Date.parse(s.cooldownUntil);
 s=w.recordSuccess(s,{at:due,latencyMs:20});
 assert.equal(s.state,w.STATES.PROBING);
 s=w.recordFailure(s,{kind:w.FAILURE_KINDS.TRANSPORT,at:due+100});
 assert.equal(s.state,w.STATES.UNAVAILABLE);
 assert.equal(w.eligibility(s,due+101).mode,'SKIP');
});
