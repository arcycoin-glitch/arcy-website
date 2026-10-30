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
function spend(credits,{now=Date.now()}={}){roll(now);state.spent+=Math.max(0,Math.floor(Number(credits))||0);}
function snapshot(env=process.env,now=Date.now()){roll(now);return {month:state.month,spentCredits:state.spent,capCredits:cap(env),refusedCycles:state.refused,scope:'single-process-memory'};}
function _reset(){state.month=null;state.spent=0;state.refused=0;}
module.exports={check,spend,snapshot,cap,_reset,HARD_CEILING,DEFAULT_CAP};
