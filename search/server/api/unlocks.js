'use strict';
// Original ARCY unlock calendar, with "confirmed" and "source reported" explicitly separated.
const calendar=require('../lib/unlock-calendar');
const registry=require('../assets/unlock-logos.json');
const {safeLogoUrl}=require('../lib/token-image');
const {enforce}=require('../lib/rate-limit');
let cache=null,inflight=null;
function logo(name,symbol){
 if(typeof name!=='string'||typeof symbol!=='string')return null;
 const names=Array.isArray(registry.logos)?registry.logos:[];
 const matched=names.find(x=>x.name?.trim().toLocaleLowerCase('en-US')===name.trim().toLocaleLowerCase('en-US')&&
  x.symbol===symbol);
 return matched?safeLogoUrl(matched.logo):null;
}
function select(raw,now=Date.now()){
 if(raw?.success!==true||!Array.isArray(raw.events)||!raw.events.every(e=>typeof e==='object'&&e))
  throw Error('Invalid unlock edition');
 const start=new Date(now).toISOString().slice(0,10),end=new Date(now+30*86400000).toISOString().slice(0,10);
 const seen=new Set(),confirmed=[],reported=[];
 for(const e of raw.events.slice(0,500)){
  if(typeof e.name!=='string'||typeof e.symbol!=='string'||typeof e.date!=='string'||typeof e.amount!=='string'||
   !/^\d{4}-\d{2}-\d{2}$/.test(e.date)||e.date<start||e.date>end||
   !['project-confirmed','source-published'].includes(e.verification))continue;
  const proof=typeof e.sourceUrl==='string'?e.sourceUrl:'';
  let u;try{u=new URL(proof)}catch{continue}
  if(u.protocol!=='https:')continue;
  const key=JSON.stringify([e.name.toLowerCase(),e.symbol,e.date,e.amount,e.allocation||'']);
  if(seen.has(key))continue;seen.add(key);
  const item={name:e.name.slice(0,75),symbol:e.symbol.slice(0,20),date:e.date,
   amount:e.amount.slice(0,60),sourceUrl:u.href,verification:e.verification,
   logoUrl:logo(e.name,e.symbol),
   sourceLabel:e.verification==='project-confirmed'?'Issuer-documented event':'Third-party published calendar'};
  (e.verification==='project-confirmed'?confirmed:reported).push(item);
 }
 return {ok:true,status:confirmed.length?'CONFIRMED_EVENTS':reported.length?'SOURCE_REPORTED_ONLY':'NO_VERIFIED_EVENTS',
  generatedAt:raw.generatedAt,period:{start,end},confirmed:confirmed.slice(0,5),
  reported:reported.slice(0,5),coverage:raw.coverage?.sources?.map(x=>({url:x.url,status:x.status}))||[],
  note:'Published calendar rows are NOT issuer-verified unlocks. Estimated or conflicted schedules are excluded.'};
}
async function latest({now=Date.now(),collect=calendar.generate}={}){
 if(cache&&cache.expires>now)return cache.data;
 if(inflight)return inflight;
 const work=(async()=>{const edition=await collect({now,trigger:'read-only'});
  const data=select(edition,now);
  cache={expires:now+6*3600000,data};return data})();
 inflight=work;
 try{return await work}finally{if(inflight===work)inflight=null}
}
async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','public, s-maxage=21600, stale-while-revalidate=300');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 if(req.query&&Object.keys(req.query).length>0)return res.status(400).json({ok:false,error:'NO_PARAMETERS'});
 if(!enforce(req,res))return;
 try{return res.status(200).json(await latest())}
 catch{return res.status(503).json({ok:false,status:'SOURCE_UNAVAILABLE',confirmed:[],reported:[],
  reason:'Published unlock schedules temporarily unavailable; no estimates shown.'})}
}
module.exports=handler;
module.exports.select=select;
module.exports.logo=logo;
module.exports.latest=latest;
