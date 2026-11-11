'use strict';
// Provider health state machine for ARCY verification/autonomy.
//
// Pure + serializable by design. It accepts classified, secret-free events only;
// raw provider URLs, headers, credentials and arbitrary exception text never enter state.
//
// Recovery policy:
// - normal success: HEALTHY
// - transient failures: DEGRADED, then UNAVAILABLE after a bounded threshold
// - rate limit: immediate COOLDOWN using the repository's shared deterministic backoff
// - malformed/wrong-chain: immediate UNAVAILABLE
// - a cooled/unavailable provider returns through PROBING and needs two successful probes
//   before it can carry ordinary traffic again.
const backoff=require('../refresh-backoff');
const {NETWORKS}=require('./metric-evidence');

const SCHEMA_VERSION=1,MAX_LATENCY_SAMPLES=32;
const STATES=Object.freeze({
 HEALTHY:'HEALTHY',DEGRADED:'DEGRADED',COOLDOWN:'COOLDOWN',PROBING:'PROBING',UNAVAILABLE:'UNAVAILABLE'
});
const FAILURE_KINDS=Object.freeze({
 RATE_LIMIT:'RATE_LIMIT',TIMEOUT:'TIMEOUT',TRANSPORT:'TRANSPORT',MALFORMED:'MALFORMED',
 WRONG_CHAIN:'WRONG_CHAIN',PROVIDER_ERROR:'PROVIDER_ERROR'
});
const POLICY=Object.freeze({
 failureThreshold:3,recoverySuccesses:2,cooldownCapMs:30*60*1000
});
const SLUG=/^[a-z][a-z0-9_.-]{0,63}$/;
const fail=code=>Object.assign(Error(code),{code});
const iso=ms=>new Date(ms).toISOString();
function validTime(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;}
function validState(s){
 if(!s||s.schemaVersion!==SCHEMA_VERSION||!SLUG.test(s.providerId||'')||!Object.hasOwn(NETWORKS,s.network)||
  !Object.hasOwn(STATES,s.state)||!Number.isSafeInteger(s.requests)||s.requests<0||!Number.isSafeInteger(s.successes)||s.successes<0||
  !Number.isSafeInteger(s.failures)||s.failures<0||s.successes+s.failures!==s.requests||
  !Number.isSafeInteger(s.http429)||s.http429<0||s.http429>s.failures||
  !Number.isSafeInteger(s.timeouts)||s.timeouts<0||s.timeouts>s.failures||
  !Number.isSafeInteger(s.consecutiveFailures)||s.consecutiveFailures<0||
  !Number.isSafeInteger(s.recoverySuccesses)||s.recoverySuccesses<0||s.recoverySuccesses>POLICY.recoverySuccesses||
  !(s.lastSuccessAt===null||validTime(s.lastSuccessAt))||!(s.lastFailureAt===null||validTime(s.lastFailureAt))||
  !(s.cooldownUntil===null||validTime(s.cooldownUntil))||
  !Array.isArray(s.latencyMs)||s.latencyMs.length>MAX_LATENCY_SAMPLES||
  s.latencyMs.some(x=>!Number.isFinite(x)||x<0||x>120000))return false;
 return true;
}
function create(providerId,network){
 if(!SLUG.test(providerId||'')||!Object.hasOwn(NETWORKS,network))throw fail('WATCHDOG_INVALID_IDENTITY');
 return {schemaVersion:SCHEMA_VERSION,providerId,network,state:STATES.HEALTHY,requests:0,successes:0,failures:0,http429:0,timeouts:0,
  consecutiveFailures:0,recoverySuccesses:0,lastSuccessAt:null,lastFailureAt:null,cooldownUntil:null,latencyMs:[]};
}
function clone(s){if(!validState(s))throw fail('WATCHDOG_CORRUPT_STATE');return structuredClone(s);}
function msAt(at){
 const ms=typeof at==='number'?at:Date.parse(at);
 if(!Number.isFinite(ms)||ms<0)throw fail('WATCHDOG_INVALID_TIME');
 return ms;
}
function percentile(values,p){
 if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),i=Math.min(a.length-1,Math.max(0,Math.ceil(a.length*p)-1));return a[i];
}
function summary(input){
 const s=clone(input);
 return {schemaVersion:s.schemaVersion,providerId:s.providerId,network:s.network,state:s.state,requests:s.requests,successes:s.successes,failures:s.failures,
  http429:s.http429,timeouts:s.timeouts,consecutiveFailures:s.consecutiveFailures,recoverySuccesses:s.recoverySuccesses,
  lastSuccessAt:s.lastSuccessAt,lastFailureAt:s.lastFailureAt,cooldownUntil:s.cooldownUntil,
  latency:{samples:s.latencyMs.length,p50Ms:percentile(s.latencyMs,.5),p95Ms:percentile(s.latencyMs,.95),maxMs:s.latencyMs.length?Math.max(...s.latencyMs):null}};
}
function appendLatency(s,latencyMs){
 if(!Number.isFinite(latencyMs)||latencyMs<0||latencyMs>120000)throw fail('WATCHDOG_INVALID_LATENCY');
 s.latencyMs.push(Math.round(latencyMs));if(s.latencyMs.length>MAX_LATENCY_SAMPLES)s.latencyMs.splice(0,s.latencyMs.length-MAX_LATENCY_SAMPLES);
}
function recordSuccess(input,{at=Date.now(),latencyMs}={}){
 const s=clone(input),now=msAt(at);appendLatency(s,latencyMs);s.requests++;s.successes++;s.consecutiveFailures=0;s.lastSuccessAt=iso(now);s.cooldownUntil=null;
 if(s.state===STATES.HEALTHY){s.recoverySuccesses=0;return s;}
 s.recoverySuccesses=Math.min(POLICY.recoverySuccesses,s.recoverySuccesses+1);
 if(s.recoverySuccesses>=POLICY.recoverySuccesses){s.state=STATES.HEALTHY;s.recoverySuccesses=0;}
 else s.state=STATES.PROBING;
 return s;
}
function normalizeFailure(kind,httpStatus){
 if(!Object.hasOwn(FAILURE_KINDS,kind))throw fail('WATCHDOG_INVALID_FAILURE_KIND');
 if(httpStatus!==undefined&&httpStatus!==null&&(!Number.isSafeInteger(httpStatus)||httpStatus<100||httpStatus>599))throw fail('WATCHDOG_INVALID_HTTP_STATUS');
 if(kind===FAILURE_KINDS.RATE_LIMIT&&httpStatus!==undefined&&httpStatus!==null&&httpStatus!==429)throw fail('WATCHDOG_INVALID_HTTP_STATUS');
}
function cooldownMs(consecutiveFailures,retryAfterMs=0){
 return backoff.retryDelayMs(consecutiveFailures,{capMs:POLICY.cooldownCapMs,retryAfterMs});
}
function recordFailure(input,{kind,httpStatus=null,retryAfterMs=0,at=Date.now()}={}){
 const s=clone(input),now=msAt(at);normalizeFailure(kind,httpStatus);
 if(!Number.isFinite(retryAfterMs)||retryAfterMs<0||retryAfterMs>24*60*60*1000)throw fail('WATCHDOG_INVALID_RETRY_AFTER');
 s.requests++;s.failures++;s.consecutiveFailures++;s.recoverySuccesses=0;s.lastFailureAt=iso(now);
 if(kind===FAILURE_KINDS.RATE_LIMIT){s.http429++;s.state=STATES.COOLDOWN;s.cooldownUntil=iso(now+cooldownMs(s.consecutiveFailures,retryAfterMs));return s;}
 if(kind===FAILURE_KINDS.TIMEOUT)s.timeouts++;
 if(kind===FAILURE_KINDS.MALFORMED||kind===FAILURE_KINDS.WRONG_CHAIN){
  s.state=STATES.UNAVAILABLE;s.cooldownUntil=iso(now+POLICY.cooldownCapMs);return s;
 }
 if(s.consecutiveFailures>=POLICY.failureThreshold){
  s.state=STATES.UNAVAILABLE;s.cooldownUntil=iso(now+cooldownMs(s.consecutiveFailures,retryAfterMs));
 }else{s.state=STATES.DEGRADED;s.cooldownUntil=null;}
 return s;
}
function eligibility(input,at=Date.now()){
 const s=clone(input),now=msAt(at),until=s.cooldownUntil?Date.parse(s.cooldownUntil):null;
 if((s.state===STATES.COOLDOWN||s.state===STATES.UNAVAILABLE)&&until!==null&&now<until)
  return {mode:'SKIP',reasonCode:'PROVIDER_COOLDOWN',probeDue:false,trafficAllowed:false,nextProbeAt:s.cooldownUntil};
 if([STATES.COOLDOWN,STATES.UNAVAILABLE,STATES.PROBING].includes(s.state))
  return {mode:'PROBE',reasonCode:'RECOVERY_PROBE_REQUIRED',probeDue:true,trafficAllowed:false,nextProbeAt:null};
 if(s.state===STATES.DEGRADED)return {mode:'TRAFFIC',reasonCode:'DEGRADED_PROVIDER',probeDue:false,trafficAllowed:true,nextProbeAt:null};
 return {mode:'TRAFFIC',reasonCode:null,probeDue:false,trafficAllowed:true,nextProbeAt:null};
}
module.exports={SCHEMA_VERSION,MAX_LATENCY_SAMPLES,STATES,FAILURE_KINDS,POLICY,create,validState,recordSuccess,recordFailure,eligibility,summary,cooldownMs};
