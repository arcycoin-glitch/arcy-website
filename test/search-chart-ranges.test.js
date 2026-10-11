'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const chart=require('../search/server/lib/price-history');
const handler=require('../search/server/api/chart');
const address='0x'+'a'.repeat(40),pool='0x'+'b'.repeat(40);
const now=Date.UTC(2026,9,11,16,40),base='https://api.geckoterminal.com/api/v2/networks/eth';
const configs={
 '30D':['day',1,30,86400],
 '1W':['day',1,7,86400],
 '1D':['hour',1,24,3600],
 '4H':['minute',15,16,900]
};
function validResponse(range,endpoint){
 const [timeframe,aggregate,limit,step]=configs[range];
 const url=new URL(endpoint);
 if(url.pathname.endsWith('/pools')){
  assert.equal(url.href,base+'/tokens/'+address+'/pools?page=1');
  return new Response(JSON.stringify({data:[{attributes:{address:pool,reserve_in_usd:'185900'},
   relationships:{base_token:{data:{id:'eth_'+address}},quote_token:{data:{id:'eth_0x'+'c'.repeat(40)}}}}]}));
 }
 assert.equal(url.pathname,'/api/v2/networks/eth/pools/'+pool+'/ohlcv/'+timeframe);
 assert.equal(url.searchParams.get('aggregate'),String(aggregate));
 assert.equal(url.searchParams.get('limit'),String(limit));
 assert.equal(url.searchParams.get('currency'),'usd');
 assert.equal(url.searchParams.get('token'),address);
 const points=Array.from({length:limit},(_,index)=>{
  const price=1+.02*index;
  return [Math.floor(now/1000)-(limit-1-index)*step,price,price+.15,price-.05,price+.05,140.2];
 }).reverse();
 return new Response(JSON.stringify({meta:{base:{address},quote:{address:'0x'+'c'.repeat(40)}},
  data:{attributes:{ohlcv_list:points}}}));
}
test('GeckoTerminal ranges map to exact documented aggregates and isolated cache keys',async()=>{
 assert.deepEqual(Object.keys(chart.RANGES),['30D','1W','1D','4H']);
 for(const range of Object.keys(configs)){
  let requests=0;
  const fetcher=async url=>{requests++;return validResponse(range,url)};
  const result=await chart.load('ethereum',address,{range,now,fetcher});
  assert.equal(result.range,range);
  assert.equal(result.interval,chart.RANGES[range].interval);
  assert.equal(result.points.length,configs[range][2]);
  assert.equal(result.address,address);
  assert.equal(result.chainId,1);
  assert.equal(result.lastCandleTime,result.points.at(-1).time);
  assert.equal(requests,range==='1W'?0:2,'Weekly must reuse source-verified 30D daily closes');
  const cached=await chart.load('ethereum',address,{range,now,fetcher});
  assert.deepEqual(cached,result);
  assert.equal(requests,range==='1W'?0:2,'No duplicate provider calls for same chain+contract+range');
 }
});
test('1W as the first click derives seven actual closes from one 30D source scan',async()=>{
 let calls=0;
 const fetcher=async url=>{calls++;return validResponse('30D',url)};
 const result=await chart.load('ethereum',address,{range:'1W',now,fetcher,disableCache:true});
 assert.equal(result.range,'1W');
 assert.equal(result.interval,'1d');
 assert.equal(result.points.length,7);
 assert.equal(result.source,'GeckoTerminal');
 assert.equal(result.network,'ethereum');
 assert.equal(result.address,address);
 assert.equal(result.poolAddress,pool);
 assert.equal(result.lastCandleTime,result.points.at(-1).time);
 assert.equal(calls,2,'Only one pool lookup and one 30D OHLCV request; no separate weekly API call');
});
test('Unsupported chart ranges cannot trigger provider or grow cache',async()=>{
 let called=false;
 await assert.rejects(chart.load('ethereum',address,{range:'all',fetcher:()=>{called=true}}),/Unsupported chart interval/);
 assert.equal(called,false);
 const res={headers:{},statusCode:200,setHeader(key,value){this.headers[key]=value},
  status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
 await handler({method:'GET',query:{chain:'ethereum',address,range:'all'}},res);
 assert.equal(res.statusCode,400);
 assert.equal(res.body.error,'INVALID_CHART_QUERY');
});
test('Sparse old 4-hour pool candles fail closed rather than fake recent prices',async()=>{
 const fetcher=async url=>{
  const item=await validResponse('4H',url);
  if(url.endsWith('/pools?page=1'))return item;
  const json=await item.json();
  json.data.attributes.ohlcv_list=json.data.attributes.ohlcv_list.map(p=>
   [p[0]-2*86400,...p.slice(1)]);
  return new Response(JSON.stringify(json));
 };
 await assert.rejects(chart.load('ethereum',address,{range:'4H',now,fetcher,disableCache:true}),
  /Not enough recent exact-pool candles/);
});


test('Weekly daily closes can be built from real 30D closes without additional requests',()=>{
 const daily={
  ok:true,network:'arc',chainId:5042,address,range:'30D',interval:'1d',
  poolAddress:pool,source:'GeckoTerminal',
  lastCandleTime:Math.floor(now/1000),
  points:Array.from({length:30},(_,i)=>({time:Math.floor(now/1000)-(29-i)*86400,close:1+i/100}))
 };
 const w=chart.weekFromDaily(daily,now);
 assert.equal(w.range,'1W');assert.equal(w.interval,'1d');
 assert.equal(w.points.length,7);
 assert.equal(w.points.at(-1).time,daily.lastCandleTime);
 assert.equal(w.poolAddress,pool);assert.equal(w.address,address);
 assert.equal(w.source,'GeckoTerminal');
 assert.deepEqual(w.points,daily.points.slice(-7));
 assert.deepEqual(daily.points.length,30,'Original 30D proof must stay unchanged');
 assert.equal(chart.weekFromDaily({...daily,lastCandleTime:Math.floor(now/1000)-3*86400},now),null,
  'Stale history must not be presented as the last week');
 assert.equal(chart.weekFromDaily({...daily,points:[]},now),null);
});
