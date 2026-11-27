#!/usr/bin/env node
'use strict';
// Issue #279 — read-only shadow probe of the Radar Intelligence Engine against REAL sources.
// 1. Four GETs of the existing Radar sections on the production site (same as the #277 shadow probe; no provider credit
//    is spent by this script — the site serves its edge-cached snapshot).
// 2. The engine with real adapters: registry (repo file), GitHub REST, Snapshot, Blockscout, the existing read-only
//    Arc / Ethereum / Robinhood RPC clients, and the reviewed Liquidity & Exit engines.
// Writes radar-intel-report.json. Opt-in: RADAR_INTEL_PROBE=1. Never publishes, never writes storage, never deploys.
const fs=require('node:fs');
const engine=require('../lib/radar-v2/intel/engine');
const BASE='https://www.arcyusdc.xyz',CHAINS=['arc','ethereum','robinhood','pons'];
// The legacy-v3 Robinhood/Pons window is rebuilt on a cold edge cache (Pons factory reads + provider pages) and can exceed 15 s.
// A timeout / 5xx is retried with a longer budget (the first request usually finishes server-side and warms the cache).
// The last attempt stays under the 60 s function limit. A section that still fails is reported, never guessed.
const ATTEMPTS=[20000,45000,58000];
const MAX_BACKOFF_MS=30000;
function retryDelay(response,attempt,pauseMs,now){
 const raw=response?.headers?.get?.('retry-after');
 if(typeof raw==='string'&&raw.length<=80){
  const seconds=Number(raw),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(raw)-now;
  if(Number.isFinite(ms)&&ms>0)return ms>MAX_BACKOFF_MS?null:Math.ceil(ms);
 }
 return Math.min(MAX_BACKOFF_MS,pauseMs*2**attempt);
}
async function sections(fetcher=global.fetch,{attempts=ATTEMPTS,pauseMs=3000,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Array.isArray(attempts)||!attempts.length||attempts.length>3||attempts.some(ms=>!Number.isInteger(ms)||ms<1||ms>58000)||!Number.isFinite(pauseMs)||pauseMs<0||pauseMs>MAX_BACKOFF_MS)throw Error('INVALID_RADAR_SECTION_BUDGET');
 const out={},timing={};
 const load=async chain=>{
  const t0=Date.now(),tries=[];
  for(let i=0;i<attempts.length;i++){
   const t1=Date.now(),controller=new AbortController();let timer,response;
   try{
    const {r,body}=await Promise.race([(async()=>{
     const r=response=await fetcher(BASE+'/api/search?action=radar&chain='+chain+'&source=legacy-v3&discovery=v5-expanded',{headers:{referer:BASE+'/',accept:'application/json','sec-fetch-site':'same-origin'},redirect:'error',signal:controller.signal});
     return {r,body:r.ok?await r.json():{ok:false,http:r.status}};
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DOMException('Radar section timeout','TimeoutError'));},attempts[i]);})]);
    clearTimeout(timer);
    const attempt={http:r.status,ms:Date.now()-t1};tries.push(attempt);
    if([408,425,429].includes(r.status)||r.status>=500){
     if(i<attempts.length-1){
      const delay=retryDelay(r,i,pauseMs,Date.now());
      if(delay!==null){attempt.retryBackoffMs=delay;await sleep(delay);continue;}
      attempt.retryDeferred='RETRY_AFTER_EXCEEDS_BUDGET';
     }
    }
    // Circular-input guard: a V4-served section (deployed handler without the legacy-v3 bypass) is never used as engine input.
    if(body?.opportunity?.servedList==='V4_OPPORTUNITY'){out[chain]={ok:false,reason:'CIRCULAR_V4_INPUT_REFUSED'};timing[chain]={http:r.status,ms:Date.now()-t0,circular:true,attempts:tries};}
    else{out[chain]=body;timing[chain]={http:r.status,ms:Date.now()-t0,attempts:tries};}
    break;
   }catch(e){
    clearTimeout(timer);
    const error=String(e?.name||'ERROR').replace(/[^A-Za-z0-9_]/g,'').slice(0,40)||'ERROR',attempt={...(response?{http:response.status}:{}),error,ms:Date.now()-t1};tries.push(attempt);
    if(i<attempts.length-1){attempt.retryBackoffMs=Math.min(MAX_BACKOFF_MS,pauseMs*2**i);await sleep(attempt.retryBackoffMs);continue;}
    out[chain]={ok:false,reason:'SECTION_'+error.toUpperCase()};timing[chain]={error,ms:Date.now()-t0,attempts:tries};
   }finally{clearTimeout(timer);}
  }
 };
 // Separate the 4663 intake from the other chains. Robinhood and Pons share its provider/cache, so keep those two
 // sequential; a slow or failed 4663 window does not hold up Arc and Ethereum or amplify simultaneous 4663 scans.
 await Promise.all([['arc','ethereum'],['robinhood','pons']].map(async group=>{for(const chain of group)await load(chain);}));
 return {out:Object.fromEntries(CHAINS.map(n=>[n,out[n]])),timing:Object.fromEntries(CHAINS.map(n=>[n,timing[n]]))};
}
async function main(){
 const s=await sections();
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const limits={unregisteredOnchain:Number(process.env.RADAR_INTEL_UNREGISTERED_ONCHAIN||3),rpcPerNetwork:Number(process.env.RADAR_INTEL_RPC_PER_NETWORK||500),
  httpPerRun:Number(process.env.RADAR_INTEL_HTTP_PER_RUN||150),concurrency:1};
 const t0=Date.now();
 const report=await engine.run({sections:s.out,rpc,limits});
 report.probe={sectionTiming:s.timing,engineMs:Date.now()-t0,limits,githubToken:Boolean(process.env.GITHUB_TOKEN)};
 // warm re-run: measures cache effect (no new evidence expected inside TTLs)
 const t1=Date.now();const warm=await engine.run({sections:s.out,rpc,limits});
 report.probe.warm={engineMs:Date.now()-t1,cost:warm.cost};
 fs.writeFileSync('radar-intel-report.json',JSON.stringify(report,null,1));
 const brief={};for(const [n,x] of Object.entries(report.networks))brief[n]={...x.counts,history:x.historyCoverage,top:x.researchQueue.slice(0,3).map(r=>({symbol:r.symbol,conf:r.evidenceConfidence.score,missing:r.missingProof,notes:r.notes.slice(0,6)})),
  excluded:x.excluded.map(r=>({symbol:r.symbol,reasons:r.reasons.filter(z=>!/NOT_VERIFIED/.test(z))}))};
 console.log(JSON.stringify({asOf:report.asOf,registry:report.registry,cost:report.cost,probe:report.probe,notes:report.notes,networks:brief},null,1));
 // CI: compact check-run annotations (readable through the REST check-runs API without artifact downloads).
 if(process.env.GITHUB_ACTIONS==='true'){
  const esc=s=>String(s).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log('::notice title=radar-intel cost::'+esc(JSON.stringify({asOf:report.asOf,registry:{v:report.registry.version,approved:report.registry.approvedProjects},cost:report.cost,probe:report.probe,providers:report.providers,notes:report.notes})));
  for(const [n,x] of Object.entries(report.networks)){
   const rows=x.all.map(a=>[a.symbol,a.eligibility,a.evidenceConfidence?.score,a.runup?.history,a.runup?.historyReason,(a.reasons||[]).filter(z=>!/NOT_VERIFIED/.test(z)).join('+'),
    (a.notes||[]).join('+'),a.evidenceSummary?JSON.stringify({h:a.evidenceSummary.history,d:a.evidenceSummary.demand,x:a.evidenceSummary.exit,r:a.evidenceSummary.risk}):'']);
   console.log('::notice title=radar-intel '+n+'::'+esc(JSON.stringify({source:x.source,counts:x.counts,history:x.historyCoverage,reasons:x.reasonCounts,rows})).slice(0,60000));
  }
 }
}
if(require.main===module){
 if(process.env.RADAR_INTEL_PROBE!=='1'){console.error('Probe is OFF. Set RADAR_INTEL_PROBE=1 for one bounded read-only run.');process.exitCode=2;}
 else main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
}
module.exports={sections};
