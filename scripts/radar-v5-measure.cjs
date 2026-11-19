#!/usr/bin/env node
'use strict';
// Issue #279 — V5 Quality Discovery before/after MEASUREMENT on real data (CI only; nothing is published).
//  1. Reads the SAME real legacy V3 sections the snapshot builder reads from Production (source=legacy-v3; site-origin headers,
//     edge-cached, no provider credit spent by this script).
//  2. Runs the engine twice on those sections: V4 as on main (Filter B off) and V5 (Filter A + Filter B).
//  3. Discovery expansion: builds Arc and Ethereum V3 sections in CI with the keyless tier (allowed only outside Vercel), normal and
//     expanded page plans, paced for the keyless 5 calls/minute limit, and runs V5 on the expanded sections.
const radar=require('../lib/radar-v2'),engine=require('../lib/radar-v2/intel/engine'),{sections:prodSections}=require('./probe-radar-intel.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=x=>String(x).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
const say=(t,o)=>{const m=JSON.stringify(o);console.log(t+' '+m);if(process.env.GITHUB_ACTIONS==='true')console.log('::notice title='+t+'::'+esc(m).slice(0,3800));};
const NETS=['arc','ethereum','robinhood','pons'];
function brief(r){
 const o={};
 for(const n of NETS){const x=r.networks[n];o[n]={shown:x.displayCandidates.length,byTier:x.display.byTier||{},byFilter:x.display.byFilter||{},byClass:x.display.byClass||{},
  universe:x.universe?{explorer:x.universe.explorer,registry:x.universe.registryListed,explorerListed:x.universe.explorerListed,lookups:x.universe.identityLookups,dexCalls:x.universe.dexCalls,considered:x.universe.considered,accepted:x.universe.accepted,rejected:x.universe.rejected}:null,
  filterA_dropped:x.display.shortfall?.droppedByReason||null,filterB:x.display.filterB||null,excludedBy:x.funnel?.v4ExcludedBy||null};}
 return o;
}
const rowsOf=x=>x.displayCandidates.map(r=>[r.symbol,r.discoveryTier,r.discoveryClass,r.researchRank?.score??'-',r.qualityRank?.score??'-',
 r.change24hPct===null||r.change24hPct===undefined?'-':Math.round(r.change24hPct),r.liquidityUsd==null?'-':Math.round(r.liquidityUsd),r.artwork?.url?'logo':'nologo'].join('|')).join(' ; ');
async function main(){
 if(process.env.VERCEL==='1')throw Error('CI/local measurement only');
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const lim={unregisteredOnchain:Number(process.env.V5_ONCHAIN||2),rpcPerNetwork:500,httpPerRun:120,concurrency:1,maxCandidatesPerNetwork:45,crossCheckFetcher:global.fetch,universeFetcher:global.fetch};
 // 1. Production legacy V3 input (what the 4-hourly builder consumes).
 const p=await prodSections();
 say('v5 input',{timing:p.timing,v3:Object.fromEntries(NETS.map(n=>[n,{ok:p.out[n]?.ok===true,unique:p.out[n]?.discovery?.uniqueCandidates??null,ranked:(p.out[n]?.tokens||[]).length,nearMiss:(p.out[n]?.nearMiss||[]).length,
  expansion:p.out[n]?.discovery?.expansion?'ON':'OFF'}]))});
 engine._clearCache();
 const t1=Date.now();const v4=await engine.run({sections:p.out,rpc,limits:{...lim,filterB:false,universe:false}});const v4Ms=Date.now()-t1;
 engine._clearCache();
 const t2=Date.now();const v5=await engine.run({sections:p.out,rpc,limits:lim});const v5Ms=Date.now()-t2;
 say('v5 cost',{v4Ms,v5Ms,v4Rpc:v4.cost.rpc,v5Cost:v5.cost});
 const b4=brief(v4),b5=brief(v5);
 // GitHub keeps at most 10 annotations per step: one per network, plus input/cost/coverage/expanded.
 for(const n of NETS)say('v5 '+n,{v4:{shown:b4[n].shown,byClass:b4[n].byClass},v5:b5[n],rows:rowsOf(v5.networks[n])});
 // Ethereum: why each listed established contract passed or failed (exact contract, never by popularity).
 {const QX=require('../lib/radar-v2/intel/quality-expansion'),U=require('../lib/radar-v2/intel/universe'),QR=require('../lib/radar-v2/intel/quality-rank');
  const n=v5.networks.ethereum,held=new Set((v5.riskLedger||[]).filter(x=>x.state==='HELD').map(x=>x.key));
  const tick=new Map();for(const r of n.all){const t=String(r.symbol||'').toLowerCase();if(!tick.has(t))tick.set(t,new Set());tick.get(t).add(r.address);}
  const sample=new Map((n.universe?.sample||[]).map(x=>[x[1],x[2]]));
  const out=U.registryFor(1).map(e=>{const row=n.all.find(r=>r.address===e.address);const shown=n.displayCandidates.find(r=>r.address===e.address);
   if(shown)return e.symbol+':SHOWN#'+shown.rank+'('+shown.discoveryTier+',Q'+shown.qualityRank.score+')';
   if(!row)return e.symbol+':'+(sample.get(e.address.slice(0,10))||'NOT_IN_INTAKE');
   const g=QX.gate(row,'ethereum',{tickers:tick,held,now:Date.now()});
   return e.symbol+':'+(g||('PASSED_GATES_Q'+QR.compute(row,'ethereum').score+'_NOT_IN_TOP_10'));});
  say('v5 ethereum registry',out.join(' '));}
 // 2. Discovery expansion (Arc + Ethereum) on keyless CI sources: normal vs expanded page plan, same gates.
 const env={...process.env,MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
 const exp={...p.out},cov={};
 for(const n of ['ethereum','arc']){
  for(const expanded of [false,true]){
   const t0=Date.now();
   try{const s=await radar.load(n,{env,disableCache:true,expanded});
    cov[n+(expanded?'_expanded':'_normal')]={ms:Date.now()-t0,calls:s.usage,unique:s.discovery?.uniqueCandidates,ranked:s.tokens.length,nearMiss:(s.nearMiss||[]).length,channels:s.discovery?.channels?.status};
    if(expanded)exp[n]=s;}
   catch(e){cov[n+(expanded?'_expanded':'_normal')]={ms:Date.now()-t0,error:e.code||e.message};}
   await sleep(75000); // keyless pacing
  }
 }
 say('v5 coverage',cov);
 engine._clearCache();
 const t3=Date.now();const vx=await engine.run({sections:exp,rpc,limits:lim});
 const bx=brief(vx);
 say('v5 expanded',{ms:Date.now()-t3,ethereum:{...bx.ethereum,rows:rowsOf(vx.networks.ethereum)},arc:{...bx.arc,rows:rowsOf(vx.networks.arc)}});
}
if(require.main===module)main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
