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
async function refreshIfDue({now=Date.now(),fetcher=fetch,env=process.env,storage=require('./pulse-storage'),edition=require('./pulse-edition')}={}){
 if(!configured(env))return null;
 if(running)return running;
 running=(async()=>{
  const state=await due({now,storage,edition});
  if(!state.due)return null;
  try{const d=await edition.generate({now,fetcher,trigger:'worker'});await storage.publish(d);return {state:'PUBLISHED',number:d.number,status:d.status,reason:state.reason};}
  catch(error){try{await storage.failure(error,now,'worker');}catch{}return {state:'FAILED',reasonCode:/^[A-Z_0-9]{1,80}$/.test(error?.code||'')?error.code:'PULSE_REFRESH_FAILED',reason:state.reason};}
 })();
 try{return await running;}finally{running=null;}
}
module.exports={due,refreshIfDue,configured,GRACE_MS,RETRY_MS};
