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
 const s=await sections();
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const limits={unregisteredOnchain:Number(process.env.RADAR_V4_ONCHAIN_PER_NETWORK||6),rpcPerNetwork:Number(process.env.RADAR_V4_RPC_PER_NETWORK||900),
  httpPerRun:Number(process.env.RADAR_V4_HTTP_PER_RUN||200),concurrency:1,maxCandidatesPerNetwork:30};
 const result=await engine.run({sections:s.out,rpc,limits});
 let previous=null;const prevPath=arg('previous');
 if(prevPath&&fs.existsSync(prevPath)){try{previous=JSON.parse(fs.readFileSync(prevPath,'utf8'));}catch{previous=null;}}
 const snap=S.merge(previous,S.build(result,s.out,{commit:process.env.GITHUB_SHA||null}));
 snap.run={sectionTiming:s.timing,elapsedMs:Date.now()-t0,limits};
 const v=S.validate(snap);
 if(!v.ok){console.error('Refusing to publish invalid snapshot:',JSON.stringify(v));process.exitCode=3;return;}
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(snap));
 const summary={};
 for(const [n,x] of Object.entries(snap.sections))summary[n]={status:x.status,carriedForward:!!x.carriedForward,shown:x.rows.length,counts:x.counts,categories:x.categories,bySource:x.bySource,history:x.historyCoverage,
  shortfall:x.display?.shortfall||null,rows:x.rows.map(r=>[r.symbol,r.opportunity.displayTier,r.opportunity.score,JSON.stringify(r.opportunity.dimensions),r.opportunity.divergence?.signal,r.discovery.reason])};
 console.log(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,summary},null,1));
 if(process.env.GITHUB_ACTIONS==='true'){
  const esc=x=>String(x).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log('::notice title=radar-v4 cost::'+esc(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,registry:snap.registry})));
  for(const [n,x] of Object.entries(summary))console.log('::notice title=radar-v4 '+n+'::'+esc(JSON.stringify(x)).slice(0,60000));
 }
}
if(require.main===module)main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
