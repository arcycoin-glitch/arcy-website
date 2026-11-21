#!/usr/bin/env node
'use strict';
// Interleaved fixed-cohort A/B: for EVERY token the report is requested from A and then immediately from B, so third-party
// provider outages/rate limits hit both engines at the same moment (a sequential A-then-B run attributes provider drift to the code).
// Env: AB_BASE_A, AB_BASE_B, AB_OUT_A, AB_OUT_B, COVERAGE_PACE_MS (default 1500). Read-only; prints both summaries + COMPARE.
const fs=require('node:fs'),path=require('node:path'),V=require('../search/server/lib/verified-coverage');
const A=process.env.AB_BASE_A,B=process.env.AB_BASE_B,PACE=Number(process.env.COVERAGE_PACE_MS||1500);
const cohort=JSON.parse(fs.readFileSync(process.env.COVERAGE_COHORT||path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(base,t){const t0=Date.now();try{const r=await fetch(base+'/api/search?action=report&chain='+t.network+'&address='+t.address,{headers:{accept:'application/json',referer:base+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(90000)});
 if(!r.ok)return {error:'HTTP_'+r.status,ms:Date.now()-t0};return {body:await r.json(),ms:Date.now()-t0};}catch(e){return {error:e.name==='TimeoutError'?'TIMEOUT':'FETCH_FAILED',ms:Date.now()-t0};}}
(async()=>{
 const rows={A:[],B:[]},ms={A:[],B:[]},fail={A:{},B:{}};
 for(const t of cohort.tokens){for(const [k,base] of [['A',A],['B',B]]){const r=await get(base,t);ms[k].push(r.ms);if(r.error)fail[k][r.error]=(fail[k][r.error]||0)+1;rows[k].push(...V.observe(t,r.body||null,{error:r.error||null}));await wait(PACE);}}
 for(const k of ['A','B']){const doc=V.report(rows[k],{base:k==='A'?A:B,cohort:{tokens:cohort.tokens.length,...cohort.source},timings:{failed:Object.values(fail[k]).reduce((a,b)=>a+b,0),failures:fail[k],medianMs:[...ms[k]].sort((a,b)=>a-b)[Math.floor(ms[k].length/2)],p90Ms:[...ms[k]].sort((a,b)=>a-b)[Math.floor(ms[k].length*0.9)]}});doc.rows=rows[k];
  fs.writeFileSync(process.env['AB_OUT_'+k],JSON.stringify(doc));
  console.log('AB_'+k+' '+JSON.stringify({base:doc.base,overall:doc.overall,byChain:Object.fromEntries(Object.entries(doc.byChain).map(([c,x])=>[c,x.verifiedCoveragePct+'/'+x.evidenceCoveragePct])),byField:Object.fromEntries(Object.entries(doc.byField).map(([c,x])=>[c,x.verifiedCoveragePct+'/'+x.evidenceCoveragePct])),timings:doc.timings}));}
 // evidence losses per chain x field (any tier drop), to separate code regressions from provider drift
 const key=r=>r.section+'|'+r.address+'|'+r.card+'.'+r.key,bm=new Map(rows.A.map(r=>[key(r),r])),drops={};
 const rank={VERIFIED:3,SOURCE_BACKED:2,HISTORICAL:1,STALE:1,CONFLICTING:1,NOT_VERIFIED:0,INAPPLICABLE:-1};
 const dropTokens=new Map();
 for(const r of rows.B){const a=bm.get(key(r));if(a&&rank[r.tier]<rank[a.tier]){const k=r.section+'|'+r.symbol+'|'+r.card+'.'+r.key+'|'+a.tier+'->'+r.tier+'|'+String(r.reason||'').slice(0,50);drops[k]=(drops[k]||0)+1;dropTokens.set(r.address,cohort.tokens.find(t=>t.address===r.address));}}
 console.log('AB_DROPS '+JSON.stringify(drops));
 // Repeatability: every token with a drop is requested twice more from BOTH engines. A drop that does not reappear, or that also
 // appears on A, is provider drift; one that reappears only on B is a deterministic regression of the branch.
 for(const t of dropTokens.values()){const seen={A:[],B:[]};
  for(let i=0;i<2;i++)for(const [k,base] of [['A',A],['B',B]]){const r=await get(base,t);const obs=V.observe(t,r.body||null,{error:r.error||null});seen[k].push(Object.fromEntries(obs.map(o=>[o.card+'.'+o.key,o.tier])));await wait(PACE);}
  const fields=Object.keys(drops).filter(k=>k.split('|')[1]===t.symbol&&k.split('|')[0]===t.section).map(k=>k.split('|')[2]);
  console.log('AB_REPEAT '+JSON.stringify({section:t.section,symbol:t.symbol,address:t.address,fields:Object.fromEntries(fields.map(f=>[f,{A:seen.A.map(x=>x[f]),B:seen.B.map(x=>x[f])}]))}));}
 // Every provider/chain price disagreement on B, with the evidence needed to judge it.
 for(const t of cohort.tokens){const r=rows.B.find(x=>x.address===t.address&&x.key==='priceUsd');if(r?.tier!=='CONFLICTING')continue;
  const rep=await get(B,t);const f=rep.body?.cards?.activity?.fields?.priceUsd;
  console.log('AB_CONFLICT '+JSON.stringify({section:t.section,symbol:t.symbol,address:t.address,value:f?.value??null,crossCheck:f?.crossCheck||null,pools:(f?.evidence||[]).map(e=>({provider:e.provider||e.source,pairs:e.pairs,kind:e.kind||null,block:e.block||null,quote:e.quoteAsset||null,priceInQuote:e.priceInQuote??null,quoteUsd:e.quoteUsd??null,checkedAt:e.checkedAt||null}))}));}
})().catch(e=>{console.error(e);process.exitCode=1;});
