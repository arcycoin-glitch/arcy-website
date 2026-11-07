'use strict';
// Pure evaluation of operational telemetry into explicit HEALTHY / DEGRADED / UNAVAILABLE states.
// Inputs are already-sanitized worker diagnostics and publication audits; this module never performs I/O,
// never sees credentials or URLs, and never returns token addresses or queue contents (counts only).
// A historical publication is NOT worker liveness: the Holder heartbeat comes only from the worker's own
// in-process scheduler invocation timestamp.
const STATE=Object.freeze({HEALTHY:'HEALTHY',DEGRADED:'DEGRADED',UNAVAILABLE:'UNAVAILABLE',UNKNOWN:'UNKNOWN'});
const LIMITS=Object.freeze({
 // Worker loop: <=40 s batch + <=30 s idle sleep. Three missed loops is degraded, ~15 missed loops is down.
 heartbeatHealthySeconds:180,heartbeatDegradedSeconds:900,
 // Pulse is weekly (Monday 06:00 UTC). One missed cycle plus a grace day is degraded; two missed cycles is stale.
 pulseHealthyHours:8*24,pulseDegradedHours:15*24,
 // Unlock calendar refreshes every 6 h; a signed edition past its refreshAt is overdue.
 unlockGraceSeconds:3600,unlockStaleSeconds:86400,
 // 429 share of all worker RPC requests since process start (in-process counters reset on restart).
 rpc429DegradedShare:0.25,rpc429MinRequests:50
});
const rank={HEALTHY:0,UNKNOWN:1,DEGRADED:2,UNAVAILABLE:3};
const worst=states=>states.reduce((a,b)=>(rank[b]??1)>(rank[a]??1)?b:a,STATE.HEALTHY);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const ageSeconds=(iso,now)=>{const t=typeof iso==='number'?iso:Date.parse(iso||'');return Number.isFinite(t)?Math.max(0,Math.round((now-t)/1000)):null;};
const shortSha=v=>typeof v==='string'&&/^[0-9a-f]{7,40}$/i.test(v)?v.slice(0,12).toLowerCase():null;
const code=v=>typeof v==='string'&&/^[A-Z0-9_]{1,80}$/.test(v)?v:null;

function holderWorker(diag,now){
 if(diag?.unreachable)return {state:STATE.UNAVAILABLE,reasonCode:code(diag.reasonCode)||'WORKER_UNREACHABLE',basis:'Authenticated read-only worker diagnostics did not answer.'};
 if(diag?.notConfigured)return {state:STATE.UNKNOWN,reasonCode:'WORKER_NOT_CONFIGURED_IN_THIS_RUNTIME',basis:'This deployment has no worker diagnostics configuration (expected in Preview).'};
 const w=diag?.worker;
 if(!w||typeof w!=='object')return {state:STATE.UNAVAILABLE,reasonCode:'WORKER_DIAGNOSTICS_MALFORMED',basis:'Worker answered without scheduler telemetry.'};
 const last=w.scheduler?.lastInvocation,heartbeatAge=ageSeconds(last?.at,now);
 const tokens=Array.isArray(w.tokens)?w.tokens:[];
 const inProgress=tokens.filter(t=>t&&t.phase&&t.phase!=='COMPLETE').length;
 const failing=tokens.filter(t=>t&&(t.lastState==='FAILED')).length;
 // Stalled: work remains, the token was served, and its last slice advanced nothing while not completing.
 const stalled=tokens.filter(t=>t&&t.phase&&t.phase!=='COMPLETE'&&t.lastState&&t.lastState!=='COMPLETE'&&t.lastAdvanced===0&&finite(t.slices)&&t.slices>=3).length;
 const completeIdle=tokens.filter(t=>t&&t.lastState==='COMPLETE'&&finite(t.idleMs)).map(t=>t.idleMs);
 const m=w.rpc?.metrics||{},requests=finite(m.requests)?m.requests:null,r429=finite(m.http429)?m.http429:null;
 const share=requests&&r429!==null?r429/requests:null;
 const providers=Array.isArray(w.rpc?.providers)?w.rpc.providers:[];
 const cooling=providers.filter(p=>finite(p?.cooldownMs)&&p.cooldownMs>0).length;
 let state,reasonCode=null;
 if(heartbeatAge===null){state=STATE.DEGRADED;reasonCode='NO_SCHEDULER_INVOCATION_SINCE_START';}
 else if(heartbeatAge<=LIMITS.heartbeatHealthySeconds)state=STATE.HEALTHY;
 else if(heartbeatAge<=LIMITS.heartbeatDegradedSeconds){state=STATE.DEGRADED;reasonCode='HEARTBEAT_LATE';}
 else {state=STATE.UNAVAILABLE;reasonCode='HEARTBEAT_STALE';}
 if(state===STATE.HEALTHY&&share!==null&&requests>=LIMITS.rpc429MinRequests&&share>=LIMITS.rpc429DegradedShare){state=STATE.DEGRADED;reasonCode='RPC_429_SHARE_HIGH';}
 if(state===STATE.HEALTHY&&providers.length&&cooling===providers.length){state=STATE.DEGRADED;reasonCode='ALL_RPC_PROVIDERS_COOLING';}
 if(state===STATE.HEALTHY&&inProgress&&stalled===inProgress){state=STATE.DEGRADED;reasonCode='ALL_IN_PROGRESS_WORK_STALLED';}
 const states=last&&last.states&&typeof last.states==='object'?Object.fromEntries(Object.entries(last.states).filter(([k,v])=>code(k)&&finite(v)).slice(0,12)):null;
 return {state,reasonCode,
  heartbeat:{lastInvocationAt:finite(last?.at)?new Date(last.at).toISOString():null,ageSeconds:heartbeatAge,lastInvocationMs:finite(last?.elapsedMs)?Math.round(last.elapsedMs):null,lastInvocationServed:Array.isArray(last?.served)?last.served.length:null,lastInvocationStates:states},
  backlog:{tokensTracked:tokens.length,inProgress,failing,stalled},
  lastCompleteSliceAgeSeconds:completeIdle.length?Math.round(Math.min(...completeIdle)/1000):null,
  rpc:{requests,http429:r429,http429Share:share===null?null:Math.round(share*1000)/1000,providers:providers.length,providersCooling:cooling},
  scheduler:w.scheduler?.totals&&typeof w.scheduler.totals==='object'?Object.fromEntries(Object.entries(w.scheduler.totals).filter(([,v])=>finite(v))):null,
  runtime:{commit:shortSha(w.runtime?.commit),startedAt:typeof w.runtime?.startedAt==='string'?w.runtime.startedAt:null},
  basis:'Liveness = worker scheduler invocation age (in-process). Counters reset on worker restart. A published snapshot is not a heartbeat.'};
}
function weekly(audit,now,label){
 if(audit===undefined||audit?.unreachable)return {state:STATE.UNKNOWN,reasonCode:'AUDIT_UNAVAILABLE'};
 const ok=audit?.lastSuccessful,fail=audit?.lastFailure,age=ageSeconds(ok?.generatedAt,now),hours=age===null?null:Math.round(age/36)/100;
 let state,reasonCode=null;
 if(age===null){state=STATE.UNAVAILABLE;reasonCode='NO_SUCCESSFUL_PUBLICATION';}
 else if(hours<=LIMITS.pulseHealthyHours)state=STATE.HEALTHY;
 else if(hours<=LIMITS.pulseDegradedHours){state=STATE.DEGRADED;reasonCode='PUBLICATION_OVERDUE';}
 else {state=STATE.UNAVAILABLE;reasonCode='PUBLICATION_STALE';}
 const failAge=ageSeconds(fail?.at,now),failedAfter=failAge!==null&&(age===null||failAge<age);
 if(state===STATE.HEALTHY&&failedAfter){state=STATE.DEGRADED;reasonCode='LATEST_REFRESH_FAILED';}
 return {state,reasonCode,label,lastSuccessfulAt:typeof ok?.generatedAt==='string'?ok.generatedAt:null,ageHours:hours,edition:Number.isSafeInteger(ok?.number)?ok.number:null,status:typeof ok?.status==='string'?ok.status:null,
  lastFailureAt:typeof fail?.at==='string'?fail.at:null,lastFailureCode:code(fail?.code),failedAfterLastSuccess:failedAfter};
}
function unlocks(audit,now){
 if(audit===undefined||audit?.unreachable)return {state:STATE.UNKNOWN,reasonCode:'AUDIT_UNAVAILABLE'};
 const ok=audit?.lastSuccessful,fail=audit?.lastFailure,refreshAt=Date.parse(ok?.refreshAt||''),overdue=Number.isFinite(refreshAt)?Math.max(0,Math.round((now-refreshAt)/1000)):null;
 let state,reasonCode=null;
 if(!ok){state=STATE.UNAVAILABLE;reasonCode='NO_SUCCESSFUL_CALENDAR';}
 else if(overdue===null){state=STATE.DEGRADED;reasonCode='REFRESH_TIME_UNKNOWN';}
 else if(overdue<=LIMITS.unlockGraceSeconds)state=STATE.HEALTHY;
 else if(overdue<=LIMITS.unlockStaleSeconds){state=STATE.DEGRADED;reasonCode='REFRESH_OVERDUE';}
 else {state=STATE.UNAVAILABLE;reasonCode='CALENDAR_STALE';}
 const consecutive=finite(fail?.consecutive)?fail.consecutive:0;
 if(state===STATE.HEALTHY&&consecutive>0){state=STATE.DEGRADED;reasonCode='REFRESH_FAILING';}
 return {state,reasonCode,generatedAt:typeof ok?.generatedAt==='string'?ok.generatedAt:null,refreshAt:typeof ok?.refreshAt==='string'?ok.refreshAt:null,overdueSeconds:overdue,
  eventCount:finite(ok?.eventCount)?ok.eventCount:null,partial:typeof ok?.partial==='boolean'?ok.partial:null,consecutiveFailures:consecutive,lastFailureCode:code(fail?.code)};
}
// inputs: {diagnostics, pulseAudit, networkPulseAudit:{chains:{ethereum,robinhood}}, unlockAudit, runtime:{commit,environment}}
function evaluate(inputs={},now=Date.now()){
 const worker=holderWorker(inputs.diagnostics,now);
 const chains=inputs.networkPulseAudit?.chains;
 const pulse={arc:weekly(inputs.pulseAudit,now,'Arc'),
  ethereum:weekly(inputs.networkPulseAudit?.unreachable?{unreachable:true}:chains?chains.ethereum??null:undefined,now,'Ethereum'),
  robinhood:weekly(inputs.networkPulseAudit?.unreachable?{unreachable:true}:chains?chains.robinhood??null:undefined,now,'Robinhood Chain')};
 const unlock=unlocks(inputs.unlockAudit,now);
 const vercel=shortSha(inputs.runtime?.commit),workerCommit=worker.runtime?.commit||null;
 const version={searchApi:vercel,holderWorker:workerCommit,match:vercel&&workerCommit?vercel.slice(0,7)===workerCommit.slice(0,7):null,
  note:'The worker is deployed separately on Railway; a mismatch is reported, not treated as a failure, because worker-only code may lag safely.'};
 const dataStates=[pulse.arc.state,pulse.ethereum.state,pulse.robinhood.state,unlock.state];
 // Overall: the Search API answering is itself the availability proof for this endpoint. Worker down = UNAVAILABLE
 // for the durable data pipeline; stale or failing publications = DEGRADED. UNKNOWN never upgrades to HEALTHY.
 const pipeline=worker.state===STATE.UNAVAILABLE?STATE.UNAVAILABLE:worst([worker.state,...dataStates.map(s=>s===STATE.UNAVAILABLE?STATE.DEGRADED:s)]);
 return {generatedAt:new Date(now).toISOString(),overall:pipeline,
  components:{searchApi:{state:STATE.HEALTHY,environment:inputs.runtime?.environment||null},holderWorker:worker,pulse,unlocks:unlock},
  version,limits:LIMITS,
  states:'HEALTHY = within expected cadence; DEGRADED = late, failing or partially unknown; UNAVAILABLE = stale beyond tolerance or unreachable; UNKNOWN = not measurable from this runtime.'};
}
module.exports={evaluate,holderWorker,weekly,unlocks,LIMITS,STATE};
