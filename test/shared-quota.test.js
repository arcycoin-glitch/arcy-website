'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const store=require('../lib/quota-store'),budget=require('../lib/radar-v2/budget');
const M='2026-10';
test('quota-store validates input and enforces the cap atomically in worker memory',async()=>{
 store._reset();const cfg={};
 assert.equal((await store.apply({month:'bad',credits:4,cap:100,mode:'reserve'},{config:cfg})).reasonCode,'QUOTA_REQUEST_INVALID');
 assert.equal((await store.apply({month:M,credits:4,cap:9000,mode:'reserve'},{config:cfg})).ok,false);
 let g=0,r=0;for(let i=0;i<10;i++){const x=await store.apply({month:M,credits:4,cap:20,mode:'reserve'},{config:cfg});x.granted?g++:r++;}
 assert.deepEqual([g,r],[5,5]);
 const s=await store.apply({month:M,credits:-4,cap:20,mode:'settle'},{config:cfg});assert.equal(s.spent,16);
});
test('quota-store speaks Upstash EVAL and maps results',async()=>{
 const calls=[];const f=async(u,o)=>{calls.push(JSON.parse(o.body));return {ok:true,json:async()=>({result:[0,19]})};};
 const r=await store.apply({month:M,credits:4,cap:20,mode:'reserve'},{fetchImpl:f,config:{url:'https://r.example',token:'t'}});
 assert.equal(r.granted,false);assert.equal(r.store,'redis');assert.equal(calls[0][0],'EVAL');assert.equal(calls[0][3],'arcy:radar:credits:'+M);
 const bad=await store.apply({month:M,credits:4,cap:20,mode:'reserve'},{fetchImpl:async()=>{throw new Error('x');},config:{url:'https://r.example',token:'t'}});
 assert.equal(bad.reasonCode,'QUOTA_STORE_UNAVAILABLE');
});
test('worker endpoint requires the bearer token and applies quota',async()=>{
 store._reset();process.env.PORT='0';process.env.ARC_HOLDER_QUEUE_TOKEN='tok';delete process.env.ARC_INDEX_REDIS_URL;delete process.env.UPSTASH_REDIS_REST_URL;
 const server=require('../lib/holder-worker-http').start();await new Promise(r=>server.once('listening',r));const port=server.address().port;
 const post=(auth,b)=>new Promise(res=>{const q=http.request({port,method:'POST',path:'/quota/radar',headers:auth?{authorization:auth}:{}},x=>{let t='';x.on('data',c=>t+=c);x.on('end',()=>res({status:x.statusCode,body:JSON.parse(t)}));});q.end(JSON.stringify(b));});
 try{
  assert.equal((await post(null,{})).status,401);
  const ok=await post('Bearer tok',{month:M,credits:4,cap:8,mode:'reserve'});assert.equal(ok.status,200);assert.equal(ok.body.granted,true);
  await post('Bearer tok',{month:M,credits:4,cap:8,mode:'reserve'});
  assert.equal((await post('Bearer tok',{month:M,credits:4,cap:8,mode:'reserve'})).body.granted,false);
  assert.equal((await post('Bearer tok',{month:'x'})).status,400);
 }finally{server.close();}
});
test('radar client: refused/granted/unavailable and fallback',async()=>{
 const env={ARC_HOLDER_QUEUE_URL:'https://w.example/queue',ARC_HOLDER_QUEUE_TOKEN:'t'};
 const mk=(ok,body)=>async()=>({ok,json:async()=>body});
 assert.equal(await budget.shared('reserve',4,{env,fetcher:mk(true,{ok:true,granted:false})}),'refused');
 assert.equal(await budget.shared('reserve',4,{env,fetcher:mk(true,{ok:true,granted:true})}),'granted');
 assert.equal(await budget.shared('reserve',4,{env,fetcher:mk(false,{})}),'unavailable');
 assert.equal(await budget.shared('reserve',4,{env,fetcher:async()=>{throw new Error('t');}}),'unavailable');
 assert.equal(await budget.shared('reserve',4,{env:{},fetcher:mk(true,{})}),'unavailable');
});
test('radar load refuses without any provider call when the shared cap says refused',async()=>{
 const radar=require('../lib/radar-v2');budget._reset();
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'k',ARC_HOLDER_QUEUE_URL:'https://w.example/queue',ARC_HOLDER_QUEUE_TOKEN:'t'};
 const urls=[];const fetcher=async u=>{urls.push(String(u));if(String(u).includes('/quota/radar'))return {ok:true,json:async()=>({ok:true,granted:false})};throw new Error('provider must not be called');};
 await assert.rejects(()=>radar.load('robinhood',{env,fetcher,now:()=>Date.parse('2026-10-30T12:00:00Z')}),e=>e.code==='RADAR_BUDGET_EXHAUSTED');
 assert.ok(urls.every(u=>u.includes('/quota/radar')));
});
