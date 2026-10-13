const crypto=require('node:crypto'),client=require('../lib/pulse-client'),edition=require('../lib/pulse-edition'),fallback=require('../lib/pulse-display-fallback');
function authorized(req){const secret=process.env.CRON_SECRET,provided=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(secret?'Bearer '+secret:'');return !!secret&&provided.length===expected.length&&crypto.timingSafeEqual(provided,expected);}
function cronRequest(req){return req.headers?.['x-vercel-cron']==='1'||/vercel-cron/i.test(req.headers?.['user-agent']||'');}
function threeSections(raw,{status='updated',cycle=null}={}){
 // The signed weekly publisher still owns its existing stored edition.
 // Current homepage only: three informative, non-repeating editorial slots.
 const items=Array.isArray(raw)?raw:[];
 const defaults=fallback.ITEMS;
 const valid=item=>{
  if(status==='quiet_week'||item?.verifiedCurrentWeek===false)return false;
  if(!item||typeof item.title!=='string'||!item.title.trim()||
   typeof item.summary!=='string'||!item.summary.trim()||
   typeof item.url!=='string'||!/^https:\/\//i.test(item.url))return false;
  const time=Date.parse(item.publishedAt||'');
  if(!Number.isFinite(time))return false;
  const from=Date.parse(cycle?.start||''),to=Date.parse(cycle?.end||'');
  return Number.isFinite(from)&&Number.isFinite(to)&&time>=from&&time<to;
 };
 const source=items.filter(valid),used=new Set();
 const choose=(kinds,slot)=>{
  const item=source.find(x=>kinds.includes(x.kind)&&!used.has(x.url));
  if(!item)return {...defaults[slot],publishedAt:null,verifiedCurrentWeek:false,contentType:'SOURCE_GUIDE'};
  used.add(item.url);
  return {...item,kind:defaults[slot].kind,verifiedCurrentWeek:true,contentType:'VERIFIED_DEVELOPMENT'};
 };
 return [choose(['week'],0),choose(['new','watch'],1),choose(['unlock','reality'],2)];
}
function response(value,audit,{archive=false}={}){
 const display=archive?value.cards:threeSections(value.cards,{status:value.status,cycle:value.cycle});
 const neutralTake=fallback.fallback().take;
 return {ok:true,number:value.number,status:value.status,generatedAt:value.generatedAt,
  cycle:value.cycle,cards:display,
  take:archive?value.take:(value.status==='updated'&&display.some(c=>c.verifiedCurrentWeek===true)?value.take||neutralTake:neutralTake),
  sources:value.sources,
  audit:{...value.audit,lastSuccessful:audit?.lastSuccessful||{
   number:value.number,status:value.status,generatedAt:value.generatedAt,trigger:value.trigger
  },lastFailure:audit?.lastFailure||null,nextScheduledAt:edition.nextRun()}};
}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');const scheduled=cronRequest(req),manual=req.method==='POST'||req.query?.action==='refresh',auditOnly=req.query?.action==='audit';
 if(req.method==='GET'&&req.query?.action==='edition'){const number=Number(req.query.number);if(!Number.isSafeInteger(number)||number<1||number>9999)return res.status(400).json({ok:false,error:'INVALID_EDITION'});const saved=await client.edition(number);return saved?res.status(200).json(response(saved,null,{archive:true})):res.status(404).json({ok:false,error:'EDITION_NOT_FOUND',number});}
 if(scheduled||manual||auditOnly){if(!authorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});if(auditOnly){const audit=await client.audit();return res.status(audit?200:503).json(audit?{ok:true,...audit,nextScheduledAt:edition.nextRun()}:{ok:false,reasonCode:'PULSE_WORKER_UNAVAILABLE'});}const refreshed=await client.refresh(scheduled?'cron':'manual');if(!refreshed.ok||!refreshed.edition)return res.status(503).json({ok:false,reasonCode:refreshed.reasonCode||'PULSE_REFRESH_FAILED'});return res.status(200).json(response(refreshed.edition,await client.audit()));}
 const now=Date.now();
 const saved=await client.latest();
 // An older verified edition belongs to its original cycle; never relabel
 // archived developments as new news for the current Monday-to-Monday cycle.
 if(saved){
  const week=edition.cycle(now),start=Date.parse(saved.cycle?.start||'');
  // The authenticated publication validator rejects malformed editions in
  // production. Preserve the historical saved-read contract for older mocks
  // and legacy signed documents that did not publish cycle.start.
  if(!saved.cycle?.start||start===week.start)
   return res.status(200).json(response(saved,await client.audit()));
  return res.status(200).json(fallback.fallback(now,{reasonCode:'LAST_VERIFIED_EDITION_OUTDATED',lastEdition:saved}));
 }
 // Even with provider outages, visitors receive three useful source-led
 // sections and ARCY Take; no headlines are forged or recycled as current.
 try{return res.status(200).json(response(await edition.generate({now,fetcher:fetch,trigger:'transient'}),null));}
 catch(error){return res.status(200).json(fallback.fallback(now,{reasonCode:error.code||'PULSE_SOURCE_CHECK_UNAVAILABLE'}));}
}
module.exports=handler;
module.exports.threeSections=threeSections;
