'use strict';
// Exact-token, exact-pool OHLCV; only sourced historical trades qualify as chart data.
const {readJson}=require('./http');
const {ADDRESS}=require('./eth');
const {chain}=require('./chains');
const ids={arc:'arc',ethereum:'eth'};
const CACHE_MS=120000;
const cache=new Map(),pending=new Map();
function tokenMatch(item,network,address){
 const ids=[item?.relationships?.base_token?.data?.id,item?.relationships?.quote_token?.data?.id]
  .filter(x=>typeof x==='string').map(x=>x.toLowerCase());
 return ids.includes(network+'_'+address);
}
function choosePool(body,network,address){
 if(!body||!Array.isArray(body.data))throw Error('Invalid pool response');
 const ranked=body.data.slice(0,40).filter(p=>{
  const a=p?.attributes?.address;
  return typeof a==='string'&&/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(a)&&
   tokenMatch(p,network,address)&&Number.isFinite(Number(p.attributes.reserve_in_usd))&&
   Number(p.attributes.reserve_in_usd)>0;
 }).sort((a,b)=>Number(b.attributes.reserve_in_usd)-Number(a.attributes.reserve_in_usd));
 return ranked[0]?.attributes.address.toLowerCase()||null;
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
async function load(network,address,{fetcher=fetch,now=Date.now(),disableCache=false}={}){
 if(!Object.hasOwn(ids,network)||!ADDRESS.test(address))throw Error('Unsupported chart contract');
 const normalized=address.toLowerCase(),id=ids[network],key=network+':'+normalized;
 if(!disableCache){
  const hit=cache.get(key);
  if(hit&&hit.expires>now)return structuredClone(hit.data);
  if(pending.has(key))return pending.get(key);
 }
 const job=(async()=>{
  const base='https://api.geckoterminal.com/api/v2/networks/'+id;
  const pools=await request(base+'/tokens/'+normalized+'/pools?page=1',fetcher);
  const pool=choosePool(pools,id,normalized);
  if(!pool)throw Error('No exact-token source pool verified');
  const url=base+'/pools/'+pool+'/ohlcv/day?aggregate=1&limit=30&currency=usd&token='+normalized;
  const candles=await request(url,fetcher);
  const points=parseCandles(candles,normalized,now);
  const data={ok:true,network,chainId:chain(network).chainId,address:normalized,
   source:'GeckoTerminal',poolAddress:pool,range:'30D',currency:'USD',
   sourceUrl:'https://www.geckoterminal.com/'+id+'/pools/'+pool,
   lastCandleTime:points[points.length-1].time,
   scope:'Source-reported USD close prices in one highest-reserve returned exact-token pool; not an aggregate token price.',
   points};
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
module.exports={load,tokenMatch,choosePool,parseCandles};
