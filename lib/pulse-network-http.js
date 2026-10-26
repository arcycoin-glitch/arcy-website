'use strict';
const crypto=require('node:crypto'),research=require('./pulse-networks'),storage=require('./pulse-network-storage');
function matches(req){return /^\/pulse\/networks(?:\/|$)/.test(req.url||'');}
async function handle(req,res){const url=new URL(req.url,'http://worker.local'),reply=(code,value)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));};
 if(req.method==='GET'&&url.pathname==='/pulse/networks/latest'){const pairs=await Promise.all(Object.keys(research.CONFIG).map(async c=>[c,await storage.envelope(c).catch(()=>null)]));return reply(200,{chains:Object.fromEntries(pairs)});}
 const archive=/^\/pulse\/networks\/edition\/(ethereum|robinhood)\/([1-9][0-9]{0,3})$/.exec(url.pathname);if(req.method==='GET'&&archive){const d=await storage.envelope(archive[1],Number(archive[2])).catch(()=>null);return reply(d?200:404,d||{ok:false,reasonCode:'EDITION_NOT_FOUND'});}
 const secret=process.env.ARC_PULSE_QUEUE_TOKEN||process.env.ARC_HOLDER_QUEUE_TOKEN,got=Buffer.from(req.headers.authorization||''),expected=Buffer.from(secret?'Bearer '+secret:'');if(!secret||got.length!==expected.length||!crypto.timingSafeEqual(got,expected))return reply(401,{ok:false});
 if(req.method==='GET'&&url.pathname==='/pulse/networks/audit'){const pairs=await Promise.all(Object.keys(research.CONFIG).map(async c=>[c,await storage.audit(c).catch(()=>null)]));return reply(200,{chains:Object.fromEntries(pairs)});}
 if(req.method==='POST'&&url.pathname==='/pulse/networks/refresh'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{ok:false});}const trigger=JSON.parse(body||'{}').trigger==='cron'?'cron':'manual';const pairs=await Promise.all(Object.keys(research.CONFIG).map(async chain=>[chain,await storage.refresh(chain,{trigger}).catch(()=>({ok:false,reasonCode:'PULSE_STORAGE_UNAVAILABLE'}))]));return reply(200,{chains:Object.fromEntries(pairs)});}catch{return reply(400,{ok:false,reasonCode:'INVALID_PULSE_REQUEST'});}}
 return reply(404,{ok:false});
}
module.exports={matches,handle};
