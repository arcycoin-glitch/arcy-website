'use strict';
// Worker routes + background loop for the Market Radar indexer (Railway).
//   GET  /radar/snapshot/<network>   signed envelope (public; consumers verify the signature)
//   GET  /radar/status               audit (Bearer token)
//   POST /radar/refresh/<network>    run one incremental step now (Bearer token)
const crypto=require('node:crypto'),storage=require('./market-radar-storage'),indexer=require('./market-radar-indexer');
const matches=req=>/^\/radar(?:\/|$)/.test(req.url||'');
const authorized=req=>{const secret=process.env.ARC_RADAR_QUEUE_TOKEN||process.env.ARC_HOLDER_QUEUE_TOKEN,got=Buffer.from(req.headers.authorization||''),want=Buffer.from(secret?'Bearer '+secret:'');
 return !!secret&&got.length===want.length&&crypto.timingSafeEqual(got,want);};
const running=new Set();
async function handle(req,res){
 const url=new URL(req.url,'http://worker.local'),reply=(code,value)=>{res.statusCode=code;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));};
 const snap=/^\/radar\/snapshot\/([a-z]+)$/.exec(url.pathname);
 if(req.method==='GET'&&snap){
  if(!storage.KINDS.includes(snap[1]))return reply(404,{ok:false});
  const e=await storage.envelopeOf(snap[1]);
  if(!e)return reply(404,{ok:false,reasonCode:'RADAR_SNAPSHOT_MISSING'});
  res.setHeader('cache-control','public, max-age=0, must-revalidate');return reply(200,e);
 }
 if(!authorized(req))return reply(401,{ok:false});
 if(req.method==='GET'&&url.pathname==='/radar/status'){
  const pairs=await Promise.all(storage.KINDS.map(async n=>[n,await storage.readAudit(n).catch(()=>null)]));
  return reply(200,{networks:Object.fromEntries(pairs)});
 }
 const refresh=/^\/radar\/refresh\/([a-z]+)$/.exec(url.pathname);
 if(req.method==='POST'&&refresh&&storage.KINDS.includes(refresh[1])){
  const n=refresh[1];if(running.has(n))return reply(409,{ok:false,reasonCode:'RADAR_REFRESH_RUNNING'});
  running.add(n);
  try{const r=n==='pons'?await require('./pons-launch-indexer').run({budgetMs:50000}):await indexer.run(n,{budgetMs:50000});return reply(200,{ok:true,result:r});}
  catch(e){return reply(503,{ok:false,reasonCode:/^RADAR_[A-Z_]{3,60}$/.test(e.code||'')?e.code:'RADAR_INDEXER_FAILED'});}
  finally{running.delete(n);}
 }
 return reply(404,{ok:false});
}
let timer=null;
function startLoop(){
 if(timer||process.env.ARC_RADAR_INDEXER_ENABLED!=='true')return null;
 const every=Math.max(60000,Number(process.env.ARC_RADAR_INTERVAL_MS)||300000);
 const tick=async()=>{for(const n of storage.KINDS){if(running.has(n))continue;running.add(n);
  try{await (n==='pons'?require('./pons-launch-indexer').run({budgetMs:Math.min(every,240000)}):indexer.run(n,{budgetMs:Math.min(every,240000)}));}catch(e){console.warn('[radar-indexer]',n,e.code||'FAILED');}finally{running.delete(n);}}};
 timer=setInterval(()=>{tick().catch(()=>{});},every);tick().catch(()=>{});return timer;
}
module.exports={matches,handle,startLoop};
