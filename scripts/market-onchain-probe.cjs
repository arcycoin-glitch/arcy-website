#!/usr/bin/env node
'use strict';
// Real-chain validation of search/server/lib/market-onchain.js on the FIXED cohort (read-only):
// DEX Screener exact-contract fields -> same pools re-read on-chain at a pinned block -> market-cross.merge verdict.
// Prints one MARKET line per token + totals (calls, latency, failures by reason). No writes, no keys.
const fs=require('node:fs'),path=require('node:path');
process.env.SEARCH_MARKET_ONCHAIN_CHECK='on';
const dex=require('../search/server/lib/dex-market'),M=require('../search/server/lib/market-onchain'),mc=require('../search/server/lib/market-cross');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tally={price:{},liquidity:{},volume:{}},prof=[];
 for(const t of cohort.tokens){
  const net=t.network==='pons'?'robinhood':t.network;const t0=Date.now();
  let out={section:t.section,symbol:t.symbol};
  try{
   const primary=await dex.inspect(net,t.address);
   const r=await M.inspect(net,t.address,primary);
   const merged=mc.merge(primary,r.fields,{now:Date.now(),secondaryReason:r.profile.reasons});
   const cc=k=>merged[k]?.crossCheck||null;
   out={...out,ms:Date.now()-t0,calls:r.profile.calls,
    price:{ds:primary.priceUsd?.value??null,chain:r.fields.priceUsd?.value??null,kind:r.fields.priceUsd?.evidence?.[0]?.kind||null,state:cc('priceUsd')?.state||null,diff:cc('priceUsd')?.relativeDifference??null,reason:r.profile.reasons.priceUsd||null,pool:(primary.priceUsd?.evidence?.[0]?.pairs||[])[0]||null},
    liquidity:{ds:primary.liquidityUsd?.value??null,chain:r.fields.liquidityUsd?.value??null,state:cc('liquidityUsd')?.state||null,diff:cc('liquidityUsd')?.relativeDifference??null,reason:r.profile.reasons.liquidityUsd||null,pools:(primary.liquidityUsd?.evidence?.[0]?.pairs||[]).length},
    volume:{ds:primary.volume24h?.value??null,chain:r.fields.volume24h?.value??null,state:cc('volume24h')?.state||null,diff:cc('volume24h')?.relativeDifference??null,reason:r.profile.reasons.volume24h||null,pools:(primary.volume24h?.evidence?.[0]?.pairs||[]).length,swaps:r.fields.volume24h?.evidence?.[0]?.swaps??null,calls:r.profile.volume?.calls??null},
    all:r.profile.reasons.all||null};
   for(const k of ['price','liquidity','volume']){const s=out[k].state||('NONE:'+(out[k].reason||out.all));tally[k][s]=(tally[k][s]||0)+1;}
   prof.push({ms:out.ms,calls:out.calls});
  }catch(e){out.error=e.message;}
  console.log('MARKET '+JSON.stringify(out));
  await wait(400);
 }
 const ms=prof.map(p=>p.ms).sort((a,b)=>a-b),calls=prof.reduce((n,p)=>n+p.calls,0);
 console.log('MARKET_TOTAL '+JSON.stringify({tokens:prof.length,rpcCalls:calls,avgCalls:+(calls/Math.max(1,prof.length)).toFixed(1),medianMs:ms[Math.floor(ms.length/2)]??null,p90Ms:ms[Math.floor(ms.length*0.9)]??null,tally}));
})().catch(e=>{console.error(e);process.exitCode=1;});
