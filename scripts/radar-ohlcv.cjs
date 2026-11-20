'use strict';
// Issue #279 V6 — bounded provider OHLCV for the compression engine. Builder/CI only (never in a visitor request, never on Vercel).
// Source: GeckoTerminal / CoinGecko Onchain documented pool OHLCV endpoint (daily candles of ONE exact pool). Access tier follows
// lib/radar-v2/sources.js geckoAccess(): a Demo/Pro key when the operator configured one; the keyless tier only when the run
// explicitly allows it (RADAR_OHLCV_KEYLESS=1: manual / pull-request / merge runs, never the cron schedule, because the keyless
// tier is not for scheduled polling). Incremental cache: a pool's candles are re-fetched at most once per 20 hours.
const {NETWORKS,geckoAccess}=require('../lib/radar-v2/sources');
const POOL=/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i,REFRESH_MS=20*3600000,MAX_POOLS=240,MAX_CANDLES=90;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function loadCache(doc){
 const out={version:'arcy-ohlcv-cache-1',entries:{}};
 if(doc?.version!==out.version||!doc.entries||typeof doc.entries!=='object')return out;
 for(const [k,e] of Object.entries(doc.entries)){
  if(!/^\d+:0x[0-9a-f]+$/.test(k)||!Array.isArray(e?.rows)||!Number.isFinite(Date.parse(e.fetchedAt||'')))continue;
  const rows=e.rows.filter(x=>Array.isArray(x)&&x.length>=6&&x.slice(0,6).every(v=>typeof v==='number'&&Number.isFinite(v))).slice(-MAX_CANDLES);
  if(rows.length)out.entries[k]={fetchedAt:e.fetchedAt,source:String(e.source||'').slice(0,40),url:typeof e.url==='string'?e.url.slice(0,300):null,rows};
 }
 return out;
}
function pruneCache(c){const k=Object.keys(c.entries);if(k.length>MAX_POOLS){k.sort((a,b)=>Date.parse(c.entries[a].fetchedAt)-Date.parse(c.entries[b].fetchedAt));for(const x of k.slice(0,k.length-MAX_POOLS))delete c.entries[x];}return c;}
function provider({env=process.env,cache,fetcher=global.fetch,now=()=>Date.now(),maxCalls=40}={}){
 const access=geckoAccess(env);
 const allowed=access.mode==='demo'||access.mode==='pro'||(access.mode==='keyless'&&env.RADAR_OHLCV_KEYLESS==='1');
 const stats={mode:allowed?access.mode:'OFF:'+(access.mode==='keyless'?'KEYLESS_NOT_ALLOWED_FOR_THIS_RUN':access.mode),calls:0,cacheHits:0,errors:{}};
 if(!allowed)return {fn:null,stats};
 const gap=access.mode==='keyless'?13000:access.mode==='demo'?800:200;let lastCall=0;
 const fn=async(network,row)=>{
  const pool=String(row.pool||'').toLowerCase();if(!POOL.test(pool))return null;
  const key=NETWORKS[network].chainId+':'+pool,hit=cache.entries[key];
  if(hit&&now()-Date.parse(hit.fetchedAt)<REFRESH_MS){stats.cacheHits++;return {rows:hit.rows,url:hit.url,cached:true};}
  if(stats.calls>=maxCalls){stats.errors.BUDGET=(stats.errors.BUDGET||0)+1;return hit?{rows:hit.rows,url:hit.url,cached:true}:null;}
  const wait=lastCall+gap-Date.now();if(wait>0)await sleep(wait);
  const url=access.host+'/networks/'+NETWORKS[network].gecko+'/pools/'+pool+'/ohlcv/day?aggregate=1&limit=60&currency=usd&token=base';
  stats.calls++;lastCall=Date.now();
  let res;try{res=await fetcher(url,{headers:{accept:'application/json',...(access.key?{[access.header]:access.key}:{})},redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{stats.errors.NETWORK=(stats.errors.NETWORK||0)+1;return hit?{rows:hit.rows,url:hit.url,cached:true}:null;}
  if(!res.ok){stats.errors['HTTP_'+res.status]=(stats.errors['HTTP_'+res.status]||0)+1;return hit?{rows:hit.rows,url:hit.url,cached:true}:null;}
  let body;try{body=await res.json();}catch{stats.errors.JSON=(stats.errors.JSON||0)+1;return null;}
  const list=body?.data?.attributes?.ohlcv_list;
  if(!Array.isArray(list))return null;
  const rows=list.filter(x=>Array.isArray(x)&&x.length>=6).map(x=>x.slice(0,6).map(Number)).filter(x=>x.every(Number.isFinite)).sort((a,b)=>a[0]-b[0]).slice(-MAX_CANDLES);
  const pub='https://www.geckoterminal.com/'+NETWORKS[network].gecko+'/pools/'+pool;
  cache.entries[key]={fetchedAt:new Date(now()).toISOString(),source:'GECKOTERMINAL_OHLCV_'+access.mode.toUpperCase(),url:pub,rows};
  return {rows,url:pub,cached:false};
 };
 return {fn,stats};
}
module.exports={provider,loadCache,pruneCache,REFRESH_MS};
