'use strict';
// Bounded in-week retry for the signed Arc Pulse edition (2026-11-07 incident).
// The only publisher used to be the Monday 06:00 UTC Vercel cron (one attempt per week). One transient source failure
// therefore left the whole cycle without a signed edition (2026-11-02: PULSE_SOURCE_COVERAGE_INCOMPLETE, edition #6
// never published). The durable worker now retries ONLY when the CURRENT cycle has no signed edition, never before the
// cron's own window has passed, at most once per RETRY_MS, with the same generator, validation and signing path.
// It never re-publishes a cycle that already has an edition, never back-fills an old cycle and never forces a number.
const HOUR=3600000;
const GRACE_MS=7*HOUR;      // Monday 00:00 UTC + 7 h: the 06:00 cron always gets the first attempt.
const RETRY_MS=6*HOUR;      // <= 4 attempts per day while failing; each attempt is one normal source check.
let running=null,announced=false;
function configured(env=process.env){
 return Boolean((env.ARC_PULSE_EDITION_DIR||env.ARC_HOLDER_PUBLISHED_DIR)&&(env.ARC_PULSE_SIGNING_KEY||env.ARC_HOLDER_SIGNING_KEY));
}
function monitorSummary(states){
 return Object.fromEntries(Object.entries(states||{}).map(([chain,state])=>[chain,{
  status:state?.status||'UNAVAILABLE',complete:state?.complete===true,reasonCode:state?.reasonCode||state?.lastAttempt?.reasonCode||null,
  ...(state?.skipped?{skipped:true}:{}),...(state?.lag?{lag:{state:state.lag.state,blocks:state.lag.blocks??null,seconds:state.lag.seconds??null}}:{}),rpcCalls:state?.rpcCalls??state?.lastAttempt?.cost?.rpcCalls??0,
  coverage:state?.coverage?{startBlock:state.coverage.startBlock,nextBlock:state.coverage.nextBlock,lastSuccessfulBlock:state.coverage.lastSuccessfulBlock,
   completeFromGenesis:state.coverage.completeFromGenesis,retainedEvents:state.coverage.retainedEvents}:null,
  ...(state?.lastAttempt?.at?{lastAttemptAt:state.lastAttempt.at}:{})
 }]));
}
async function due({now=Date.now(),storage=require('./pulse-storage'),edition=require('./pulse-edition')}={}){
 const current=edition.cycle(now);
 if(now<current.start+GRACE_MS)return {due:false,reason:'CRON_WINDOW'};
 const latest=await storage.latest();
 if(latest&&Date.parse(latest.cycle?.start||'')===current.start)return {due:false,reason:'CURRENT_CYCLE_PUBLISHED'};
 if(latest&&latest.number>=edition.number(now))return {due:false,reason:'NUMBER_NOT_NEWER'};
 const audit=await storage.audit(),failedAt=Date.parse(audit?.lastFailure?.at||'');
 if(Number.isFinite(failedAt)&&now-failedAt<RETRY_MS)return {due:false,reason:'RETRY_BACKOFF'};
 return {due:true,reason:latest?'CURRENT_CYCLE_MISSING':'NO_SIGNED_EDITION'};
}
// Failure classes for the worker log. Only a class, a reason code and (for a missing module) the file's base name
// are reported: never a path, URL, token or provider message.
function classify(error){
 const code=typeof error?.code==='string'&&/^[A-Z_0-9]{1,80}$/.test(error.code)?error.code:null;
 if(code==='MODULE_NOT_FOUND'||code==='ERR_MODULE_NOT_FOUND'){
  const missing=/Cannot find module '([^']+)'/.exec(String(error.message||''));
  return {failureClass:'MODULE_NOT_FOUND',reasonCode:'PULSE_WORKER_MODULE_MISSING',...(missing?{module:missing[1].split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g,'').slice(0,60)}:{})};
 }
 if(code&&/^(ENOENT|EACCES|EPERM|EROFS|ENOSPC|EIO)$/.test(code)||code&&/CHECKPOINT|STORAGE|EDITION_REGRESSION/.test(code))return {failureClass:'STORAGE',reasonCode:code};
 if(code&&/^ONCHAIN_|RPC/.test(code))return {failureClass:'RPC',reasonCode:code};
 if(code&&/^PULSE_SOURCE|SOURCE_|HTTP_|FETCH|TIMEOUT/.test(code))return {failureClass:'UPSTREAM_SOURCE',reasonCode:code};
 if(error instanceof SyntaxError||error instanceof TypeError||error instanceof ReferenceError)return {failureClass:'WORKER_INTEGRATION',reasonCode:code||error.name.toUpperCase()};
 return {failureClass:'UNCLASSIFIED',reasonCode:code||'PULSE_REFRESH_FAILED'};
}
// onchainMonitor is loaded lazily and only when the monitor is enabled: a problem in the on-chain module tree must
// never stop the signed weekly edition, and a disabled monitor must cost nothing.
async function refreshIfDue({now=Date.now(),fetcher=fetch,env=process.env,storage=require('./pulse-storage'),edition=require('./pulse-edition'),onchainMonitor=null,newsRefresh=null}={}){
 if(running)return running;
 // Announced once per process: which Pulse components this worker runs (booleans only; no paths or keys).
 if(!announced&&env===process.env){announced=true;console.log(JSON.stringify({event:'PULSE_WORKER_CONFIG',onchainMonitorEnabled:env.ARC_PULSE_ONCHAIN_ENABLED==='1',
  checkpointStorageConfigured:Boolean(env.ARC_PULSE_ONCHAIN_DIR||env.ARC_PULSE_EDITION_DIR||env.ARC_HOLDER_PUBLISHED_DIR),signedEditionConfigured:configured(env)}));}
 running=(async()=>{
  let onchain=null;
  // News polling uses its own time, storage and cooldown, independent of the signed weekly edition.
  // Start without delaying holder reconciliation or letting a news failure change the weekly result.
  if(newsRefresh||(env===process.env&&env.ARC_PULSE_NEWS_ENABLED!=='0'&&configured(env))){
   try{
    const refresh=newsRefresh||require('./pulse-news-storage').worker.refreshIfDue;
    void Promise.resolve(refresh({fetcher})).then(result=>{
     if(result&&env===process.env)console.log(JSON.stringify({event:'PULSE_NEWS_REFRESH',...result}));
    }).catch(()=>{});
   }catch{console.error(JSON.stringify({event:'PULSE_NEWS_REFRESH_FAILED'}));}
  }
  try{
  // Persistent event monitoring is explicitly enabled and remains isolated from signed edition retries.
  if(env.ARC_PULSE_ONCHAIN_ENABLED==='1')try{onchain=monitorSummary(await (onchainMonitor||require('./pulse-onchain/monitor')).refreshAll({now,env,fetcher}));}catch(error){onchain={status:'FAILED',reasonCode:'PULSE_ONCHAIN_MONITOR_FAILED',failure:classify(error)};}
  let publication=null;
  if(configured(env)){
   const state=await due({now,storage,edition});
   if(state.due)try{const d=await edition.generate({now,fetcher,trigger:'worker'});await storage.publish(d);publication={state:'PUBLISHED',number:d.number,status:d.status,reason:state.reason};}
   catch(error){try{await storage.failure(error,now,'worker');}catch{}publication={state:'FAILED',component:'SIGNED_EDITION',reasonCode:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'PULSE_REFRESH_FAILED',failureClass:classify(error).failureClass,reason:state.reason};}
  }
  if(publication)return onchain?{...publication,onchain}:publication;
  return onchain?{state:'ONCHAIN_MONITORED',onchain}:null;
  // Anything unexpected is returned as a classified failure, so the worker log names the component and the class
  // instead of an unexplained PULSE_REFRESH_FAILED. The on-chain result gathered so far is kept.
  }catch(error){const detail=classify(error);return {state:'FAILED',component:'PULSE_WORKER',reasonCode:'PULSE_REFRESH_FAILED',failureClass:detail.failureClass,detailCode:detail.reasonCode,...(detail.module?{module:detail.module}:{}),...(onchain?{onchain}:{})};}
 })();
 try{return await running;}finally{running=null;}
}
module.exports={due,refreshIfDue,configured,monitorSummary,classify,GRACE_MS,RETRY_MS};
