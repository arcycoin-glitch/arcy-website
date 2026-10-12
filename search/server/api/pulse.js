'use strict';
// Read-only Pulse: first-party Arc/Circle sources, no publishing secrets or invented headlines.
const edition=require('../lib/pulse-edition');
const {enforce}=require('../lib/rate-limit');
let cached=null,inflight=null;
function sanitize(raw,now=Date.now()){
 if(raw?.success!==true||!['updated','quiet_week'].includes(raw.status)||
  typeof raw.generatedAt!=='string'||!Array.isArray(raw.cards))throw Error('Invalid Pulse edition');
 const current=edition.cycle(now);
 const origins=new Set(edition.SOURCES.map(s=>new URL(s.url).origin));
 const cards=[],seen=new Set();
 for(const c of raw.cards.slice(0,12)){
  if(!c?.url||typeof c.url!=='string'||typeof c.title!=='string')continue;
  let link;
  try{link=new URL(c.url)}catch{continue}
  const stamp=Date.parse(c.publishedAt);
  if(link.protocol!=='https:'||!origins.has(link.origin)||!Number.isFinite(stamp)||
   stamp<current.start||stamp>=current.end||stamp>now+60000||seen.has(link.href))continue;
  seen.add(link.href);
  cards.push({title:c.title.slice(0,170),summary:String(c.summary||'').slice(0,220),
   owner:String(c.owner||'').slice(0,60),publishedAt:new Date(stamp).toISOString(),sourceUrl:link.href});
  if(cards.length===5)break;
 }
 return {ok:true,status:cards.length?'UPDATED':'NO_VERIFIED_UPDATES',number:raw.number,
  cycle:{start:new Date(current.start).toISOString(),end:new Date(current.end).toISOString()},
  checkedAt:raw.generatedAt,cards,
  coverage:{checked:raw.audit?.sourcesSuccessfullyChecked??null,total:edition.SOURCES.length},
  methodology:'Dated first-party sources, current weekly window only. Empty means no verified update returned.'};
}
async function latest({now=Date.now(),collect=edition.generate}={}){
 const current=edition.cacheKey(now);
 if(cached&&cached.key===current&&cached.expires>now)return cached.value;
 if(inflight)return inflight;
 const job=(async()=>{
  const raw=await collect({now,trigger:'read-only'});
  const value=sanitize(raw,now);
  cached={key:current,value,expires:now+60*60*1000};
  return value;
 })();
 inflight=job;
 try{return await job}finally{if(inflight===job)inflight=null}
}
async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=300');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'GET_REQUIRED'});
 if(req.query&&Object.keys(req.query).length>0)return res.status(400).json({ok:false,error:'NO_PARAMETERS'});
 if(!enforce(req,res))return;
 try{return res.status(200).json(await latest())}
 catch{return res.status(503).json({ok:false,status:'SOURCE_UNAVAILABLE',cards:[],
  reason:'Official source coverage is temporarily unavailable; no outdated headline substituted.'})}
}
module.exports=handler;
module.exports.sanitize=sanitize;
module.exports.latest=latest;
