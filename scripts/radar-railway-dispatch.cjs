#!/usr/bin/env node
'use strict';
// Independent, one-shot Railway Cron. It dispatches the fixed reviewed Action;
// it never builds snapshots or shares Holder storage/signing credentials.
const {snapshotDecision}=require('./radar-snapshot-freshness.cjs');
const REPO='arcycoin-glitch/arcy-website',WORKFLOW='radar-v4-snapshot.yml';
const SNAPSHOT_URL='https://raw.githubusercontent.com/'+REPO+'/radar-v4-snapshots/radar-v4/snapshot.json';
const API='https://api.github.com/repos/'+REPO+'/actions/workflows/'+WORKFLOW;
const RUNS_URL=API+'/runs?branch=main&per_page=10',DISPATCH_URL=API+'/dispatches';
const RECENT_MS=45*60*1000,REQUEST_TIMEOUT_MS=15000,TOTAL_TIMEOUT_MS=45000,JSON_LIMIT=3000000;
const GET_ATTEMPTS=2,MAX_BACKOFF_MS=3000;
const pending=new WeakMap(),attempted=new WeakMap();
const outcome=(state,reason,other={})=>({state,reason,...other});
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
const exitCode=r=>r.state==='CONFIGURATION_REQUIRED'?2:['SKIPPED','DISPATCHED'].includes(r.state)?0:1;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function safeHeaders(response){
 const h=response?.headers,id=h?.get?.('x-github-request-id'),sso=h?.get?.('x-github-sso'),permissions=h?.get?.('x-accepted-github-permissions');
 return {...(typeof id==='string'&&/^[a-z0-9:._-]{1,100}$/i.test(id)?{githubRequestId:id}:{}),
  ...(/^required(?:;|$)/i.test(sso||'')?{ssoAuthorizationRequired:true}:{}),
  ...(typeof permissions==='string'&&/(?:^|[,;\s])actions=write(?:$|[,;\s])/i.test(permissions)?{actionsWriteRequired:true}:{}),
  ...(h?.get?.('x-ratelimit-remaining')==='0'||h?.get?.('retry-after')?{rateLimitReported:true}:{})};
}
async function textWithin(response,limit){
 const length=response?.headers?.get?.('content-length');
 if(length&&/^\d+$/.test(length)&&Number(length)>limit)throw fail('RESPONSE_TOO_LARGE');
 if(response?.body?.getReader){
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw fail('RESPONSE_TOO_LARGE');parts.push(Buffer.from(value));}return Buffer.concat(parts).toString('utf8');}
  catch(error){Promise.resolve().then(()=>reader.cancel()).catch(()=>{});throw error;}
 }
 const text=await response.text();if(Buffer.byteLength(text)>limit)throw fail('RESPONSE_TOO_LARGE');return text;
}
// The ref-counted watchdog spans headers AND body, even for fetchers/streams
// that ignore AbortSignal. A total run budget bounds retries.
async function request(fetcher,url,options,{deadline,requestTimeoutMs}){
 const ms=Math.min(requestTimeoutMs,deadline-Date.now());if(ms<=0)throw fail('RUN_DEADLINE');
 const controller=new AbortController();let timer,response;
 const watchdog=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();Promise.resolve().then(()=>response?.body?.cancel?.()).catch(()=>{});reject(fail('REQUEST_TIMEOUT'));},ms);});
 try{return await Promise.race([(async()=>{
  response=await fetcher(url,{...options,redirect:'error',signal:controller.signal});
  const status=response?.status||0,headers=safeHeaders(response);
  if(status===204||options.method==='POST'){Promise.resolve().then(()=>response?.body?.cancel?.()).catch(()=>{});return {status,headers,text:null,retryMs:null};}
  // Never log upstream error bodies; only allowlisted headers/status leave.
  if(!response?.ok){
   const raw=response?.headers?.get?.('retry-after'),seconds=Number(raw),parsed=raw?(Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-Date.now()):null;
   Promise.resolve().then(()=>response?.body?.cancel?.()).catch(()=>{});
   return {status,headers,text:null,retryMs:parsed!==null&&Number.isFinite(parsed)?Math.max(0,parsed):null};
  }
  return {status,headers,text:await textWithin(response,JSON_LIMIT),retryMs:null};
 })(),watchdog]);}
 catch(error){if(['RUN_DEADLINE','REQUEST_TIMEOUT','RESPONSE_TOO_LARGE'].includes(error?.code))throw error;throw fail(error?.name==='AbortError'||error?.name==='TimeoutError'?'REQUEST_TIMEOUT':'TRANSPORT_ERROR');}
 finally{clearTimeout(timer);}
}
async function readJson(fetcher,url,headers,timing){
 for(let attempt=1;attempt<=GET_ATTEMPTS;attempt++){
  let response;
  try{response=await request(fetcher,url,{method:'GET',headers:{accept:'application/json',...headers}},timing);}
  catch(error){
   const delay=500*attempt;
   if(attempt===GET_ATTEMPTS||!['TRANSPORT_ERROR','REQUEST_TIMEOUT'].includes(error.code)||Date.now()+delay>=timing.deadline)throw error;
   await timing.delay(delay);continue;
  }
  if(response.status>=200&&response.status<300){try{return JSON.parse(response.text);}catch{throw fail('INVALID_JSON');}}
  const retry=[429,500,502,503,504].includes(response.status),delay=response.retryMs??500*attempt;
  if(!retry||attempt===GET_ATTEMPTS||delay>MAX_BACKOFF_MS||Date.now()+delay>=timing.deadline)
   throw fail('HTTP_'+(response.status||'UNAVAILABLE'),{httpStatus:response.status,...response.headers});
  await timing.delay(delay);
 }
}
function recentOrBusy(run,now){
 if(!run||typeof run!=='object')return false;
 const started=Date.parse(run.created_at||''),recent=Number.isFinite(started)&&started<=now&&now-started<RECENT_MS;
 return ['queued','in_progress','waiting','pending','requested'].includes(run.status)||
  recent&&['workflow_dispatch','schedule','push'].includes(run.event);
}
function configuration(stage,error,common){
 const status=error.httpStatus;
 if(status===403&&error.rateLimitReported)return outcome('BLOCKED','GITHUB_RATE_LIMITED',{...common,stage,httpStatus:status});
 if(![401,403,404,422].includes(status))return null;
 const reason=status===401?'GITHUB_CREDENTIAL_REJECTED':status===403?'GITHUB_ACTIONS_PERMISSION_DENIED':status===404?'GITHUB_WORKFLOW_OR_REPOSITORY_INACCESSIBLE':'GITHUB_DISPATCH_CONFIGURATION_INVALID';
 return outcome('CONFIGURATION_REQUIRED',reason,{...common,stage,httpStatus:status,
  ...(error.githubRequestId?{githubRequestId:error.githubRequestId}:{}),...(error.ssoAuthorizationRequired?{ssoAuthorizationRequired:true}:{}),
  ...(error.actionsWriteRequired?{actionsWriteRequired:true}:{}),
  requiredCapability:stage==='dispatch'?'Repository Actions: write; approved token/application access':'Repository Actions: read; approved token/application access'});
}
async function inspect({fetcher,now,token,timing}){
 let snapshot=null,sourceError=null;
 try{snapshot=await readJson(fetcher,SNAPSHOT_URL,{'cache-control':'no-cache'},timing);const generatedAt=typeof snapshot?.generatedAt==='string'?snapshot.generatedAt:null;
  if(!Number.isFinite(Date.parse(generatedAt||''))||Date.parse(generatedAt)>now+60000)sourceError='SNAPSHOT_TIMESTAMP_INVALID';}
 catch(error){sourceError=error.code||'SNAPSHOT_SOURCE_FAILED';}
 const age=snapshotDecision(snapshot,{now,event:'schedule'}),common={ageMin:age.ageMin,level:age.level,snapshotReadable:sourceError===null,
  sectionFreshness:age.sectionFreshness,degradedSections:age.degradedSections,oldestSectionAgeMin:age.oldestSectionAgeMin,
  ...(sourceError?{snapshotErrorCode:sourceError}:{})};
 if(!age.build)return outcome('SKIPPED','SNAPSHOT_UNDER_100_MINUTES',common);
 const headers={accept:'application/vnd.github+json',authorization:'Bearer '+token,'user-agent':'ARCY-Radar-Railway-Scheduler','x-github-api-version':'2022-11-28'};
 let recent;
 try{const data=await readJson(fetcher,RUNS_URL,headers,timing);if(!Array.isArray(data?.workflow_runs)||data.workflow_runs.length>100||!data.workflow_runs.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&['queued','in_progress','waiting','pending','requested','completed'].includes(r.status)))return outcome('BLOCKED','GITHUB_RUNS_INVALID',common);recent=data.workflow_runs;}
 catch(error){return configuration('run-state',error,common)||outcome('BLOCKED','GITHUB_RUNS_UNAVAILABLE',{...common,errorCode:error.code||'UNKNOWN'});}
 if(recent.some(r=>recentOrBusy(r,now)))return outcome('SKIPPED','WORKFLOW_ALREADY_RUNNING_OR_RECENT',common);
 // POST is non-idempotent: no retry after an ambiguous transport/5xx result.
 let cache=attempted.get(fetcher);if(!cache){cache=new Map();attempted.set(fetcher,cache);}cache.set(token,now);
 try{
  const response=await request(fetcher,DISPATCH_URL,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({ref:'main',inputs:{target:'production',only_if_due:true}})},timing);
  if(response.status!==204){const error={httpStatus:response.status,...response.headers};return configuration('dispatch',error,common)||outcome('BLOCKED','DISPATCH_HTTP_'+(response.status||'UNAVAILABLE'),{...common,httpStatus:response.status,dispatchAcceptance:response.status>=500||response.status>=200&&response.status<300?'UNKNOWN':'NOT_CONFIRMED'});}
  return outcome('DISPATCHED',sourceError?'SNAPSHOT_SOURCE_UNREADABLE':'DUE',common);
 }catch(error){return outcome('BLOCKED','DISPATCH_OUTCOME_UNKNOWN',{...common,errorCode:error.code||'UNKNOWN',dispatchAcceptance:'UNKNOWN'});}
}
function check({fetcher=global.fetch,now=Date.now(),token=process.env.RADAR_GITHUB_DISPATCH_TOKEN,requestTimeoutMs=REQUEST_TIMEOUT_MS,totalTimeoutMs=TOTAL_TIMEOUT_MS,delay=sleep}={}){
 if(typeof token!=='string'||token.length<20||token.length>1024||/[\s\x00-\x1f\x7f]/.test(token))return Promise.resolve(outcome('CONFIGURATION_REQUIRED','RADAR_GITHUB_DISPATCH_TOKEN_MISSING_OR_INVALID'));
 const previous=attempted.get(fetcher)?.get(token);if(previous!==undefined&&now>=previous&&now-previous<RECENT_MS)return Promise.resolve(outcome('SKIPPED','DISPATCH_ALREADY_ATTEMPTED_THIS_PROCESS'));
 let jobs=pending.get(fetcher);if(!jobs){jobs=new Map();pending.set(fetcher,jobs);}if(jobs.has(token))return jobs.get(token);
 const timing={deadline:Date.now()+Math.min(TOTAL_TIMEOUT_MS,Math.max(1,Number(totalTimeoutMs)||TOTAL_TIMEOUT_MS)),requestTimeoutMs:Math.min(REQUEST_TIMEOUT_MS,Math.max(1,Number(requestTimeoutMs)||REQUEST_TIMEOUT_MS)),delay};
 const task=inspect({fetcher,now,token,timing}).finally(()=>{if(jobs.get(token)===task)jobs.delete(token);});jobs.set(token,task);return task;
}
function logRecord(event,result={}){return {message:event==='RADAR_SCHEDULER_START'?'ARCY Radar scheduler started':'ARCY Radar scheduler '+result.state+': '+result.reason,event,...result};}
if(require.main===module){
 console.log(JSON.stringify(logRecord('RADAR_SCHEDULER_START')));
 check().then(result=>{console.log(JSON.stringify(logRecord('RADAR_SCHEDULER_OUTCOME',result)));process.exitCode=exitCode(result);})
  .catch(()=>{const result=outcome('BLOCKED','SCHEDULER_UNEXPECTED_ERROR');console.error(JSON.stringify(logRecord('RADAR_SCHEDULER_OUTCOME',result)));process.exitCode=exitCode(result);});
}
module.exports={check,recentOrBusy,exitCode,logRecord,REPO,WORKFLOW,SNAPSHOT_URL,RUNS_URL,DISPATCH_URL,REQUEST_TIMEOUT_MS,TOTAL_TIMEOUT_MS};
