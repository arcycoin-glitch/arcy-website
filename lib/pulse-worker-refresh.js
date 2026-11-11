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
let running=null;
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
async function refreshIfDue({now=Date.now(),fetcher=fetch,env=process.env,storage=require('./pulse-storage'),edition=require('./pulse-edition'),onchainMonitor=require('./pulse-onchain/monitor')}={}){
 if(running)return running;
 running=(async()=>{
  let onchain=null;
  // Persistent event monitoring is explicitly enabled and remains isolated from signed edition retries.
  if(env.ARC_PULSE_ONCHAIN_ENABLED==='1')try{onchain=monitorSummary(await onchainMonitor.refreshAll({now,env,fetcher}));}catch{onchain={status:'FAILED',reasonCode:'PULSE_ONCHAIN_MONITOR_FAILED'};}
  let publication=null;
  if(configured(env)){
   const state=await due({now,storage,edition});
   if(state.due)try{const d=await edition.generate({now,fetcher,trigger:'worker'});await storage.publish(d);publication={state:'PUBLISHED',number:d.number,status:d.status,reason:state.reason};}
   catch(error){try{await storage.failure(error,now,'worker');}catch{}publication={state:'FAILED',reasonCode:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'PULSE_REFRESH_FAILED',reason:state.reason};}
  }
  if(publication)return onchain?{...publication,onchain}:publication;
  return onchain?{state:'ONCHAIN_MONITORED',onchain}:null;
 })();
 try{return await running;}finally{running=null;}
}
module.exports={due,refreshIfDue,configured,monitorSummary,GRACE_MS,RETRY_MS};
