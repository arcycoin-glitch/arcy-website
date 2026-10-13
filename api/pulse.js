const crypto=require('node:crypto'),client=require('../lib/pulse-client'),edition=require('../lib/pulse-edition'),fallback=require('../lib/pulse-display-fallback');
function authorized(req){const secret=process.env.CRON_SECRET,provided=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(secret?'Bearer '+secret:'');return !!secret&&provided.length===expected.length&&crypto.timingSafeEqual(provided,expected);}
function cronRequest(req){return req.headers?.['x-vercel-cron']==='1'||/vercel-cron/i.test(req.headers?.['user-agent']||'');}
function fiveSections(raw){
 // Signed editions may predate the five-slot layout. Preserve their confirmed
 // stories, but fill missing categories with SOURCE NAVIGATION — not news.
 const items=Array.isArray(raw)?raw:[];
 const kinds=['week','new','watch','reality','unlock'];
 const stock=fallback.ITEMS;
 return kinds.map((kind,i)=>{
  const published=items.find(card=>card?.kind===kind&&typeof card.title==='string'&&card.title.trim()&&
   typeof card.summary==='string'&&card.summary.trim());
  return published||{...stock[i],publishedAt:null,verifiedCurrentWeek:false};
 });
}
function response(value,audit){return {ok:true,number:value.number,status:value.status,generatedAt:value.generatedAt,cycle:value.cycle,cards:fiveSections(value.cards),take:value.take||fallback.fallback().take,sources:value.sources,audit:{...value.audit,lastSuccessful:audit?.lastSuccessful||{number:value.number,status:value.status,generatedAt:value.generatedAt,trigger:value.trigger},lastFailure:audit?.lastFailure||null,nextScheduledAt:edition.nextRun()}};}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');const scheduled=cronRequest(req),manual=req.method==='POST'||req.query?.action==='refresh',auditOnly=req.query?.action==='audit';
 if(req.method==='GET'&&req.query?.action==='edition'){const number=Number(req.query.number);if(!Number.isSafeInteger(number)||number<1||number>9999)return res.status(400).json({ok:false,error:'INVALID_EDITION'});const saved=await client.edition(number);return saved?res.status(200).json(response(saved,null)):res.status(404).json({ok:false,error:'EDITION_NOT_FOUND',number});}
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
 // Even with provider outages, visitors receive five useful source-led
 // sections and ARCY Take; no headlines are forged or recycled as current.
 try{return res.status(200).json(response(await edition.generate({now,fetcher:fetch,trigger:'transient'}),null));}
 catch(error){return res.status(200).json(fallback.fallback(now,{reasonCode:error.code||'PULSE_SOURCE_CHECK_UNAVAILABLE'}));}
}
module.exports=handler;
module.exports.fiveSections=fiveSections;
