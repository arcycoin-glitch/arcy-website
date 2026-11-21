#!/usr/bin/env node
'use strict';
// Read-only verified-coverage measurement on a FIXED cohort (default data/coverage/radar-cohort-20261121.json).
// Calls only the public report API of ARCY_BASE (default Production), paced under the per-IP limiter, one bounded retry on 429.
// Output: JSON (COVERAGE_OUT, default /tmp/arcy-verified-coverage.json) + Markdown summary (GITHUB_STEP_SUMMARY when set).
const fs=require('node:fs'),path=require('node:path');
const V=require('../search/server/lib/verified-coverage');
const HI=require('../search/server/lib/holder-intelligence');
const BASE=(process.env.ARCY_BASE||'https://www.arcyusdc.xyz').replace(/\/$/,'');
const COHORT=process.env.COVERAGE_COHORT||path.join(__dirname,'../data/coverage/radar-cohort-20261121.json');
const OUT=process.env.COVERAGE_OUT||'/tmp/arcy-verified-coverage.json';
const PACE_MS=Math.max(0,Number(process.env.COVERAGE_PACE_MS??2700));
const LIMIT=Math.max(1,Math.min(400,Number(process.env.COVERAGE_LIMIT)||400));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let last=0;
async function get(p,retried=false){
 const gap=last+PACE_MS-Date.now();if(gap>0)await wait(gap);last=Date.now();const t0=Date.now();
 const headers={accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'};
 if(process.env.VERCEL_BYPASS)headers['x-vercel-protection-bypass']=process.env.VERCEL_BYPASS;
 const r=await fetch(BASE+p,{headers,signal:AbortSignal.timeout(60000)});const text=await r.text();
 if(r.status===429&&!retried){await wait(Math.min(65000,Math.max(5000,Number(r.headers.get('retry-after'))*1000||30000)));return get(p,true);}
 if(!r.ok)throw Object.assign(Error('HTTP_'+r.status),{ms:Date.now()-t0});
 try{return {body:JSON.parse(text),ms:Date.now()-t0};}catch{throw Object.assign(Error('NON_JSON'),{ms:Date.now()-t0});}
}
(async()=>{
 const cohort=JSON.parse(fs.readFileSync(COHORT,'utf8'));
 const rows=[],census={},timings=[],started=Date.now();
 for(const token of cohort.tokens.slice(0,LIMIT)){
  let report=null,error=null,ms=null;
  try{const r=await get('/api/search?action=report&chain='+token.network+'&address='+token.address);report=r.body;ms=r.ms;}
  catch(e){error=e.message;ms=e.ms??null;}
  timings.push({section:token.section,symbol:token.symbol,ms,error});
  rows.push(...V.observe(token,report,{error}));
  // holder census state: served value when present, else derived locally from the served fields (same rules)
  const h=report?.cards?.holders;
  const state=h?.holderIntelligence?.state||(h?HI.census(h.fields,{network:token.network}).state:'REPORT_UNAVAILABLE');
  const c=census[token.section]||={};c[state]=(c[state]||0)+1;
 }
 const doc=V.report(rows,{cohort:{file:path.basename(COHORT),...cohort.source,tokens:cohort.tokens.length},base:BASE,census,
  timings:{totalMs:Date.now()-started,reports:timings.length,failed:timings.filter(t=>t.error).length,medianMs:[...timings].map(t=>t.ms).filter(Number.isFinite).sort((a,b)=>a-b)[Math.floor(timings.length/2)]??null}});
 doc.rows=rows;
 fs.writeFileSync(OUT,JSON.stringify(doc,null,1));
 const line=(k,t)=>'| '+k+' | '+t.applicable+' | '+t.verified+' | '+t.sourceBacked+' | '+(t.stale+t.historical)+' | '+t.notVerified+' | **'+t.verifiedCoveragePct+'%** | '+t.evidenceCoveragePct+'% |';
 const head='| Scope | Applicable | Verified | Single-source | Stale/historical | Not verified | Verified coverage | Evidence coverage |\n|---|---|---|---|---|---|---|---|';
 let md='## ARCY verified coverage — '+BASE+'\n\nCohort `'+path.basename(COHORT)+'` ('+cohort.tokens.length+' tokens, snapshot '+cohort.source.snapshotGeneratedAt+'). Reports: '+doc.timings.reports+', failed: '+doc.timings.failed+'.\n\n'+head+'\n'+line('**All**',doc.overall)+'\n';
 for(const [k,t] of Object.entries(doc.byChain))md+=line(k,t)+'\n';
 md+='\n'+head+'\n';for(const [k,t] of Object.entries(doc.byFamily))md+=line(k,t)+'\n';
 md+='\n'+head+'\n';for(const [k,t] of Object.entries(doc.byField))md+=line(k,t)+'\n';
 md+='\nHolder census states: `'+JSON.stringify(census)+'`\n';
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);
 console.log(md);
 console.log('::notice title=verified coverage::'+JSON.stringify({base:BASE,overall:doc.overall,byChain:Object.fromEntries(Object.entries(doc.byChain).map(([k,t])=>[k,t.verifiedCoveragePct+'/'+t.evidenceCoveragePct])),census}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
