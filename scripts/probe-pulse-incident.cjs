#!/usr/bin/env node
'use strict';
// READ-ONLY Arc Pulse incident probe. Public production endpoints + an in-process run of the repository's own Arc Pulse
// generator against the live sources (same code the worker runs). Nothing is published, signed or written.
const BASE='https://www.arcyusdc.xyz',H={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(p){try{const r=await fetch(BASE+p,{headers:H,signal:AbortSignal.timeout(60000)});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return {s:r.status,j,t:t.slice(0,300)};}catch(e){return {s:'ERR',e:String(e.message)};}}
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o&&k in o).map(k=>[k,o[k]]));
(async()=>{
 const cycles=Number(process.env.CYCLES||1),gap=Number(process.env.GAP_MS||0);
 for(let i=0;i<cycles;i++){
  const st=await get('/api/search?action=status');const c=st.j?.components||{};
  console.log('STATUS '+JSON.stringify({i,at:new Date().toISOString(),http:st.s,overall:st.j?.overall,version:st.j?.version,pulse:c.pulse,unlocks:c.unlocks,worker:c.holderWorker&&{state:c.holderWorker.state,reasonCode:c.holderWorker.reasonCode,heartbeat:c.holderWorker.heartbeat,backlog:c.holderWorker.backlog,rpc:c.holderWorker.rpc,scheduler:c.holderWorker.scheduler,runtime:c.holderWorker.runtime}}));
  if(i<cycles-1)await sleep(gap);
 }
 const p=await get('/api/pulse');
 console.log('PULSE '+JSON.stringify({http:p.s,...pick(p.j,['number','status','generatedAt','cycle','isCurrentWeekResearch','contentNotice']),audit:p.j?.audit&&pick(p.j.audit,['lastSuccessful','lastFailure','sourcesAttempted','sourcesSuccessfullyChecked','sourceFailures','acceptedItemCount','rejected','reasonCode','nextScheduledAt']),cards:(p.j?.cards||[]).map(c=>pick(c,['kind','title','publishedAt','contentType','url']))}).slice(0,6000));
 for(const n of [5,6,7]){const e=await get('/api/pulse?action=edition&number='+n);console.log('EDITION '+JSON.stringify({n,http:e.s,number:e.j?.number,status:e.j?.status,generatedAt:e.j?.generatedAt,cycle:e.j?.cycle,trigger:e.j?.audit?.lastSuccessful?.trigger,err:e.j?.error}));}
 // Same generator the worker uses (lib/pulse-edition.js), live sources, nothing written.
 const edition=require('../lib/pulse-edition');
 for(let k=0;k<2;k++){
  try{const d=await edition.generate({trigger:'probe'});console.log('GENERATE '+JSON.stringify({k,ok:true,status:d.status,number:d.number,cycle:d.cycle,audit:pick(d.audit,['sourcesAttempted','sourcesSuccessfullyChecked','sourceFailures','acceptedItemCount','candidateCount','rejected']),sourcesChecked:d.audit.sourcesChecked,cards:d.cards.map(c=>pick(c,['kind','title','publishedAt','url']))}).slice(0,6000));}
  catch(e){console.log('GENERATE '+JSON.stringify({k,ok:false,code:e.code,audit:e.audit&&pick(e.audit,['cycle','sourcesAttempted','sourcesSuccessfullyChecked','sourceFailures','sourcesChecked','candidateCount','acceptedItemCount','rejected'])}).slice(0,6000));}
  await sleep(20000);
 }
 // Raw reachability of each configured Arc source from a neutral runner (status, redirects, content type, bytes).
 for(const s of edition.SOURCES){for(const ua of ['ARCY-Pulse/1.0']){try{const t0=Date.now(),r=await fetch(s.url,{headers:{'user-agent':ua},redirect:'manual',signal:AbortSignal.timeout(15000)});const body=await r.text();console.log('SOURCE '+JSON.stringify({family:s.family,type:s.type,url:s.url,http:r.status,location:r.headers.get('location'),ctype:r.headers.get('content-type'),server:r.headers.get('server'),cfRay:Boolean(r.headers.get('cf-ray')),bytes:body.length,ms:Date.now()-t0,challenge:/challenge|cf-chl|captcha|Just a moment/i.test(body),title:(/<title[^>]*>([^<]{0,90})/i.exec(body)||[])[1]||null}));}catch(e){console.log('SOURCE '+JSON.stringify({family:s.family,url:s.url,error:e.name+': '+String(e.message).slice(0,80)}));}}}
})().catch(e=>{console.error(e);process.exitCode=1;});
