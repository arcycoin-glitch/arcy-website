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
const engine=require('../lib/radar-v2/intel/engine'),S=require('../lib/radar-v2/v4-snapshot'),MM=require('../lib/radar-v2/intel/market-memory');
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
 // V5 market memory: a separate data-branch file (never served to visitors). First run: seed it from the snapshots already
 // published on this data branch (real, timestamped rows) — never from estimates.
 const memPath=arg('memory');let memory=null,memoryStatus='NONE';
 if(memPath&&fs.existsSync(memPath)){try{const m=JSON.parse(fs.readFileSync(memPath,'utf8'));if(MM.validate(m).ok&&m.version===MM.VERSION){memory=MM.load(m);memoryStatus='LOADED';}else memoryStatus='INVALID_RESET';}catch{memoryStatus='UNREADABLE_RESET';}}
 // Seed sources: this data branch and, read-only, the Production data branch (`--history`), so a PR preview run remembers the
 // moves Production already observed (e.g. WANTED +1,280% on 2026-11-20) instead of starting blind.
 if(!memory){
  memory=MM.empty();
  const {publishedSnapshots}=require('./radar-memory-history.cjs');
  const parts=[];let added=0;
  for(const p of [prevPath,...String(arg('history')||'').split(',').filter(Boolean)]){
   const h=publishedSnapshots(p);added+=MM.backfill(memory,h.docs);parts.push(path.basename(path.dirname(path.dirname(path.resolve(p||'.'))))+':'+h.status);
  }
  memoryStatus='BACKFILLED:'+added+'_OBSERVATIONS('+parts.join(',')+')';
 }
 const s=await sections();
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const limits={unregisteredOnchain:Number(process.env.RADAR_V4_ONCHAIN_PER_NETWORK||6),rpcPerNetwork:Number(process.env.RADAR_V4_RPC_PER_NETWORK||900),
  httpPerRun:Number(process.env.RADAR_V4_HTTP_PER_RUN||200),concurrency:1,maxCandidatesPerNetwork:60,crossCheckFetcher:global.fetch,universeFetcher:global.fetch};
 // V6: provider OHLCV (bounded, cached on the data branch) for the compression engine, and live re-check of reviewed official pages.
 const OH=require('./radar-ohlcv.cjs'),ohPath=arg('ohlcv-cache');
 let ohCache=OH.loadCache(null);if(ohPath&&fs.existsSync(ohPath)){try{ohCache=OH.loadCache(JSON.parse(fs.readFileSync(ohPath,'utf8')));}catch{}}
 const oh=OH.provider({env:process.env,cache:ohCache,maxCalls:Number(process.env.RADAR_OHLCV_MAX_CALLS||36)});
 // V6: builder official-page checks carried at most 7 days when a site is temporarily unreachable (data-branch file, bounded)
 const ofPath=arg('official-cache');let ofCache={};
 if(ofPath&&fs.existsSync(ofPath)){try{const d=JSON.parse(fs.readFileSync(ofPath,'utf8'));if(d?.version==='arcy-official-cache-1'&&d.entries&&typeof d.entries==='object')
  for(const [k,e] of Object.entries(d.entries))if(/^\d+:0x[0-9a-f]{40}$/.test(k)&&e?.dossier?.source==='BUILDER_LIVE_CHECK'&&Number.isFinite(Date.parse(e.at)))ofCache[k]=e;}catch{}}
 limits.officialCache=ofCache;
 limits.ohlcv=oh.fn||undefined;limits.ohlcvMax=Number(process.env.RADAR_OHLCV_PER_NETWORK||10);limits.officialFetcher=global.fetch;
 // V8: verified critical risk veto, evidence-calibrated opportunity priority, up to 10 visible candidates per network.
 limits.customFilter=process.env.RADAR_CUSTOM_FILTER_ENABLED==='true';
 // V8 exact Top 10: official Pons factory membership (targeted eth_call, chain-checked 4663, <=40 contracts) for Pons priority
 // and Pons coverage expansion. Builder only; a failure leaves Pons/Robinhood as observed (reported, never guessed).
 if(limits.customFilter){const ponsLib=require('../lib/radar-v2/pons');
  limits.ponsMembership=async addrs=>(await ponsLib.membershipMany(process.env.RADAR_PONS_RPC_URL||'https://rpc.mainnet.chain.robinhood.com',addrs,{fetcher:global.fetch,now:Date.now})).members;}
// Cached exact-pool history is reused for ALL 40 eligible candidates each cycle;
// only uncached pools compete for the bounded provider-call allowance.
const {NETWORKS}=require('../lib/radar-v2/sources');
limits.ohlcvHasCached=(network,row)=>Boolean(ohCache.entries[NETWORKS[network].chainId+':'+String(row.pool||'').toLowerCase()]);
 const result=await engine.run({sections:s.out,rpc,limits,priorRiskLedger:previous?.riskLedger||null,marketMemory:memory});
 const snap=S.merge(previous,S.build(result,s.out,{commit:process.env.GITHUB_SHA||null}));
 const historyRemoved=S.applyMemory(snap,result.marketMemory);
 snap.marketMemoryStatus={version:MM.VERSION,status:memoryStatus,contracts:Object.keys(result.marketMemory.entries).length,carriedRowsRemovedByHistory:historyRemoved};
 snap.run={sectionTiming:s.timing,elapsedMs:Date.now()-t0,limits:{...limits,ponsMembership:Boolean(limits.ponsMembership),ohlcv:Boolean(limits.ohlcv),officialCache:Object.keys(ofCache).length,officialFetcher:true,crossCheckFetcher:true,universeFetcher:true}};
 snap.v6Sources={ohlcv:{...oh.stats,cachedPools:Object.keys(ohCache.entries).length,perNetwork:result.v6?.ohlcv||{}},officialRecheck:result.v6?.official||{},officialDiscovery:result.v6?.discovery||{}};
 snap.v6Sources.ponsExpansion=result.ponsExpansion||null;
 // Per listed Ethereum contract: where it ended (main / watch reason / Filter B gate / not in intake). Audit trail, not served.
 {const U=require('../lib/radar-v2/intel/universe'),n=result.networks.ethereum||{};const main=new Map((n.displayCandidates||[]).map(r=>[r.address,r]));
  const watch=new Map((n.display?.watch||[]).map(w=>[w.address,w]));const all=new Map((n.all||[]).map(r=>[r.address,r]));
  snap.v6Sources.registryOutcome=U.registryFor(1).map(e=>{const a=e.address,m=main.get(a),w=watch.get(a),r=all.get(a);
   return e.symbol+':'+(m?'MAIN#'+m.rank+'('+m.researchRank?.researchBand+',pc'+m.profileCompleteness?.score+')':w?'WATCH('+(w.reasons||[]).join('+')+',pc'+w.profileCompleteness+')':r?'NOT_SHOWN('+(r.discoveryClass||'-')+')':'NOT_IN_INTAKE');}).join(' ');
  snap.v6Sources.filterB=Object.fromEntries(Object.entries(result.networks).map(([k,v])=>[k,v.display?.filterB?.droppedByReason||null]));}
 const v=S.validate(snap);
 if(!v.ok){console.error('Refusing to publish invalid snapshot:',JSON.stringify(v));
  for(const n of v.sections||[])console.error('invalid section '+n+':',JSON.stringify((snap.sections[n]?.rows||[]).map(x=>[x.rank,x.symbol,x.priceUsd,x.liquidityUsd,x.volume24hUsd,x.opportunity?.researchRank?.version,x.opportunity?.researchRank?.researchScore,x.opportunity?.identityLevel,x.opportunity?.category,x.launch?.status||null])).slice(0,3000));
  process.exitCode=3;return;}
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(snap));
 if(memPath){fs.mkdirSync(path.dirname(memPath),{recursive:true});fs.writeFileSync(memPath,JSON.stringify(result.marketMemory));}
 if(ohPath){fs.mkdirSync(path.dirname(ohPath),{recursive:true});fs.writeFileSync(ohPath,JSON.stringify(OH.pruneCache(ohCache)));}
 if(ofPath){const keep=Object.entries(ofCache).filter(([,e])=>Date.now()-Date.parse(e.at)<=7*86400000).slice(-400);fs.mkdirSync(path.dirname(ofPath),{recursive:true});fs.writeFileSync(ofPath,JSON.stringify({version:'arcy-official-cache-1',entries:Object.fromEntries(keep)}));}
 // Bounded, auditable revision index (last 84 runs ~ 7 days at the 2-hourly cadence). Git history of the data branch keeps the bytes.
 const indexPath=arg('index');
 if(indexPath){
  let idx={schema:'arcy-radar-v4-snapshot-index/1',revisions:[]};
  try{const prev=JSON.parse(fs.readFileSync(indexPath,'utf8'));if(Array.isArray(prev?.revisions))idx.revisions=prev.revisions;}catch{}
  idx.revisions.unshift({generatedAt:snap.generatedAt,engineCommit:snap.engineCommit,sections:Object.fromEntries(Object.entries(snap.sections).map(([n,x])=>[n,{status:x.status,asOf:x.asOf,shown:x.rows.length,carriedForward:!!x.carriedForward}]))});
  idx.revisions=idx.revisions.slice(0,84);fs.writeFileSync(indexPath,JSON.stringify(idx,null,1));
 }
 // Optional: the exact public responses the serving code would return (used for flag-ON browser verification).
 const respDir=arg('responses');
 if(respDir){
  fs.mkdirSync(respDir,{recursive:true});S._reset();
  const local=async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)});
  for(const n of ['arc','ethereum','robinhood','pons']){const v=await S.serve(n,{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:local,now:Date.now()});
   fs.writeFileSync(path.join(respDir,n+'.json'),JSON.stringify(v.data||{ok:false,error:'V4_NOT_SERVED',reason:v.reason}));}
 }
 const riskSummary={held:snap.riskLedger.filter(r=>r.state==='HELD').length,cleared:snap.riskLedger.filter(r=>r.state==='CLEARED').length};
 const summary={};
 for(const [n,x] of Object.entries(snap.sections))summary[n]={legacyTop:(x.legacyTop||[]).length,legacyKept:(x.legacyTop||[]).filter(a=>x.rows.some(r=>r.address===a)).length,status:x.status,carriedForward:!!x.carriedForward,shown:x.rows.length,counts:x.counts,categories:x.categories,bySource:x.bySource,history:x.historyCoverage,
  shortfall:x.display?.shortfall||null,rows:x.rows.map(r=>[r.symbol,r.opportunity.displayTier,r.opportunity.score,JSON.stringify(r.opportunity.dimensions),r.opportunity.divergence?.signal,r.discovery.reason,r.address.slice(0,10)])};
 console.log(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,riskLedger:riskSummary,summary},null,1));
 if(process.env.GITHUB_ACTIONS==='true'){
  const esc=x=>String(x).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
  console.log('::notice title=radar-v4 cost::'+esc(JSON.stringify({generatedAt:snap.generatedAt,cost:snap.cost,run:snap.run,registry:snap.registry,memory:snap.marketMemoryStatus})));
  // GitHub truncates annotation messages near 4 KB: one compact header + one compact row list per section.
  console.log('::notice title=radar-v5 universe::'+esc(JSON.stringify(Object.fromEntries(Object.entries(snap.sections).filter(([,x])=>x.universe).map(([n,x])=>[n,{explorer:x.universe.explorer,
   considered:x.universe.considered,accepted:x.universe.accepted,enriched:x.universe.enriched||0,rejected:x.universe.rejected,sample:(x.universe.sample||[]).map(s=>s.join(':')).join(' ')}])))).slice(0,3800));
  console.log('::notice title=radar-v6 sources::'+esc(JSON.stringify(snap.v6Sources)).slice(0,3800));
  for(const [n,x] of Object.entries(summary)){
   const d=v=>v===null||v===undefined?'-':Math.round(v);
   const sec=snap.sections[n];
   console.log('::notice title=radar-v6 '+n+'::'+esc(JSON.stringify({status:x.status,carriedForward:x.carriedForward,discovered:sec.counts?.candidates??null,funnel:sec.display?.v6Funnel||null,shown:sec.rows.length,byBand:sec.display?.byBand||null,
    watch:(sec.display?.watch||sec.watchOnly||[]).slice(0,10).map(w=>[w.symbol,(w.reasons||[]).join('+'),w.profileCompleteness??'-'].join('|')),
    rows:sec.rows.map(r=>{const o=r.opportunity;return [r.symbol,r.address,o.researchRank?.researchBand,o.researchRank?.researchScore,o.profileCompleteness?.score,o.compression?.status+':'+(o.compression?.days||0),
     o.integrity?.summary,o.qualityRank?.score,d(r.liquidityUsd),r.logo?'logo':'nologo'].join('|');})})).slice(0,3800));
  }
 }
}
if(require.main===module)main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
