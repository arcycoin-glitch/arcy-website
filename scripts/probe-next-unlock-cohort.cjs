#!/usr/bin/env node
'use strict';
// Next Unlock coverage on the immutable 40-token cohort (data/verified-coverage/radar-cohort-20261121.json), chainId + exact
// contract. Runs the REAL Supply insight path (Arc contract-linked vesting / metadata, Ethereum reviewed registry, Robinhood none)
// against real chains from a checkout selected by ROOT. Read-only. Counts only schedules that are exact-contract source-reported.
//   ROOT=<checkout> node scripts/probe-next-unlock-cohort.cjs
const path=require('node:path'),root=path.resolve(process.env.ROOT||'.');
const cohort=require(path.join(root,'data/verified-coverage/radar-cohort-20261121.json')).tokens;
const supply=require(path.join(root,'search/server/lib/supply-insights.js'));
const ID={arc:5042,ethereum:1,robinhood:4663};
(async()=>{
 const started=Date.now(),rows=[];
 for(const t of cohort){
  const t0=Date.now();let f=null,error=null;
  try{const r=await supply.inspect({network:t.network,base:{address:t.address,network:t.network,chainId:ID[t.network]}});f=r.nextUnlock;}
  catch(e){error=String(e.message||e).slice(0,80);}
  rows.push({symbol:t.symbol,section:t.section,network:t.network,chainId:ID[t.network],address:t.address,
   verified:Boolean(f&&f.status!=='NOT_VERIFIED'&&f.value),status:f?.status||null,reasonCode:f?.reasonCode||null,blocker:f?.blocker?.category||null,
   detail:f?.blocker?.sourceReasons||f?.blocker?.registryReason||null,value:f?.value||null,ms:Date.now()-t0,error});
 }
 const by=k=>rows.reduce((m,r)=>{const key=r[k]===null?'(none)':String(r[k]);m[key]=(m[key]||0)+1;return m;},{});
 const per=n=>({total:rows.filter(r=>r.section===n).length,verified:rows.filter(r=>r.section===n&&r.verified).length});
 const out={measuredAt:new Date().toISOString(),root,total:rows.length,nextUnlockVerified:rows.filter(r=>r.verified).length,
  bySection:{arc:per('arc'),ethereum:per('ethereum'),robinhood:per('robinhood'),pons:per('pons')},byReasonCode:by('reasonCode'),byBlocker:by('blocker'),elapsedMs:Date.now()-started,
  providerCost:'Arc public RPC + contract metadata URLs only for Arc contracts; no paid API; Ethereum/Robinhood read no network',rows};
 console.log(JSON.stringify(out,null,2));
 const e=s=>s.replace(/%/g,'%25').replace(/\r?\n/g,'%0A');
 if(process.env.GITHUB_ACTIONS){
  const {rows:r,...head}=out;
  console.log('::notice title=next-unlock-'+(process.env.LABEL||'run')+'::'+e(JSON.stringify(head)));
  const compact=r.map(x=>[x.symbol,x.section,x.verified?'VE':'UN',x.blocker||x.reasonCode||x.error||'',typeof x.detail==='string'?x.detail:JSON.stringify(x.detail||'')].join('|'));
  for(let i=0;i<compact.length;i+=14)console.log('::notice title=next-unlock-'+(process.env.LABEL||'run')+'-rows-'+i/14+'::'+e(JSON.stringify(compact.slice(i,i+14))).slice(0,3900));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
