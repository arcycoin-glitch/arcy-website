'use strict';
// Exact-token, exact-pool OHLCV; only sourced historical trades qualify as chart data.
const {readJson}=require('./http');
const {ADDRESS}=require('./eth');
const {chain}=require('./chains');
const ids={arc:'arc',ethereum:'eth',robinhood:'robinhood'};
const CACHE_MS=120000;
const RANGES=Object.freeze({
 '30D':Object.freeze({timeframe:'day',aggregate:1,limit:30,interval:'1d',label:'30 days'}),
 '1W':Object.freeze({timeframe:'day',aggregate:1,limit:7,interval:'1d',label:'7 days'}),
 '1D':Object.freeze({timeframe:'hour',aggregate:1,limit:24,interval:'1h',label:'24 hours'}),
 '4H':Object.freeze({timeframe:'minute',aggregate:15,limit:16,interval:'15m',label:'4 hours'})
});
const cache=new Map(),pending=new Map();
const poolCache=new Map(),poolPending=new Map();
function tokenMatch(item,network,address){
 const ids=[item?.relationships?.base_token?.data?.id,item?.relationships?.quote_token?.data?.id]
  .filter(x=>typeof x==='string').map(x=>x.toLowerCase());
 return ids.includes(network+'_'+address);
}
function choosePools(body,network,address){
 if(!body||!Array.isArray(body.data))throw Error('Invalid pool response');
 const seen=new Set();
 const ranked=body.data.slice(0,40).filter(p=>{
  const a=String(p?.attributes?.address||'').toLowerCase();
  if(!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(a)||
   !tokenMatch(p,network,address)||!Number.isFinite(Number(p.attributes.reserve_in_usd))||
   Number(p.attributes.reserve_in_usd)<=0||seen.has(a))return false;
  seen.add(a);return true;
 }).sort((a,b)=>{
  // Highest reserves alone can select an inactive/new pool with no daily or
  // 15-minute candles. Balance real source-reported reserves and 24h trades.
  const score=p=>{
   const reserve=Number(p.attributes.reserve_in_usd);
   const raw=Number(p.attributes?.volume_usd?.h24);
   const volume=Number.isFinite(raw)&&raw>0?raw:0;
   return Math.sqrt(reserve)*Math.sqrt(1+volume);
  };
  return score(b)-score(a)||
   Number(b.attributes.reserve_in_usd)-Number(a.attributes.reserve_in_usd);
 });
 return ranked.map(p=>p.attributes.address.toLowerCase());
}
function choosePool(body,network,address){
 return choosePools(body,network,address)[0]||null;
}
function parseCandles(body,address,now=Date.now()){
 const b=body?.meta?.base?.address,q=body?.meta?.quote?.address;
 if(![b,q].some(x=>typeof x==='string'&&x.toLowerCase()===address))
  throw Error('OHLCV token identity could not be established');
 const values=body?.data?.attributes?.ohlcv_list;
 if(!Array.isArray(values)||values.length<3||values.length>200)
  throw Error('OHLCV history unavailable');
 const points=[];
 for(const row of values){
  if(!Array.isArray(row)||row.length!==6)throw Error('Malformed OHLCV point');
  const [time,open,high,low,close,volume]=row.map(Number);
  if(!Number.isSafeInteger(time)||time<1e9||time>Math.floor(now/1000)+180||
   ![open,high,low,close,volume].every(Number.isFinite)||
   [open,high,low,close].some(x=>x<=0)||volume<0||
   high<Math.max(open,close,low)||low>Math.min(open,close,high))
   throw Error('Untrusted OHLCV values');
  points.push({time,close});
 }
 points.sort((a,b)=>a.time-b.time);
 if(new Set(points.map(x=>x.time)).size!==points.length)throw Error('Duplicate OHLCV timestamps');
 return points;
}
async function request(url,fetcher){
 const response=await fetcher(url,{headers:{accept:'application/json;version=20230203'},
  signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('GeckoTerminal HTTP '+response.status);
 return readJson(response,512*1024);
}
async function bestPools(base,id,address,fetcher,now){
 // Exact-contract pools are discovered once per two-minute window across all
 // timeframes. Never search or query another chain or token's contract.
 const from=()=>request(base+'/tokens/'+address+'/pools?page=1',fetcher)
  .then(body=>choosePools(body,id,address).slice(0,2))
  .then(pools=>{if(!pools.length)throw Error('No exact-token source pool verified');return pools});
 if(fetcher!==fetch)return from();
 const key=id+':'+address;
 const hit=poolCache.get(key);
 if(hit&&hit.expires>now)return hit.pools;
 if(poolPending.has(key))return poolPending.get(key);
 const job=from().then(pools=>{
  poolCache.set(key,{pools,expires:Date.now()+CACHE_MS});
  if(poolCache.size>100)poolCache.delete(poolCache.keys().next().value);
  return pools;
 });
 poolPending.set(key,job);
 try{return await job}finally{if(poolPending.get(key)===job)poolPending.delete(key)}
}
function weekFromDaily(daily,now){
 if(!daily||daily.ok!==true||daily.range!=='30D'||daily.interval!=='1d'||
  !Array.isArray(daily.points)||daily.points.length<3)return null;
 if(daily.lastCandleTime*1000<now-2*86400000)return null;
 const recent=daily.points.filter(p=>Number.isSafeInteger(p.time)&&Number.isFinite(p.close)&&p.close>0&&
  p.time*1000>=now-8*86400000&&p.time*1000<=now+180000).slice(-7);
 if(recent.length<3)return null;
 return {...structuredClone(daily),range:'1W',interval:'1d',requestedWindow:'7 days',
  lastCandleTime:recent[recent.length-1].time,points:recent};
}
async function load(network,address,{fetcher=fetch,now=Date.now(),disableCache=false,range='30D'}={}){
 if(!Object.hasOwn(ids,network)||!ADDRESS.test(address))throw Error('Unsupported chart contract');
 if(!Object.hasOwn(RANGES,range))throw Error('Unsupported chart interval');
 const normalized=address.toLowerCase(),id=ids[network],key=network+':'+normalized+':'+range;
 const config=RANGES[range];
 if(!disableCache){
  const hit=cache.get(key);
  if(hit&&hit.expires>now)return structuredClone(hit.data);
  if(pending.has(key))return pending.get(key);
  // Weekly is already contained in a verified recent 30D daily series. Reuse
  // the *real candles* rather than make another provider call that risks 429.
  if(range==='1W'){
   const prior=cache.get(network+':'+normalized+':30D');
   const week=prior&&prior.expires>now?weekFromDaily(prior.data,now):null;
   if(week){
    cache.set(key,{data:week,expires:Math.min(prior.expires,now+CACHE_MS)});
    return structuredClone(week);
   }
  }
 }
 const job=(async()=>{
   // Weekly is derived only from real recent 30D daily closes, even on first load.
   // Join in-flight 30D work rather than racing another provider OHLCV request.
   if(range==='1W'){
    const daily=await load(network,normalized,{fetcher,now,disableCache,range:'30D'});
    const weekly=weekFromDaily(daily,now);
    if(!weekly)throw Error('Not enough recent exact-pool daily candles for selected interval');
    if(!disableCache){
     cache.set(key,{data:weekly,expires:now+CACHE_MS});
     if(cache.size>120)cache.delete(cache.keys().next().value);
    }
    return structuredClone(weekly);
   }
  const base='https://api.geckoterminal.com/api/v2/networks/'+id;
  const pools=await bestPools(base,id,normalized,fetcher,now);
  // Try at most two source-ranked, exact-contract pools if the first has no
  // usable candles. Fail closed on provider outage, malformed values or
  // mismatched OHLCV identity; those are NOT grounds for guessing a chart.
  let pool=null,recent=null;
  for(const candidate of pools){
   const url=base+'/pools/'+candidate+'/ohlcv/'+config.timeframe+'?aggregate='+config.aggregate+
    '&limit='+config.limit+'&currency=usd&token='+normalized;
   const candles=await request(url,fetcher);
   let points;
   try{points=parseCandles(candles,normalized,now)}
   catch(error){
    if(error.message==='OHLCV history unavailable')continue;
    throw error;
   }
   const duration={'30D':30*86400,'1W':7*86400,'1D':86400,'4H':4*3600}[range];
   const filtered=points.filter(p=>p.time*1000>=now-duration*1000-
    (config.timeframe==='day'?86400000:config.timeframe==='hour'?3600000:900000));
   if(filtered.length<3)continue;
   pool=candidate;recent=filtered;break;
  }
  if(!pool||!recent)throw Error('Not enough recent exact-pool candles for selected interval');
  const data={ok:true,network,chainId:chain(network).chainId,address:normalized,
   source:'GeckoTerminal',poolAddress:pool,range,interval:config.interval,requestedWindow:config.label,currency:'USD',
   sourceUrl:'https://www.geckoterminal.com/'+id+'/pools/'+pool,
   lastCandleTime:recent[recent.length-1].time,
   scope:'Source-reported USD closes from one ranked exact-contract pool; not market-wide or guaranteed executable prices.',
   points:recent};
  if(!disableCache){
   cache.set(key,{data,expires:now+CACHE_MS});
   if(cache.size>120)cache.delete(cache.keys().next().value);
  }
  return structuredClone(data);
 })();
 if(disableCache)return job;
 pending.set(key,job);
 try{return await job}finally{if(pending.get(key)===job)pending.delete(key)}
}
module.exports={load,tokenMatch,choosePool,choosePools,parseCandles,RANGES,weekFromDaily};
