#!/usr/bin/env node
'use strict';
// Read-only ceiling measurement for the liquidityUsd on-chain cross-check (fixed 40 cohort). For each token: the pools DEX Screener
// uses for its liquidity sum, their kind (dexId + labels), and whether the quote asset has a permitted USD reference in
// market-onchain QUOTES. Prints, per scenario, how many tokens would become fully reproducible. No writes, no credentials.
const fs=require('node:fs'),path=require('node:path'),{QUOTES}=require('../search/server/lib/market-onchain');
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8')).tokens;
const DS={arc:'arc',ethereum:'ethereum',robinhood:'robinhood',pons:'robinhood'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const sum={tokens:0,v2v3Only:0,v2v3v4:0,withCurveBalancer:0,quoteBlocked:0,fetchFailed:0};
 for(const t of cohort){
  const net=t.network==='pons'?'robinhood':t.network;let pairs=[];
  try{const r=await fetch('https://api.dexscreener.com/latest/dex/tokens/'+t.address,{signal:AbortSignal.timeout(15000)});const j=await r.json();pairs=j.pairs||[];}catch{sum.fetchFailed++;continue;}
  pairs=(Array.isArray(pairs)?pairs:[]).filter(p=>p.chainId===DS[t.network]).slice(0,30);
  const rows=pairs.map(p=>{const base=p.baseToken?.address?.toLowerCase(),quote=p.quoteToken?.address?.toLowerCase();const other=base===t.address?quote:base;
   const labels=(p.labels||[]).map(String),kind=labels.includes('v4')?'V4':labels.includes('v3')?'V3':labels.includes('v2')||/uniswap|sushi|pancake/.test(p.dexId||'')?'V2':'OTHER:'+p.dexId;
   const native=/^0x0{40}$/.test(other||'');return {pair:p.pairAddress,dex:p.dexId,kind,liq:p.liquidity?.usd??null,quoteOk:Boolean(QUOTES[net]?.[native?'0x0000000000000000000000000000000000000000':other])};});
  const kinds=rows.reduce((m,r)=>(m[r.kind]=(m[r.kind]||0)+1,m),{});
  const quoteBad=rows.filter(r=>!r.quoteOk).length,other=rows.filter(r=>r.kind.startsWith('OTHER')).length,v4=rows.filter(r=>r.kind==='V4').length;
  sum.tokens++;if(!quoteBad&&!other&&!v4)sum.v2v3Only++;if(!quoteBad&&!other)sum.v2v3v4++;if(other)sum.withCurveBalancer++;if(quoteBad)sum.quoteBlocked++;
  const liqTotal=rows.reduce((a,r)=>a+(r.liq||0),0),liqSupported=rows.filter(r=>r.quoteOk&&(r.kind==='V2'||r.kind==='V3')).reduce((a,r)=>a+(r.liq||0),0);
  console.log('CEIL '+JSON.stringify({section:t.section,symbol:t.symbol,pools:rows.length,kinds,quoteUnsupported:quoteBad,liqUsdShareV2V3Supported:liqTotal?Math.round(1000*liqSupported/liqTotal)/10:null}));
  await sleep(1200);
 }
 console.log('CEIL_SUMMARY '+JSON.stringify(sum));
})().catch(e=>{console.error(e);process.exitCode=1;});
