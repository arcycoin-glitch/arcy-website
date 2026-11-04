'use strict';
// Stable, secret-free failure classification for the persistent Holder worker. Replaces opaque values such as the numeric
// DOMException code 23 (TimeoutError) that previously leaked into job.reasonCode and the logs.
const KINDS=[
 [e=>e?.httpStatus===429||e?.code==='RPC_RATE_LIMIT','RATE_LIMITED'],
 [e=>['TimeoutError','AbortError'].includes(e?.name),'TIMEOUT'],
 [e=>e?.httpStatus===404,'NOT_FOUND'],
 [e=>Number.isInteger(e?.httpStatus)&&e.httpStatus>=500,'HTTP_5XX'],
 [e=>Number.isInteger(e?.httpStatus)&&e.httpStatus>=400,'HTTP_4XX'],
 [e=>e?.code==='MALFORMED_JSON'||e?.code==='MALFORMED_HOLDER_INDEX','MALFORMED_RESPONSE'],
 [e=>e?.name==='TypeError','NETWORK_ERROR']
];
const stageName=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').slice(0,24);
// Returns a stable upper-case string. String codes already used by the engine are preserved unchanged.
const kindOf=e=>{const hit=KINDS.find(([test])=>test(e));return hit?hit[1]:'UNCLASSIFIED';};
function reasonCode(e){
 if(typeof e?.code==='string'&&e.code)return e.code.slice(0,80);
 const kind=kindOf(e);
 return e?.holderStage?stageName(e.holderStage)+'_'+kind:'UPSTREAM_'+kind;
}
// Tag an error with the dependency that failed without altering its code/name/status.
function tag(e,stage){if(e&&typeof e==='object'&&!e.holderStage&&e.code!=='HOLDER_WORKER_BUDGET_EXHAUSTED')try{Object.defineProperty(e,'holderStage',{value:stage,enumerable:false,configurable:true});}catch{}return e;}
// Exponential back-off for consecutive slices that made no measurable progress. The first stall keeps the caller's delay.
const MAX_STALL_DELAY_MS=1800000;
function stalledDelay(baseMs,streak){return streak<=1?baseMs:Math.min(MAX_STALL_DELAY_MS,Math.max(baseMs,baseMs*2**Math.min(streak-1,10)));}
// Shared-dependency circuit breaker for the Arc explorer index used by DISCOVER (/stats is needed by every new contract).
// Production evidence (2026-11-04): the explorer origin answered HTTP 522 after ~19.5 s for every endpoint, so each DISCOVER
// slice burned its full time budget on a request that could not succeed. While the breaker is open DISCOVER yields at once
// (no network call, no FAILED job, no stall penalty); TAIL / CATCHUP / READ and every already-COMPLETE contract are unaffected.
const explorer={until:0,streak:0};
const transient=e=>['TIMEOUT','RATE_LIMITED','HTTP_5XX','NETWORK_ERROR'].includes(kindOf(e));
function explorerGate(now=Date.now()){if(now<explorer.until)throw Object.assign(new Error('Arc explorer index cooling down'),{code:'EXPLORER_COOLDOWN',eligibleInMs:explorer.until-now});}
function explorerFailed(e,now=Date.now()){if(!transient(e))return;explorer.streak++;explorer.until=now+Math.min(900000,60000*2**Math.min(explorer.streak-1,4));}
function explorerOk(){explorer.streak=0;explorer.until=0;}
function explorerState(){return {...explorer};}
module.exports={reasonCode,tag,stalledDelay,MAX_STALL_DELAY_MS,explorerGate,explorerFailed,explorerOk,explorerState};
