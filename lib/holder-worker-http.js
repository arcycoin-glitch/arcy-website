const http=require('node:http'),crypto=require('node:crypto'),storage=require('./holder-storage');
// Radar is optional: a load failure must never stop the Holder worker.
// The Radar indexer module is optional and is not part of this image unless the indexer is explicitly enabled;
// without the flag it is not looked up at all, so a missing optional module is not logged as a failure.
let radarCache;function radarModule(){if(radarCache===undefined&&process.env.ARC_RADAR_INDEXER_ENABLED!=='true')radarCache=null;if(radarCache===undefined){try{radarCache=require('./market-radar-http');}catch(e){console.error('radar module unavailable:',e&&e.code||'error');radarCache=null;}}return radarCache;}
// Secret-free runtime counters for the authenticated diagnostics route: real RPC/pacing/cooldown/budget numbers and
// per-token cursor progress. ?probe=0 returns only these counters (no live provider probes, no RPC cost).
const STARTED_AT=new Date().toISOString();
function workerStats(c){
 const fin=n=>Number.isFinite(n)?Math.round(n):null,refresh=require('./holder-refresh'),progress=require('./holder-progress').snapshot();
 return {runtime:{commit:/^[0-9a-f]{7,40}$/i.test(process.env.RAILWAY_GIT_COMMIT_SHA||'')?process.env.RAILWAY_GIT_COMMIT_SHA.slice(0,12):null,startedAt:STARTED_AT},limits:refresh.limits(),rpc:{metrics:c.metrics(),readyInMs:fin(c.readyInMs()),providers:c.health()},scheduler:{totals:progress.totals,lastInvocation:progress.lastInvocation},risk:(()=>{try{const w=require('./risk-engine/worker');return w.enabled()?{enabled:true,...w.metrics()}:{enabled:false};}catch{return {enabled:false,reasonCode:'RISK_WORKER_UNAVAILABLE'};}})(),tokens:progress.tokens.map(t=>({address:t.address,phase:t.phase,cursor:t.cursor,target:t.target,remainingBlocks:t.remainingBlocks,remainingBalances:t.remainingBalances,remainingCalls:t.remainingCalls,width:t.width,candidates:t.candidates,advancedTotal:t.advancedTotal,slices:t.slices,yields:t.yields,failures:t.failures,completes:t.completes,lastState:t.lastState,lastReason:t.lastReason,lastAdvanced:t.lastAdvanced,lastSliceMs:t.lastSliceMs,idleMs:t.idleMs}))};
}
function start(){const token=process.env.ARC_HOLDER_QUEUE_TOKEN;if(!process.env.PORT||!token)return null;
 const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');const reply=(status,d)=>{res.statusCode=status;res.end(JSON.stringify(d));};
 if(req.method==='GET'&&(req.url||'').split('?')[0]==='/holder/rpc-diagnostics'){const secret=process.env.ARC_HOLDER_QUEUE_TOKEN,got=Buffer.from(req.headers.authorization||''),want=Buffer.from(secret?'Bearer '+secret:'');if(!secret||got.length!==want.length||!crypto.timingSafeEqual(got,want))return reply(401,{ok:false});try{const c=require('./holder-rpc').current();return reply(200,{ok:true,configured:{arcRpcUrlSet:!!process.env.ARC_RPC_URL,fallbackUrlsSet:!!process.env.ARC_RPC_FALLBACK_URLS,providers:c.providerLabels()},providers:new URL(req.url,'http://worker.local').searchParams.get('probe')==='0'?undefined:await c.diagnose(),worker:workerStats(c)});}catch{return reply(503,{ok:false});}}
 const radar=radarModule();if(radar&&radar.matches(req))return radar.handle(req,res).catch(()=>reply(503,{ok:false,reasonCode:'RADAR_UNAVAILABLE'}));
 if(require('./pulse-network-http').matches(req))return require('./pulse-network-http').handle(req,res).catch(()=>reply(503,{ok:false,reasonCode:'PULSE_NETWORK_PUBLICATION_UNAVAILABLE'}));
 const match=/^\/snapshots\/(0x[0-9a-f]{40})\.json$/.exec(req.url||'');
 if(req.method==='GET'&&match){try{const publication=require('./holder-publication');if(!process.env.ARC_HOLDER_SIGNING_KEY||!await publication.read(match[1]))return reply(404,{});
 const file=require('node:path').join(publication.directory(),match[1]+'.json'),d=JSON.parse(await require('node:fs/promises').readFile(file,'utf8'));res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,d);
 }catch{return reply(404,{});}}
 if(req.method==='GET'&&(req.url==='/pulse/latest'||req.url==='/pulse/latest.json')){try{const d=await require('./pulse-storage').latest();if(!d)return reply(404,{});const file=require('node:path').join(require('./pulse-storage').base(),'latest.json');res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,JSON.parse(await require('node:fs/promises').readFile(file,'utf8')));}catch{return reply(404,{})}}
  const pulseEdition=/^\/pulse\/edition\/([1-9][0-9]{0,3})$/.exec(req.url||'');
  if(req.method==='GET'&&pulseEdition){try{const number=Number(pulseEdition[1]),stored=require('./pulse-storage');if(!await stored.edition(number))return reply(404,{});const file=require('node:path').join(stored.base(),`pulse-${number}.json`);res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,JSON.parse(await require('node:fs/promises').readFile(file,'utf8')));}catch{return reply(404,{})}}
 if(req.method==='GET'&&(req.url==='/unlocks/latest'||req.url==='/unlocks/latest.json')){try{const d=await require('./unlock-storage').latest();if(!d)return reply(404,{});const file=require('node:path').join(require('./unlock-storage').base(),'latest.json');res.setHeader('cache-control','public, max-age=0, must-revalidate, stale-if-error=86400');return reply(200,JSON.parse(await require('node:fs/promises').readFile(file,'utf8')));}catch{return reply(404,{})}}
 const expected=Buffer.from('Bearer '+token),given=Buffer.from(req.headers.authorization||'');
 if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))return reply(401,{queued:false});
 if(req.method==='GET'&&req.url==='/pulse/audit'){try{return reply(200,await require('./pulse-storage').audit()||{});}catch{return reply(503,{ok:false});}}
 if(req.method==='GET'&&req.url==='/unlocks/audit'){try{return reply(200,await require('./unlock-storage').audit()||{});}catch{return reply(503,{ok:false});}}
 if(req.method==='GET'&&/^\/job\?address=0x[0-9a-f]{40}$/i.test(req.url||'')){try{const address=new URL(req.url,'http://worker.local').searchParams.get('address').toLowerCase();return reply(200,{ok:true,job:await storage.jobStatus(address)});}catch{return reply(503,{ok:false,reasonCode:'HOLDER_JOB_STATUS_UNAVAILABLE'});}}
 if(req.method==='POST'&&req.url==='/pulse/refresh'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{ok:false});}const trigger=JSON.parse(body||'{}').trigger==='cron'?'cron':'manual',pulse=require('./pulse-edition'),stored=require('./pulse-storage');try{const d=await pulse.generate({trigger});await stored.publish(d);return reply(200,{ok:true,edition:JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(stored.base(),'latest.json'),'utf8'))});}catch(error){await stored.failure(error,Date.now(),trigger);return reply(503,{ok:false,reasonCode:error.code||'PULSE_REFRESH_FAILED'});}}catch{return reply(503,{ok:false,reasonCode:'PULSE_REFRESH_FAILED'});}}
 if(req.method==='POST'&&req.url==='/unlocks/refresh'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{ok:false});}const trigger=JSON.parse(body||'{}').trigger==='cron'?'cron':'manual',calendar=require('./unlock-calendar'),stored=require('./unlock-storage');try{const d=await calendar.generate({trigger});await stored.publish(d);return reply(200,{ok:true,edition:JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(stored.base(),'latest.json'),'utf8'))});}catch(error){await stored.failure(error,Date.now(),trigger);return reply(503,{ok:false,reasonCode:error.code||'UNLOCK_REFRESH_FAILED'});}}catch{return reply(503,{ok:false,reasonCode:'UNLOCK_REFRESH_FAILED'});}}
 if(req.method==='POST'&&req.url==='/quota/radar/verified-pons'){
  try{
   let body='';
   for await(const chunk of req){body+=chunk;if(body.length>145000)return reply(413,{ok:false,reasonCode:'SNAPSHOT_TOO_LARGE'});}
   const result=await require('./radar-verified-snapshot-store').apply(JSON.parse(body));
   return reply(result.ok?200:result.reasonCode==='SNAPSHOT_REQUEST_INVALID'?400:503,result);
  }catch{return reply(400,{ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'});}
 }
 if(req.method==='POST'&&req.url==='/quota/radar'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>512)return reply(413,{ok:false});}const r=await require('./quota-store').apply(JSON.parse(body));return reply(r.ok?200:(r.reasonCode==='QUOTA_REQUEST_INVALID'?400:503),r);}catch{return reply(400,{ok:false,reasonCode:'QUOTA_REQUEST_INVALID'});}}
 // The new Search-only route is deliberately distinct. Older workers return 404 rather than
 // treating first-time public requests as unrestricted legacy /queue writes.
 const isMissing=req.url==='/queue-missing';
 if(req.method!=='POST'||(!isMissing&&req.url!=='/queue'))return reply(404,{queued:false});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return reply(413,{queued:false});}const d=JSON.parse(body);
 if(d.chainId!==5042||!/^0x[0-9a-f]{40}$/i.test(d.address||''))return reply(400,{queued:false});
 const address=d.address.toLowerCase();
 if(isMissing){
  const job=await storage.jobStatus(address);
  // Missing published JSON does not imply missing worker work or lost checkpoints.
  if(job.hasCompleteSnapshot)return reply(409,{queued:false,reasonCode:'HOLDER_COMPLETE_NOT_PUBLISHED'});
  if(job.queued)return reply(202,{queued:true,coalesced:true,job});
  const admission=await require('./holder-search-admission').reserve();
  if(!admission.ok)return reply(503,{queued:false,reasonCode:admission.reasonCode});
  if(!admission.granted)return reply(429,{queued:false,reasonCode:admission.reasonCode,retryInMs:admission.retryInMs||null});
 }
 const queued=await storage.enqueue(address);
 reply(queued?202:503,{queued,job:queued?await storage.jobStatus(address):null});
 }catch{reply(503,{queued:false});}
 }).listen(Number(process.env.PORT),'0.0.0.0');
 if(process.env.ARC_RADAR_INDEXER_ENABLED==='true'){const radar=radarModule();if(radar)try{radar.startLoop();}catch(e){console.error('radar loop not started:',e&&e.code||'error');}}
 return server;
}
module.exports={start};
