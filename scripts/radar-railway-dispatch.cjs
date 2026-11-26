#!/usr/bin/env node
'use strict';
// A separate, no-HTTP Railway Cron job for ARCY Radar. Does NOT run in the Holder
// worker or write snapshots itself. It only dispatches the reviewed GitHub Action.
// Fixed host/repository/workflow and single-snapshot age/busy gates prevent
// token exfiltration, provider credit bursts and unauthenticated triggering.
const {decide}=require('./radar-snapshot-freshness.cjs');

const REPO='arcycoin-glitch/arcy-website';
const WORKFLOW='radar-v4-snapshot.yml';
const SNAPSHOT_URL='https://raw.githubusercontent.com/'+REPO+'/radar-v4-snapshots/radar-v4/snapshot.json';
const API='https://api.github.com/repos/'+REPO+'/actions/workflows/'+WORKFLOW;
const RUNS_URL=API+'/runs?branch=main&per_page=10';
const DISPATCH_URL=API+'/dispatches';
const RECENT_MS=45*60*1000;
const REQUEST_TIMEOUT_MS=15000;
const JSON_LIMIT=3000000;

const outcome=(state,reason,other={})=>({state,reason,...other});

async function readJson(fetcher,url,headers={}){
 const response=await fetcher(url,{method:'GET',headers:{accept:'application/json',...headers},redirect:'error',
  signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
 if(!response?.ok)throw Error('HTTP_'+(response?.status||'UNAVAILABLE'));
 const text=await response.text();
 if(text.length>JSON_LIMIT)throw Error('RESPONSE_TOO_LARGE');
 try{return JSON.parse(text);}catch{throw Error('INVALID_JSON');}
}

function recentOrBusy(run,now){
 if(!run||typeof run!=='object')return false;
 const started=Date.parse(run.created_at||'');
 const recent=Number.isFinite(started)&&started<=now&&now-started<RECENT_MS;
 // GitHub serializes this workflow. Never queue extra runs while one is active.
 return ['queued','in_progress','waiting','pending','requested'].includes(run.status)||
  (recent&&['workflow_dispatch','schedule','push'].includes(run.event));
}

async function check({fetcher=global.fetch,now=Date.now(),token=process.env.RADAR_GITHUB_DISPATCH_TOKEN}={}){
 // This credential is separate from the Holder signing key and Railway tokens.
 // Do not log it, print request headers or accept URL overrides.
 if(typeof token!=='string'||token.length<20)return outcome('CONFIGURATION_REQUIRED','RADAR_GITHUB_DISPATCH_TOKEN_MISSING');

 let generatedAt=null,sourceError=null;
 try{
  const s=await readJson(fetcher,SNAPSHOT_URL,{'cache-control':'no-cache'});
  generatedAt=typeof s?.generatedAt==='string'?s.generatedAt:null;
 }catch(e){sourceError=e?.message||'SNAPSHOT_SOURCE_FAILED';}
 const age=decide({generatedAt,now,event:'schedule'});
 const common={ageMin:age.ageMin,level:age.level,snapshotReadable:sourceError===null};
 if(!age.build)return outcome('SKIPPED','SNAPSHOT_UNDER_100_MINUTES',common);

 // Fine-grained GitHub PAT permissions: Actions read/write on this repo only.
 // A failed run-state check aborts rather than risking duplicate dispatch.
 const headers={accept:'application/vnd.github+json',authorization:'Bearer '+token,
  'user-agent':'ARCY-Radar-Railway-Scheduler','x-github-api-version':'2022-11-28'};
 let recent=[];
 try{
  const data=await readJson(fetcher,RUNS_URL,headers);
  if(!Array.isArray(data?.workflow_runs))return outcome('BLOCKED','GITHUB_RUNS_INVALID',common);
  recent=data.workflow_runs;
 }catch(e){return outcome('BLOCKED','GITHUB_RUNS_UNAVAILABLE', {...common,errorCode:e?.message||'UNKNOWN'});}
 if(recent.some(r=>recentOrBusy(r,now)))
  return outcome('SKIPPED','WORKFLOW_ALREADY_RUNNING_OR_RECENT',common);

 try{
  const response=await fetcher(DISPATCH_URL,{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
   headers:{...headers,'content-type':'application/json'},
   body:JSON.stringify({ref:'main',inputs:{target:'production'}})
  });
  if(response?.status!==204)return outcome('BLOCKED','DISPATCH_HTTP_'+(response?.status||'UNAVAILABLE'),common);
  return outcome('DISPATCHED',sourceError?'SNAPSHOT_SOURCE_UNREADABLE':'DUE',common);
 }catch(e){return outcome('BLOCKED','DISPATCH_TRANSPORT_ERROR',{...common,errorCode:e?.name||'UNKNOWN'});}
}

if(require.main===module){
 check().then(r=>{
  // Only bounded state/reason/age and non-secret status are logged.
  console.log(JSON.stringify(r));
  if(r.state==='CONFIGURATION_REQUIRED')process.exitCode=2;
  else if(r.state==='BLOCKED')process.exitCode=1;
 }).catch(e=>{
  console.error(JSON.stringify({state:'BLOCKED',reason:'SCHEDULER_UNEXPECTED_ERROR',type:e?.name||'UNKNOWN'}));
  process.exitCode=1;
 });
}
module.exports={check,recentOrBusy,REPO,WORKFLOW,SNAPSHOT_URL,RUNS_URL,DISPATCH_URL};
