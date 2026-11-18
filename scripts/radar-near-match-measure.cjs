#!/usr/bin/env node
'use strict';
// Issue #279 — near-match before/after MEASUREMENT on real data (CI only; nothing is published).
// Builds the legacy V3 Radar sections in CI with the keyless GeckoTerminal tier (allowed only outside Vercel by
// lib/radar-v2/sources.geckoAccess) and DEX Screener cross-checks, paced for the keyless 5 calls/minute limit, then runs the V4
// engine twice on the SAME sections: intake 'v4.0' (previous candidate intake) and 'near-match-1' (this change).
const radar=require('../lib/radar-v2'),engine=require('../lib/radar-v2/intel/engine');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 if(process.env.VERCEL==='1')throw Error('CI/local measurement only');
 const env={...process.env,MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'};
 const sections={},timing={};
 for(const n of ['arc','ethereum','robinhood','pons']){
  const t0=Date.now();
  try{sections[n]=await radar.load(n,{env,disableCache:n!=='pons'});timing[n]={ms:Date.now()-t0,usage:sections[n].usage,ok:true};}
  catch(e){timing[n]={ms:Date.now()-t0,error:e.code||e.message};sections[n]={ok:false};}
  if(n==='arc'||n==='ethereum')await sleep(65000); // keyless provider pacing (robinhood and pons share pages)
 }
 const rpc={arc:require('../search/server/lib/arc-rpc').rpc,robinhood:require('../search/server/lib/robinhood-rpc').rpc,ethereum:require('../search/server/lib/eth').rpc};
 const lim={unregisteredOnchain:Number(process.env.NM_ONCHAIN||3),rpcPerNetwork:600,httpPerRun:120,concurrency:1,maxCandidatesPerNetwork:45};
 const t1=Date.now();const before=await engine.run({sections,rpc,limits:{...lim,intake:'v4.0'}});const beforeMs=Date.now()-t1;
 engine._clearCache();
 const t2=Date.now();const after=await engine.run({sections,rpc,limits:{...lim,intake:'near-match-1'}});const afterMs=Date.now()-t2;
 const esc=x=>String(x).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
 const say=(t,o)=>{const m=JSON.stringify(o);console.log(m);if(process.env.GITHUB_ACTIONS==='true')console.log('::notice title='+t+'::'+esc(m).slice(0,3800));};
 say('near-match cost',{timing,beforeMs,afterMs,beforeCost:before.cost,afterCost:after.cost});
 for(const n of ['arc','ethereum','robinhood','pons']){
  const b=before.networks[n],a=after.networks[n],s=sections[n];
  say('near-match '+n,{v3:{ok:s.ok===true,unique:s.discovery?.uniqueCandidates??null,ranked:(s.tokens||[]).length,excludedListed:(s.excluded||[]).length,nearMissListed:(s.nearMiss||[]).length,
   nearMissStages:(s.nearMiss||[]).reduce((m,x)=>{m[x.stage]=(m[x.stage]||0)+1;return m;},{})},
   before:{candidates:b.funnel?.v4Candidates,shown:b.displayCandidates.length,byClass:b.display.byClass,excludedBy:b.funnel?.v4ExcludedBy},
   after:{candidates:a.funnel?.v4Candidates,shown:a.displayCandidates.length,byClass:a.display.byClass,classes:a.funnel?.classes,excludedBy:a.funnel?.v4ExcludedBy,shortfall:a.display.shortfall?.droppedByReason||null}});
  say('near-match rows '+n,a.displayCandidates.map(r=>[r.symbol,r.address.slice(0,8),r.discoveryClass,r.nearMatch?.maxDistance??0,(r.nearMatch?.missed||[]).map(m=>m.gate.split('_')[0]+':'+Math.round((1-m.distance)*100)+'%').join('+'),(r.nearMatch?.pending||[]).slice(0,2).join('+')].join('|')).join(' ; '));
 }
}
main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
