'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const cache=require('../lib/radar-v2/verified-pons-cache');
const store=require('../lib/radar-verified-snapshot-store');
const radar=require('../lib/radar-v2');
const {PONS}=require('../lib/radar-v2/sources');
const NOW=Date.parse('2026-11-13T12:00:00Z');
const token='0x'+'a'.repeat(40);
function verified(ageMs=2000){
 return {ok:true,version:2,engine:'arcy-radar-v3',network:'pons',chainId:4663,
  asOf:new Date(NOW-ageMs).toISOString(),freshness:'FRESH',coverage:{ponsConfirmed:1},
  tokens:[{rank:1,address:token,symbol:'TEST',name:'Test',
   fields:{priceUsd:{status:'SOURCE_REPORTED'}},
   launch:{status:'ONCHAIN_VERIFIED',factory:PONS.factories[0]}}]};
}
const config={url:'https://redis.example',token:'redis-private'};
test('only complete, recent, factory-verified Pons rankings qualify for durable reuse',()=>{
 const ok=verified();
 assert.equal(cache.valid(ok,NOW),true);
 assert.equal(cache.valid({...ok,network:'robinhood'},NOW),false);
 assert.equal(cache.valid({...ok,chainId:1},NOW),false);
 assert.equal(cache.valid({...ok,asOf:'2026-11-13T08:00:00Z'},NOW),false);
 assert.equal(cache.valid({...ok,tokens:[{...ok.tokens[0],launch:{status:'NOT_VERIFIED'}}]},NOW),false);
 assert.equal(cache.valid({...ok,tokens:[{...ok.tokens[0],launch:{status:'ONCHAIN_VERIFIED',factory:'0x'+'f'.repeat(40)}}]},NOW),false);
 assert.equal(cache.valid({...ok,coverage:{ponsConfirmed:2}},NOW),false);
 assert.equal(cache.valid({...ok,tokens:[{...ok.tokens[0],address:'0x0'}]},NOW),false);
 assert.equal(cache.valid({...ok,freshness:'STALE'},NOW),false);
 assert.equal(cache.valid({...ok,extra:'x'.repeat(cache.MAX_BYTES)},NOW),false);
});
test('worker Redis commands preserve 3h TTL; malformed responses and outages fail closed',async()=>{
 let stored=null;
 const fetchImpl=async (_url,opts)=>{
  const [cmd,key,arg,ttlFlag,seconds]=JSON.parse(opts.body);
  assert.equal(key,store.KEY);
  if(cmd==='GET')return {ok:true,json:async()=>({result:stored})};
  assert.equal(cmd,'SET');assert.equal(ttlFlag,'EX');assert.equal(Number(seconds),store.TTL_SECONDS);
  stored=arg;
  return {ok:true,json:async()=>({result:'OK'})};
 };
 const options={fetchImpl,config,now:()=>NOW};
 assert.deepEqual(await store.apply({mode:'get'},options),{ok:true,hit:false});
 assert.deepEqual(await store.apply({mode:'put',snapshot:verified()},options),{ok:true,saved:true});
 const read=await store.apply({mode:'get'},options);
 assert.equal(read.ok,true);assert.equal(read.hit,true);assert.deepEqual(read.snapshot,verified());
 stored='{garbled';
 assert.deepEqual(await store.apply({mode:'get'},options),{ok:false,reasonCode:'SNAPSHOT_STORE_INVALID'});
 assert.deepEqual(await store.apply({mode:'put',snapshot:{ok:true}},options),{ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'});
 assert.deepEqual(await store.apply({mode:'get'},{...options,fetchImpl:async()=>{throw Error('down')}}),{ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'});
});
const env={VERCEL:'1',RADAR_PONS_DURABLE_CACHE_ENABLED:'true',
 ARC_HOLDER_QUEUE_URL:'https://worker.example/queue',
 ARC_HOLDER_QUEUE_TOKEN:'private-test-token',
 COINGECKO_DEMO_API_KEY:'fake-test-key',
 MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',
 MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
test('cache opt-in requires configured authenticated worker and HTTPS',()=>{
 assert.equal(cache.endpoint({...env,RADAR_PONS_DURABLE_CACHE_ENABLED:'false'}),null);
 assert.equal(cache.endpoint({...env,ARC_HOLDER_QUEUE_URL:'http://worker.example/queue'}),null);
 assert.equal(cache.endpoint({...env,ARC_HOLDER_QUEUE_TOKEN:''}),null);
 assert.equal(cache.endpoint(env),'https://worker.example/quota/radar/verified-pons');
});
test('fresh shared Pons snapshot replaces a cold Lambda refresh without upstream requests or credits',async()=>{
 radar._cache.clear();
 let calls=0;
 const fetcher=async(url,opts)=>{
  calls++;
  assert.equal(new URL(url).pathname,'/quota/radar/verified-pons');
  assert.equal(JSON.parse(opts.body).mode,'get');
  assert.equal(opts.headers.authorization,'Bearer private-test-token');
  return {ok:true,json:async()=>({ok:true,hit:true,snapshot:verified()})};
 };
 const data=await radar.load('pons',{env,fetcher,now:()=>NOW});
 assert.equal(data.freshness,'FRESH');assert.equal(data.tokens.length,1);assert.equal(calls,1);
});
test('source quota cooldown returns the 90-minute-old remote result only as STALE, never FRESH',async()=>{
 radar._cache.clear();
 const stale=verified(90*60*1000);
 let reads=0,reservations=0;
 const fetcher=async(url,opts)=>{
  const path=new URL(url).pathname,mode=JSON.parse(opts.body).mode;
  if(path==='/quota/radar/verified-pons'){
   reads++;return {ok:true,json:async()=>({ok:true,hit:true,snapshot:stale})};
  }
  if(path==='/quota/radar'){
   assert.equal(mode,'reserve');reservations++;
   return {ok:true,json:async()=>({ok:true,granted:false,reason:'MINUTE_CAP',retryInMs:60000})};
  }
  throw Error('unexpected provider call');
 };
 const data=await radar.load('pons',{env,fetcher,now:()=>NOW});
 assert.equal(data.freshness,'STALE');assert.equal(data.staleReason,'RADAR_PROVIDER_RATE_LIMITED');
 assert.equal(data.staleAgeSeconds,5400);assert.equal(reads,1);assert.equal(reservations,1);
});

test('public Radar API never edge-caches STALE data and does not extend an old verified Pons edition',async()=>{
 const handler=require('../search/server/api/radar');
 const original=radar.load;
 const oldKey=process.env.COINGECKO_DEMO_API_KEY;
 process.env.COINGECKO_DEMO_API_KEY='test';
 const invoke=async data=>{
  radar.load=async()=>data;
  const res={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},
   status(code){this.statusCode=code;return this;},json(v){this.body=v;return this;}};
  await handler({method:'GET',query:{chain:'pons'},headers:{'sec-fetch-site':'same-origin'}},res);
  return res;
 };
 try{
  const stale=await invoke({...verified(),freshness:'STALE',staleAgeSeconds:5400,staleReason:'RADAR_PROVIDER_RATE_LIMITED'});
  assert.equal(stale.statusCode,200);
  assert.equal(stale.headers['Cache-Control'],'no-store');
  const oldFresh=verified(75*60*1000);
  oldFresh.asOf=new Date(Date.now()-75*60*1000).toISOString();
  const success=await invoke(oldFresh);
  const ttl=Number(/s-maxage=(\\d+)/.exec(success.headers['Cache-Control'])?.[1]);
  assert.ok(ttl>=270&&ttl<=300,'75-minute-old verified result must expire at the 80-minute Demo source TTL');
 }finally{
  radar.load=original;
  if(oldKey===undefined)delete process.env.COINGECKO_DEMO_API_KEY;else process.env.COINGECKO_DEMO_API_KEY=oldKey;
 }
});
