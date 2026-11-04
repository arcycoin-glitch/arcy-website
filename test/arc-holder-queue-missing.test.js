'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
// A confirmed-absent signed publication must queue the exact contract once; outages, invalid documents and
// existing snapshots must not use this path (the stale-refresh path keeps its own 24 h rule).
function harness(){
 const adapter=require('../search/server/lib/arc-adapter'),index=require('../lib/holder-index');
 const count=require('../search/server/lib/arc-holder-count'),publication=require('../search/server/lib/arc-holder-publication');
 const legacy=require('../search/server/lib/arc-legacy-evidence'),timeout=require('../search/server/lib/timeout');
 const queue=require('../lib/holder-queue-client'),goplus=require('../search/server/lib/goplus-evidence');
 const saved=[index.explorer,count.fetchCount,publication.load,legacy.callOriginal,legacy.holders,timeout.withTimeout,queue.enqueueMissing,goplus.inspectHolders,{...process.env}];
 index.explorer=async()=>null;timeout.withTimeout=async()=>{throw Error('no census')};
 legacy.callOriginal=async()=>{throw Error('offline')};legacy.holders=()=>({});count.fetchCount=async()=>null;goplus.inspectHolders=async()=>({});
 process.env.ARC_HOLDER_QUEUE_URL='https://worker.example/queue';process.env.ARC_HOLDER_QUEUE_TOKEN='isolated-test-only';
 const restore=()=>{[index.explorer,count.fetchCount,publication.load,legacy.callOriginal,legacy.holders,timeout.withTimeout,queue.enqueue,goplus.inspectHolders]=saved;for(const k of Object.keys(process.env))if(!(k in saved[8]))delete process.env[k];Object.assign(process.env,saved[8]);};
 return {adapter,publication,queue,restore};
}
const field=reason=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reason,reasonCode:'SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'});
const card=reason=>({fields:Object.fromEntries(['holderCount','largestWalletPct','top10Pct','top20Pct'].map(k=>[k,field(reason)]))});
test('confirmed-absent publication queues the exact contract once and never overstates the result',async()=>{
 const h=harness();try{
  const calls=[];h.queue.enqueueMissing=async a=>{calls.push(a);return {queued:true};};
  h.publication.load=async()=>card(h.publication.NOT_PUBLISHED);
  const address='0x'+'a1'.repeat(20);
  const r=await h.adapter.holders({address});
  assert.deepEqual(calls,[address]);
  assert.equal(r.fields.holderCount.value,null);assert.equal(r.fields.holderCount.status,'NOT_VERIFIED');
  await h.adapter.holders({address});assert.equal(calls.length,1,'throttled for six hours after a successful queue request');
 }finally{h.restore();}
});
test('publication outage or invalid proof does not queue; unconfigured queue is a no-op; failed queue retries after the short throttle only',async()=>{
 const h=harness();try{
  let n=0;h.queue.enqueueMissing=async()=>{n++;return {queued:true};};
  const address='0x'+'b2'.repeat(20);
  for(const reason of ['Arc signed publication source unavailable.','Signature, source chain or COMPLETE snapshot proof invalid.','Arc signed publication request failed or timed out.']){
   h.publication.load=async()=>card(reason);await h.adapter.holders({address});
  }
  assert.equal(n,0);
  h.publication.load=async()=>card(h.publication.NOT_PUBLISHED);
  delete process.env.ARC_HOLDER_QUEUE_URL;await h.adapter.holders({address:'0x'+'c3'.repeat(20)});assert.equal(n,0);
  process.env.ARC_HOLDER_QUEUE_URL='https://worker.example/queue';
  h.queue.enqueue=async()=>{n++;return {queued:false,reasonCode:'BACKGROUND_QUEUE_UNAVAILABLE'};};
  const failing='0x'+'d4'.repeat(20);await h.adapter.holders({address:failing});await h.adapter.holders({address:failing});
  assert.equal(n,1,'a failed queue request is throttled for 10 minutes, not hammered');
 }finally{h.restore();}
});
test('a hung queue request cannot delay the card beyond its 1.5 s bound',async()=>{
 const h=harness();try{
  h.queue.enqueueMissing=()=>new Promise(()=>{});h.publication.load=async()=>card(h.publication.NOT_PUBLISHED);
  const t=Date.now();await h.adapter.holders({address:'0x'+'e5'.repeat(20)});assert.ok(Date.now()-t<3000);
 }finally{h.restore();}
});
