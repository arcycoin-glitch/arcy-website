'use strict';
// Shared, deterministic retry policy for scheduled data refreshes (no randomness so it is testable; callers add their own jitter if they run many instances).
// consecutiveFailures 1 -> 5 min, then doubling, capped at the source's normal refresh interval so a healthy source is never retried more often than its cadence allows.
const BASE_MS=5*60*1000;
function retryDelayMs(consecutiveFailures,{capMs=6*60*60*1000,retryAfterMs=0}={}){
 const n=Math.max(1,Math.min(20,Math.floor(Number(consecutiveFailures))||1));
 const exp=Math.min(capMs,BASE_MS*2**(n-1));
 return Math.min(capMs,Math.max(exp,Number.isFinite(retryAfterMs)&&retryAfterMs>0?retryAfterMs:0));
}
// Is a job due? `nextAt` is the success-path refresh time; `failure` is {at, consecutive, retryAfterMs?}. A recorded failure postpones the next attempt.
function dueAt({refreshAtMs,lastFailureAtMs,consecutiveFailures,capMs,retryAfterMs}){
 const base=Number.isFinite(refreshAtMs)?refreshAtMs:-Infinity;
 if(!Number.isFinite(lastFailureAtMs)||!(consecutiveFailures>0))return base;
 return Math.max(base,lastFailureAtMs+retryDelayMs(consecutiveFailures,{capMs,retryAfterMs}));
}
module.exports={retryDelayMs,dueAt,BASE_MS};
