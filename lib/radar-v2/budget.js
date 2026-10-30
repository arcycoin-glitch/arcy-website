'use strict';
// Fail-closed provider-credit ledger for the CoinGecko Demo plan (10,000 credits/month reference).
// HONEST SCOPE: this ledger lives in process memory. It bounds ONE warm instance per calendar month; it cannot see other serverless
// instances or cold starts (each starts with an empty ledger), so the global bound is  instances x cap  and is NOT enforceable without a
// shared durable store. Mitigations: hourly+ TTL, per-process single-flight, and a deliberately low per-process cap (7,500, hard ceiling 8,000).
const http=require('./http');
const HARD_CEILING=8000,DEFAULT_CAP=7500;
const state={month:null,spent:0,refused:0};
const monthOf=ms=>new Date(ms).toISOString().slice(0,7);
const roll=now=>{const m=monthOf(now);if(state.month!==m){state.month=m;state.spent=0;state.refused=0;}};
function cap(env=process.env){const v=Number(env.RADAR_V2_MONTHLY_CREDIT_CAP);return Number.isFinite(v)&&v>0?Math.min(HARD_CEILING,Math.floor(v)):DEFAULT_CAP;}
// check(): refuse a refresh cycle that could exceed the month's cap (throws RADAR_BUDGET_EXHAUSTED; never silently continues).
// spend(): record credits actually used (or the worst case when a cycle failed part-way).
function check(estimate,{env=process.env,now=Date.now()}={}){
 roll(now);const c=cap(env);
 if(state.spent+estimate>c){state.refused++;throw http.fail('RADAR_BUDGET_EXHAUSTED',{detail:'spent '+state.spent+' + '+estimate+' > cap '+c});}
}
function noteRefused(){state.refused++;}
function spend(credits,{now=Date.now()}={}){roll(now);state.spent+=Math.max(0,Math.floor(Number(credits))||0);}
function snapshot(env=process.env,now=Date.now()){roll(now);return {month:state.month,spentCredits:state.spent,capCredits:cap(env),refusedCycles:state.refused,scope:'single-process-memory'};}
function _reset(){state.month=null;state.spent=0;state.refused=0;}
// Optional cross-instance quota via the Railway worker (same Redis the holder pipeline already uses; no new resource, no new Vercel env var).
// Returns 'granted' | 'refused' (monthly cap) | 'throttled' (per-minute gate or shared cooldown; see .retryInMs via sharedDetail) |
// 'local' (shared endpoint not deployed: 404 or no worker configured -> per-process ledger only) |
// 'unverifiable' (worker configured but unreachable / Redis down / error -> the caller MUST NOT spend provider credits: fail closed).
let lastDetail=null;
function perMinuteCap(env=process.env){if(String(env.RADAR_V2_PER_MINUTE_CAP)==='0')return 0;const v=Number(env.RADAR_V2_PER_MINUTE_CAP);return Number.isInteger(v)&&v>=1&&v<=60?v:20;}
async function shared(mode,credits,{env=process.env,fetcher=global.fetch,now=Date.now(),ms}={}){
 const url=env.ARC_HOLDER_QUEUE_URL,token=env.ARC_HOLDER_QUEUE_TOKEN;lastDetail=null;if(!url||!token)return 'local';
 try{const u=new URL(url);u.pathname='/quota/radar';u.search='';
  const body=mode==='cooldown'?{month:monthOf(now),mode,ms}:{month:monthOf(now),credits,cap:cap(env),mode,...(mode==='reserve'&&perMinuteCap(env)>0?{perMinute:perMinuteCap(env)}:{})};
  const r=await fetcher(u,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(2000)});
  if(r.status===404)return 'local';
  if(!r.ok)return 'unverifiable';const d=await r.json();
  if(d?.ok!==true)return 'unverifiable';
  if(d.granted===false){lastDetail={reason:d.reason||'MONTHLY_CAP',retryInMs:d.retryInMs||null};return d.reason==='MINUTE_CAP'||d.reason==='COOLDOWN'?'throttled':'refused';}
  lastDetail={store:d.store||null};return 'granted';
 }catch{return 'unverifiable';}
}
const sharedDetail=()=>lastDetail;
module.exports={noteRefused,shared,sharedDetail,perMinuteCap,check,spend,snapshot,cap,_reset,HARD_CEILING,DEFAULT_CAP};
