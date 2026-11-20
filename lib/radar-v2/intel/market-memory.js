'use strict';
// ARCY Radar V5 — persistent MARKET MEMORY (issue #279), `arcy-market-memory-1`.
// A token can rise +500% one day and show an ordinary 24h change the next: a one-day filter forgets that. This ledger keeps, per
// exact chainId+contract, the observations the snapshot builder actually made (and, once, the observations already published in
// earlier snapshots on the data branch). It never fabricates 7d/30d data: windows only contain real observations with their own
// timestamps and source. Stored inside the snapshot (bounded), carried run to run, validated before use.
const VERSION='arcy-market-memory-1';
const T=Object.freeze({
 EXTREME_RISE_24H:70,      // an observed 24h change >= +70% (same threshold as the current-day filter)
 EXTREME_DROP_24H:-50,     // an observed 24h change <= -50%
 RUNUP_MULTIPLE:3,         // observed price rose >= 3x inside the window (earlier low -> later high)
 COLLAPSE_FROM_PEAK:-60,   // latest observed price <= 40% of the window peak
 HISTORY_DAYS:14,          // window in which an extreme event keeps its context
 GROWTH_MIN_SPAN_HOURS:72, // growth needs two observations at least 3 days apart
 GROWTH_LIQ_PCT:20,        // liquidity +20% ...
 GROWTH_VOL_PCT:50,        // ... or volume +50% with liquidity not falling > 10%
 RETENTION_DAYS:30,MAX_OBS:90,MAX_KEYS:1200,MIN_GAP_MS:30*60000
});
const DAY=86400000,KEY=/^\d+:0x[0-9a-f]{40}$/;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=v=>finite(v)?+v.toPrecision(10):null;
function empty(){return {version:VERSION,updatedAt:null,entries:{}};}
// Accept only a well-formed ledger; anything else starts empty (never trusted partially).
function load(m){
 if(!m||m.version!==VERSION||!m.entries||typeof m.entries!=='object')return empty();
 const out=empty();out.updatedAt=typeof m.updatedAt==='string'?m.updatedAt:null;
 for(const [k,e] of Object.entries(m.entries)){
  if(!KEY.test(k)||!e||!Array.isArray(e.o))continue;
  const o=e.o.filter(x=>Array.isArray(x)&&x.length>=5&&Number.isFinite(x[0])&&[1,2,3,4].every(i=>x[i]===null||finite(x[i])))
   .sort((a,b)=>a[0]-b[0]).slice(-T.MAX_OBS);
  if(o.length)out.entries[k]={s:typeof e.s==='string'?e.s.slice(0,40):'',src:typeof e.src==='string'?e.src.slice(0,40):null,o};
 }
 return out;
}
// One observation per contract per run (and at least MIN_GAP apart); retention bounded.
function observe(mem,key,{symbol=null,at,priceUsd,change24hPct,liquidityUsd,volume24hUsd,source='RADAR_BUILDER'}={}){
 if(!KEY.test(key)||!Number.isFinite(at))return false;
 if(![priceUsd,change24hPct,liquidityUsd,volume24hUsd].some(finite))return false;
 const e=mem.entries[key]||(mem.entries[key]={s:symbol||'',src:source,o:[]});
 if(symbol)e.s=String(symbol).slice(0,40);
 const last=e.o[e.o.length-1];
 if(last&&Math.abs(at-last[0])<T.MIN_GAP_MS)return false;
 e.o.push([at,num(priceUsd),num(change24hPct),num(liquidityUsd),num(volume24hUsd)]);
 e.o.sort((a,b)=>a[0]-b[0]);
 const cut=at-T.RETENTION_DAYS*DAY;e.o=e.o.filter(x=>x[0]>=cut).slice(-T.MAX_OBS);
 return true;
}
function prune(mem,now){
 const cut=now-T.RETENTION_DAYS*DAY;
 for(const [k,e] of Object.entries(mem.entries)){e.o=e.o.filter(x=>x[0]>=cut);if(!e.o.length)delete mem.entries[k];}
 const keys=Object.keys(mem.entries);
 if(keys.length>T.MAX_KEYS){keys.sort((a,b)=>mem.entries[a].o.at(-1)[0]-mem.entries[b].o.at(-1)[0]);for(const k of keys.slice(0,keys.length-T.MAX_KEYS))delete mem.entries[k];}
 mem.updatedAt=new Date(now).toISOString();
 return mem;
}
// Seed once from snapshots already published on the data branch (real, timestamped observations of displayed rows).
function backfill(mem,snapshots){
 let added=0;
 for(const snap of Array.isArray(snapshots)?snapshots:[]){
  for(const [network,sec] of Object.entries(snap?.sections||{})){
   const chainId=({arc:5042,ethereum:1,robinhood:4663,pons:4663})[network];if(!chainId)continue;
   const rows=[...(Array.isArray(sec?.rows)?sec.rows:[]),...(Array.isArray(sec?.presentation?.watchlist)?sec.presentation.watchlist:[])];
   for(const r of rows){
    const at=Date.parse(r?.measuredAt||sec?.sourceRadarAsOf||sec?.asOf||'');
    const a=String(r?.address||'').toLowerCase();
    if(observe(mem,chainId+':'+a,{symbol:r.symbol,at,priceUsd:r.priceUsd,change24hPct:r.change24hPct,liquidityUsd:r.liquidityUsd,volume24hUsd:r.volume24hUsd,source:'PUBLISHED_SNAPSHOT_HISTORY'}))added++;
   }
  }
 }
 return added;
}
// Historical context of one contract at `now`. Flags are evidence, never accusations.
function assess(mem,key,now){
 const e=mem?.entries?.[key];
 const w=e?e.o.filter(x=>x[0]>=now-T.HISTORY_DAYS*DAY&&x[0]<=now+5*60000):[];
 const res={version:VERSION,observations:w.length,from:w.length?new Date(w[0][0]).toISOString():null,to:w.length?new Date(w.at(-1)[0]).toISOString():null,flags:[],
  peak24hRisePct:null,peak24hRiseAt:null,worst24hPct:null,maxRunupMultiple:null,drawdownFromPeakPct:null,growth:null,coverage:w.length>=2?'OBSERVED':w.length===1?'SINGLE_OBSERVATION':'NONE'};
 if(!w.length)return res;
 const ch=w.filter(x=>finite(x[2]));
 if(ch.length){const mx=ch.reduce((a,x)=>x[2]>a[2]?x:a);const mn=ch.reduce((a,x)=>x[2]<a[2]?x:a);
  res.peak24hRisePct=mx[2];res.peak24hRiseAt=new Date(mx[0]).toISOString();res.worst24hPct=mn[2];
  if(mx[2]>=T.EXTREME_RISE_24H)res.flags.push('EXTREME_24H_RISE_OBSERVED');
  if(mn[2]<=T.EXTREME_DROP_24H)res.flags.push('EXTREME_24H_DROP_OBSERVED');}
 const px=w.filter(x=>finite(x[1])&&x[1]>0);
 if(px.length>=2){
  let low=px[0][1],best=1;for(const x of px){best=Math.max(best,x[1]/low);low=Math.min(low,x[1]);}
  res.maxRunupMultiple=+best.toFixed(2);if(best>=T.RUNUP_MULTIPLE)res.flags.push('PRICE_RUNUP_MULTIPLE_OBSERVED');
  const peak=Math.max(...px.map(x=>x[1])),last=px.at(-1)[1];res.drawdownFromPeakPct=+((last/peak-1)*100).toFixed(1);
  if(res.drawdownFromPeakPct<=T.COLLAPSE_FROM_PEAK)res.flags.push('COLLAPSE_FROM_PEAK_OBSERVED');
 }
 // growth evidence: two observations >= 72h apart within the window
 const last=w.at(-1),first=w.find(x=>last[0]-x[0]>=T.GROWTH_MIN_SPAN_HOURS*3600000);
 if(first){
  const lg=finite(first[3])&&first[3]>0&&finite(last[3])?(last[3]/first[3]-1)*100:null,vg=finite(first[4])&&first[4]>0&&finite(last[4])?(last[4]/first[4]-1)*100:null;
  res.growth={spanHours:Math.round((last[0]-first[0])/3600000),liquidityPct:lg===null?null:+lg.toFixed(1),volumePct:vg===null?null:+vg.toFixed(1)};
  if((lg!==null&&lg>=T.GROWTH_LIQ_PCT)||(vg!==null&&vg>=T.GROWTH_VOL_PCT&&lg!==null&&lg>=-10))res.flags.push('ACTIVITY_GROWTH_OBSERVED');
 }
 return res;
}
const EXTREME=new Set(['EXTREME_24H_RISE_OBSERVED','EXTREME_24H_DROP_OBSERVED','PRICE_RUNUP_MULTIPLE_OBSERVED','COLLAPSE_FROM_PEAK_OBSERVED']);
const extreme=h=>Boolean(h?.flags?.some(f=>EXTREME.has(f)));
function validate(m){
 if(m===undefined||m===null)return {ok:true};
 if(m.version!==VERSION||!m.entries||typeof m.entries!=='object')return {ok:false,reason:'MARKET_MEMORY_INVALID'};
 const keys=Object.keys(m.entries);
 if(keys.length>T.MAX_KEYS||keys.some(k=>!KEY.test(k)||!Array.isArray(m.entries[k]?.o)||m.entries[k].o.length>T.MAX_OBS))return {ok:false,reason:'MARKET_MEMORY_INVALID'};
 return {ok:true};
}
module.exports={VERSION,T,empty,load,observe,prune,backfill,assess,extreme,validate,EXTREME};
