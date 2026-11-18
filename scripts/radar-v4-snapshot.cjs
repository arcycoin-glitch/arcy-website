#!/usr/bin/env node
'use strict';
// Radar V4 snapshot builder (issue #279). Runs OUTSIDE visitor requests (scheduled GitHub Actions job or manual).
// 1. Reads the four existing Radar sections from the site (edge-cached; no extra provider credit).
// 2. Runs the opportunity engine with bounded per-network budgets (registry, GitHub, Snapshot, Blockscout, read-only RPC,
//    reviewed exit engines).
// 3. Builds and validates the public snapshot, carrying forward any section that failed this run from the previous file.
// Usage: node scripts/radar-v4-snapshot.cjs --out radar-v4/snapshot.json [--previous radar-v4/snapshot.json]
// Never deploys, never writes Railway, never publishes an invalid snapshot (exit code 3 instead).
const fs=require('node:fs'),path=require('node:path');
const engine=require('../lib/radar-v2/intel/engine'),S=require('../lib/radar-v2/v4-snapshot');
const {sections}=require('./probe-radar-intel.cjs');
const arg=k=>{const i=process.argv.indexOf('--'+k);return i>0?process.argv[i+1]:null;};
async function main(){
 const out=arg('out');if(!out)throw Error('USAGE: --out file');
 const t0=Date.now();
 // Load audited risk holds BEFORE starting any on-chain run; late loading loses negative evidence on source errors.
 let previous=null;const prevPath=arg('previous');
 if(prevPath&&fs.existsSync(prevPath)){
  let doc;
  try{doc=JSON.parse(fs.readFileSync(prevPath,'utf8'));}catch{throw Error('PREVIOUS_SNAPSHOT_UNREADABLE_REFUSE_RISK_LEDGER_RESET');}
  if(doc?.schema==='arcy-radar-v4-snapshot/1')console.warn('Migrating original V4 snapshot v1; audited historical hold seed starts v2 ledger');
  else{
   const v=S.validate(doc);
   if(!v.ok)throw Error('PREVIOUS_SNAPSHOT_INVALID_REFUSE_RISK_LEDGER_RESET: '+v.reason);
   previous=doc;
  }
 }
 const s=await sections();
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const limits={unregisteredOnchain:Number(process.env.RADAR_V4_ONCHAIN_PER_NETWORK||6),rpcPerNetwork:Number(process.env.RADAR_V4_RPC_PER_NETWORK||900),
  httpPerRun:Number(process.env.RADAR_V4_HTTP_PER_RUN||200),concurrency:1,maxCandidatesPerNetwork:30};
 const result=await engine.run({sections:s.out,rpc,limits,priorRiskLedger:previous?.riskLedger||null});
 const snap=S.merge(previous,S.build(result,s.out,{commit:process.env.GITHUB_SHA||null}));
 snap.run={sectionTiming:s.timing,elapsedMs:Date.now()-t0,limits};
 const v=S.validate(snap);
 if(!v.ok){console.error('Refusing to publish invalid snapshot:',JSON.stringify(v));process.exitCode=3;return;}
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(snap));
 // Bounded, auditable revision index (last 42 runs ~ 7 days at 4-hourly cadence). Git history of the data branch keeps the bytes.
 const indexPath=arg('index');
 if(indexPath){
  let idx={schema:'arcy-radar-v4-snapshot-index/1',revisions:[]};
  try{const prev=JSON.parse(fs.readFileSync(indexPath,'utf8'));if(Array.isArray(prev?.revisions))idx.revisions=prev.revisions;}catch{}
  idx.revisions.unshift({generatedAt:snap.generatedAt,engineCommit:snap.engineCommit,sections:Object.fromEntries(Object.entries(snap.sections).map(([n,x])=>[n,{status:x.status,asOf:x.asOf,shown:x.rows.length,carriedForward:!!x.carriedForward}]))});
  idx.revisions=idx.revisions.slice(0,42);fs.writeFileSync(indexPath,JSON.stringify(idx,null,1));
 }
 // Optional: the exact public responses the serving code would return (used for flag-ON browser verification).
 const respDir=arg('responses');
 if(respDir){
  fs.mkdirSync(respDir,{recursive:true});S._reset();
  const local=async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)});
  for(const n of ['arc','ethereum','robinhood','pons']){const v=await S.serve(n,{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:local,now:Date.now()});
   fs.writeFileSync(path.join(respDir,n+'.json'),JSON.stringify(v.data||{ok:false,error:'V4_NOT_SERVED',reason:v.reason}));}
 }
 const summary={riskLedger:{held:snap.riskLedger.filter(r=>r.state==='HELD').length,cleared:snap.riskLedger.filter(r=>r.state==='CLEARED').length}};
 for(const [n,x] of Object.entries(snap.sections))summary[n]={legacyTop:(x.legacyTop||[]).length,legacyKept:(x.legacyTop||[]).filter(a=>x.rows.some(r=>r.address===a)).length,status:x.status,carriedForward:!!x.carriedForward,shown:x.rows.length,counts:x.counts,categories:x.categories,bySource:x.bySource,history:x.historyCoverage,
  shortfall:x.display?.shortfall||null,rows:x.rows.map(r=>[r.symbol,r.opportunity.displayTier,r.opportunity.score,JSON.stringify(r.opportunity.dimensions),r.opportunity.divergence?.signal,r.discovery.reason,r.address.slice(0,10)])};
 console.log(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,summary},null,1));
 if(process.env.GITHUB_ACTIONS==='true'){
  const esc=x=>String(x).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log('::notice title=radar-v4 cost::'+esc(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,registry:snap.registry})));
  // GitHub truncates annotation messages near 4 KB: one compact header + one compact row list per section.
  for(const [n,x] of Object.entries(summary)){
   console.log('::notice title=radar-v4 '+n+'::'+esc(JSON.stringify({legacyTop:x.legacyTop,legacyKept:x.legacyKept,status:x.status,carriedForward:x.carriedForward,shown:x.shown,counts:x.counts,categories:x.categories,bySource:x.bySource,history:x.history,shortfall:x.shortfall})).slice(0,3800));
   const d=v=>v===null||v===undefined?'-':Math.round(v);
   console.log('::notice title=radar-v4 rows '+n+'::'+esc(x.rows.map(r=>{const m=JSON.parse(r[3]||'{}');return [r[0],r[1]==='ELIGIBLE'?'E':'W',r[2],'p'+d(m.product)+' t'+d(m.team)+' a'+d(m.adoption)+' c'+d(m.catalyst)+' d'+d(m.divergence)+' m'+d(m.market),r[4]].join('|');}).join(' ; ')).slice(0,3800));
  }
 }
}
if(require.main===module)main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
