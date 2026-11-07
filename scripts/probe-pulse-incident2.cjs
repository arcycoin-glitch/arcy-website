#!/usr/bin/env node
'use strict';
// READ-ONLY probe 2: (a) Arction domain move evidence, (b) signed unlock change detection, (c) holder job progress across
// scheduler cycles for known Arc contracts (public job-status endpoint only; nothing is queued).
const fs=require('node:fs'),BASE='https://www.arcyusdc.xyz',H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(p){try{const r=await fetch(BASE+p,{headers:H,signal:AbortSignal.timeout(60000)});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return {s:r.status,j};}catch(e){return {s:'ERR',e:String(e.message)};}}
(async()=>{
 for(const [label,url,opts] of [['old-follow','https://arction.app/docs/roadmap',{}],['new-direct','https://arktion.app/docs/roadmap',{}],['new-root','https://arktion.app/',{}],['old-root-manual','https://arction.app/',{redirect:'manual'}]]){
  try{const r=await fetch(url,{headers:{'user-agent':'ARCY-Pulse/1.0'},signal:AbortSignal.timeout(15000),...opts});const b=await r.text();console.log('ARCTION '+JSON.stringify({label,url,finalUrl:r.url,http:r.status,location:r.headers.get('location'),server:r.headers.get('server'),mitigated:r.headers.get('cf-mitigated'),bytes:b.length,challenge:/challenge|cf-chl|Just a moment|Attention Required/i.test(b),title:(/<title[^>]*>([^<]{0,90})/i.exec(b)||[])[1]||null,arcMention:/\barc\b/i.test(b)}));}catch(e){console.log('ARCTION '+JSON.stringify({label,url,error:String(e.message).slice(0,80)}));}
 }
 const u=await get('/api/unlocks');const d=u.j||{};
 console.log('UNLOCKS '+JSON.stringify({http:u.s,generatedAt:d.generatedAt,refreshAt:d.refreshAt,trigger:d.trigger,events:Array.isArray(d.events)?d.events.length:null,hasChanges:'changes' in d,changes:d.changes?JSON.stringify(d.changes).slice(0,1500):null,signed:d.signature!==undefined||d.verified||d.signatureVerified||null,keys:Object.keys(d).slice(0,30),audit:d.audit?{lastSuccessful:d.audit.lastSuccessful,lastFailure:d.audit.lastFailure}:null}).slice(0,3000));
 const addrs=JSON.parse(fs.readFileSync('scripts/pulse-incident-holder-candidates.json','utf8'));
 const cycles=Number(process.env.CYCLES||3),gap=Number(process.env.GAP_MS||240000);
 for(let i=0;i<cycles;i++){
  const st=await get('/api/search?action=status');const w=st.j?.components?.holderWorker||{};
  console.log('WORKER '+JSON.stringify({i,at:new Date().toISOString(),state:w.state,reasonCode:w.reasonCode,backlog:w.backlog,scheduler:w.scheduler,rpc:w.rpc,lastInv:w.heartbeat}));
  for(const a of addrs){const j=await get('/api/holders?address='+a+'&action=status');const job=j.j?.job;if(job&&!job.hasCompleteSnapshot||job&&job.state!=='READY')console.log('JOB '+JSON.stringify({i,a,state:job.state,queued:job.queued,reasonCode:job.reasonCode,retryAt:job.retryAt,attempts:job.attempts,updatedAt:job.updatedAt,complete:job.hasCompleteSnapshot,progress:job.progress}));await sleep(1500);}
  if(i<cycles-1)await sleep(gap);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
