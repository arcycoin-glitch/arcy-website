#!/usr/bin/env node
'use strict';
// Read-only market A/B: for each fixed-cohort token, run market-cross.inspect from two checkouts (A=main, B=branch) back to back,
// and classify liquidityUsd / priceUsd with the production evidence taxonomy. Usage: node probe-market-ab.cjs <dirA> <dirB>
const path=require('node:path'),fs=require('node:fs');
const [dirA,dirB]=process.argv.slice(2).map(d=>path.resolve(d));
const load=d=>({mc:require(path.join(d,'search/server/lib/market-cross')),V:require(path.join(d,'search/server/lib/verified-coverage'))});
const A=load(dirA),B=load(dirB);
const cohort=JSON.parse(fs.readFileSync(path.join(dirB,'data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens;
const env={SEARCH_MARKET_ONCHAIN_CHECK:'on'},sleep=ms=>new Promise(r=>setTimeout(r,ms)),tiers={A:{},B:{}};
(async()=>{
 for(const [i,t] of cohort.entries()){
  const net=t.network==='pons'?'robinhood':t.network,row={symbol:t.symbol,section:t.section};
  for(const [k,X] of (i%2?[['B',B],['A',A]]:[['A',A],['B',B]])){
   try{const f=await X.mc.inspect(net,t.address,{env});
    for(const [card,key] of [['liquidity','liquidityUsd'],['activity','priceUsd']]){const tr=X.V.tierOf(f[key],card,Date.now()).tier;row[k+'.'+key]=tr+(f[key]?.crossCheck?.state?'/'+f[key].crossCheck.state:'')+(f[key]?.crossCheck?.reasonCode?'/'+String(f[key].crossCheck.reasonCode).slice(0,60):'');
     tiers[k][key]=tiers[k][key]||{};tiers[k][key][tr]=(tiers[k][key][tr]||0)+1;}
   }catch(e){row[k]='ERROR '+(e.code||e.message);}
   await sleep(1500);
  }
  console.log('MARKET_AB '+JSON.stringify(row));
 }
 console.log('MARKET_AB_SUMMARY '+JSON.stringify(tiers));
})().catch(e=>{console.error(e);process.exitCode=1;});
