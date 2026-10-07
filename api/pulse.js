const crypto=require('node:crypto'),client=require('../lib/pulse-client'),edition=require('../lib/pulse-edition');
function authorized(req){const secret=process.env.CRON_SECRET,provided=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(secret?'Bearer '+secret:'');return !!secret&&provided.length===expected.length&&crypto.timingSafeEqual(provided,expected);}
function cronRequest(req){return req.headers?.['x-vercel-cron']==='1'||/vercel-cron/i.test(req.headers?.['user-agent']||'');}
function response(value,audit){return {ok:true,number:value.number,status:value.status,generatedAt:value.generatedAt,cycle:value.cycle,cards:value.cards,take:value.take,sources:value.sources,audit:{...value.audit,lastSuccessful:audit?.lastSuccessful||{number:value.number,status:value.status,generatedAt:value.generatedAt,trigger:value.trigger},lastFailure:audit?.lastFailure||null,nextScheduledAt:edition.nextRun()}};}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');const scheduled=cronRequest(req),manual=req.method==='POST'||req.query?.action==='refresh',auditOnly=req.query?.action==='audit';
 if(scheduled||manual||auditOnly){if(!authorized(req))return res.status(401).json({ok:false,error:'Unauthorized'});if(auditOnly){const audit=await client.audit();return res.status(audit?200:503).json(audit?{ok:true,...audit,nextScheduledAt:edition.nextRun()}:{ok:false,reasonCode:'PULSE_WORKER_UNAVAILABLE'});}const refreshed=await client.refresh(scheduled?'cron':'manual');if(!refreshed.ok||!refreshed.edition)return res.status(503).json({ok:false,reasonCode:refreshed.reasonCode||'PULSE_REFRESH_FAILED'});return res.status(200).json(response(refreshed.edition,await client.audit()));}
 const saved=await client.latest();if(saved)return res.status(200).json(response(saved,await client.audit()));
 // Visitors never publish an edition. This preserves the old read behavior
 // until the first authenticated cron/manual edition is available.
 try{return res.status(200).json(response(await edition.generate({now:Date.now(),fetcher:fetch,trigger:'transient'}),null));}catch(error){return res.status(503).json({ok:false,cards:[],message:'No dated official update is available for the current Pulse cycle.',number:edition.number(Date.now()),generatedAt:new Date().toISOString(),cycle:edition.cycle(Date.now()),sources:edition.SOURCES.map(source=>source.url),audit:{...(error.audit||{}),lastSuccessful:null,lastFailure:{at:new Date().toISOString(),code:error.code||'PULSE_REFRESH_FAILED'},nextScheduledAt:edition.nextRun()}});}
}
module.exports=handler;
