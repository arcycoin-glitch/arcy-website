#!/usr/bin/env node
'use strict';
// READ-ONLY production verification of Contract & Mechanics for the fixed 38-contract cohort.
// Ethereum/Robinhood/Pons: production /api/search report. Arc: report ONLY when the token already has a COMPLETE holder
// publication younger than 6 h (a report can otherwise queue Arc holder work); others are recorded as SKIPPED_ARC_QUEUE_GUARD.
// UI rows use the deployed search/mechanics-policy.js fetched from production itself.
const fs=require('node:fs'),vm=require('node:vm');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',FIELDS=['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'];
const cohort=JSON.parse(fs.readFileSync(process.env.COHORT_FILE||'scripts/mechanics-audit-cohort-20261105.json','utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(p,json=true){for(let i=0;i<3;i++){const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(60000)});if(r.status===429){await sleep(20000);continue;}const t=await r.text();return {s:r.status,j:json?(()=>{try{return JSON.parse(t)}catch{return null}})():t};}return {s:429,j:null};}
(async()=>{
 const policySrc=(await get('/search/mechanics-policy.js',false)).j;const sandbox={globalThis:{}};vm.runInNewContext(policySrc,sandbox);const policy=sandbox.globalThis.ARCYMechanicsPolicy;
 const deployed=await get('/api/search?action=health');
 console.log('PRODHEALTH '+JSON.stringify({http:deployed.s,commit:deployed.j?.commit||deployed.j?.version||null}).slice(0,400));console.log('::notice title=prod-health::'+JSON.stringify(deployed.j).slice(0,1500));
 const out=[];
 for(const c of cohort){
  const row={section:c.section,chain:c.chain,address:c.address,symbol:c.symbol};
  if(c.chain==='arc'){const h=await get('/api/holders?address='+c.address);await sleep(3000);const age=h.j?.snapshot?.ageSeconds;row.holderPublication=h.j?.status||null;if(!(h.j?.status==='ONCHAIN_VERIFIED'&&Number.isFinite(age)&&age<6*3600)){row.skipped='SKIPPED_ARC_QUEUE_GUARD';out.push(row);console.log('PRODROW '+JSON.stringify(row));continue;}}
  const r=await get('/api/search?action=report&chain='+c.chain+'&address='+c.address);await sleep(4000);
  row.http=r.s;const card=r.j?.cards?.mechanics;
  if(card){const pol=policy.assess(card,r.j);row.f=Object.fromEntries(FIELDS.map((k,i)=>{const f=card.fields?.[k]||{};return [k,{ds:f.dataState||null,st:f.status||null,rc:f.reasonCode||null,v:f.value===undefined||f.value===null?null:String(f.value).slice(0,70),ui:Boolean(pol.rows[i]),assurance:(f.evidence||[]).map(e=>e?.sourceAssurance).find(Boolean)||null,probe:(f.evidence||[]).some(e=>e?.probe)}];}));}
  out.push(row);console.log('PRODROW '+JSON.stringify(row));
 }
 const sum={};for(const r of out){const s=sum[r.section]||={tokens:0,measured:0,skipped:0,api:0,ui:0};s.tokens++;if(r.skipped){s.skipped++;continue;}if(!r.f)continue;s.measured++;for(const k of FIELDS){if(r.f[k].ds==='DATA_FOUND')s.api++;if(r.f[k].ui)s.ui++;}}
 console.log('PRODSUMMARY '+JSON.stringify(sum));fs.writeFileSync(process.env.PROD_OUT||'prod-rows.json',JSON.stringify(out));console.log('::notice title=prod-summary::'+JSON.stringify(sum));
})().catch(e=>{console.error(e);process.exitCode=1;});
