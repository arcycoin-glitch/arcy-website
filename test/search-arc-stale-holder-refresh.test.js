'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('../search/server/lib/arc-adapter');
const queue=require('../lib/holder-queue-client');
const legacy=require('../search/server/lib/arc-legacy-evidence');
const index=require('../lib/holder-index');
const signed=require('../search/server/lib/arc-holder-publication');
const count=require('../search/server/lib/arc-holder-count');
const wallet=n=>'0x'+n.toString(16).padStart(40,'0');

function withQueueEnv(callback){
 const oldUrl=process.env.ARC_HOLDER_QUEUE_URL,oldToken=process.env.ARC_HOLDER_QUEUE_TOKEN;
 process.env.ARC_HOLDER_QUEUE_URL='https://isolated-worker.test/queue';
 process.env.ARC_HOLDER_QUEUE_TOKEN='test-only-not-a-real-secret';
 const restore=()=>{
  if(oldUrl===undefined)delete process.env.ARC_HOLDER_QUEUE_URL;else process.env.ARC_HOLDER_QUEUE_URL=oldUrl;
  if(oldToken===undefined)delete process.env.ARC_HOLDER_QUEUE_TOKEN;else process.env.ARC_HOLDER_QUEUE_TOKEN=oldToken;
 };
 return Promise.resolve().then(callback).finally(restore);
}
test('Stale published Arc legacy COMPLETE snapshot requests exactly one authenticated refresh',async()=>{
 await withQueueEnv(async()=>{
  const old=[queue.enqueue,legacy.callOriginal,legacy.holders,index.explorer,signed.load,count.fetchCount];
  const address=wallet(8181),past=new Date(Date.now()-3*86400000).toISOString();
  const names=['holderCount','largestWalletPct','top10Pct','top20Pct'];
  let jobs=0;
  try{
   queue.enqueue=async a=>{assert.equal(a,address);jobs++;return {queued:true,job:'test-only'};};
   index.explorer=async()=>({value:null,dataState:'NOT_VERIFIED'});
   signed.load=async()=>({fields:{holderCount:{dataState:'NOT_VERIFIED'}}});
   count.fetchCount=async()=>null;
   legacy.callOriginal=async(name,a,options)=>{
    assert.equal(name,'holders');assert.equal(a,address);assert.equal(options.action,'published');
    return {snapshot:{completedAt:past}};
   };
   legacy.holders=()=>Object.fromEntries(names.map((k,i)=>[k,{
    value:i?i*11:5,dataState:'DATA_FOUND',status:'HISTORICAL_ONCHAIN_VERIFIED',
    source:'historical confirmed snapshot',evidence:[{block:'0xab'}],
    freshness:{state:'LAST_VERIFIED',observedAt:past}
   }]));
   const first=await adapter.holders({address});
   assert.equal(first.fields.top10Pct.status,'HISTORICAL_ONCHAIN_VERIFIED');
   assert.equal(first.fields.top10Pct.freshness.state,'LAST_VERIFIED');
   assert.match(first.description,/refresh requested/i);
   assert.match(first.description,/remain historical/i);
   assert.equal(jobs,1);
   const second=await adapter.holders({address});
   assert.equal(second.fields.holderCount.value,5);
   assert.equal(jobs,1,'a subsequent report must not enqueue a duplicate job');
  }finally{
   [queue.enqueue,legacy.callOriginal,legacy.holders,index.explorer,signed.load,count.fetchCount]=old;
  }
 });
});

test('Fresh Arc snapshots and malformed timestamps do not trigger refresh',async()=>{
 await withQueueEnv(async()=>{
  const old=queue.enqueue;let jobs=0;queue.enqueue=async()=>{jobs++;return {queued:true};};
  try{
   assert.equal(await adapter.requestStaleHolderRefresh(wallet(8182),new Date().toISOString()),false);
   assert.equal(await adapter.requestStaleHolderRefresh(wallet(8183),'invalid-date'),false);
   assert.equal(jobs,0);
  }finally{queue.enqueue=old;}
 });
});

test('A clean/read-only Arc audit never enqueues with credentials absent',async()=>{
 const oldUrl=process.env.ARC_HOLDER_QUEUE_URL,oldToken=process.env.ARC_HOLDER_QUEUE_TOKEN;
 const old=queue.enqueue;let jobs=0;
 delete process.env.ARC_HOLDER_QUEUE_URL;delete process.env.ARC_HOLDER_QUEUE_TOKEN;
 queue.enqueue=async()=>{jobs++;return {queued:true};};
 try{
  const completed=new Date(Date.now()-3*86400000).toISOString();
  assert.equal(await adapter.requestStaleHolderRefresh(wallet(8184),completed),false);
  assert.equal(jobs,0);
 }finally{
  queue.enqueue=old;
  if(oldUrl===undefined)delete process.env.ARC_HOLDER_QUEUE_URL;else process.env.ARC_HOLDER_QUEUE_URL=oldUrl;
  if(oldToken===undefined)delete process.env.ARC_HOLDER_QUEUE_TOKEN;else process.env.ARC_HOLDER_QUEUE_TOKEN=oldToken;
 }
});
