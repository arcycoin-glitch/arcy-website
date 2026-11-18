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
async function sections(fetcher=global.fetch){
 const out={},timing={};
 for(const chain of CHAINS){
  const t0=Date.now();
  try{
   const r=await fetcher(BASE+'/api/search?action=radar&chain='+chain,{headers:{referer:BASE+'/',accept:'application/json','sec-fetch-site':'same-origin'},redirect:'error',signal:AbortSignal.timeout(15000)});
   timing[chain]={http:r.status,ms:Date.now()-t0};
   out[chain]=r.ok?await r.json():{ok:false,http:r.status};
  }catch(e){timing[chain]={error:e?.name||'ERROR',ms:Date.now()-t0};out[chain]={ok:false};}
 }
 return {out,timing};
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
