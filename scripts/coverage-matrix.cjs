#!/usr/bin/env node
'use strict';
// #337 Phase 0: machine-readable evidence matrix for the FIXED 40-token cohort across EVERY field of EVERY Search card.
// Read-only: GETs /api/search?action=report from ARCY_BASE (default production). One request per token, paced.
// Output: one MATRIX_ROW JSON line per (token, card, field) + MATRIX_SUMMARY (by card.field, by chain, overall).
// Tiers come from the existing verified-coverage tierOf (evidence-class taxonomy): VERIFIED | SOURCE_BACKED | HISTORICAL |
// STALE | CONFLICTING | NOT_VERIFIED. No field is dropped from a denominator here; inapplicability is reported, not applied.
const fs=require('node:fs'),path=require('node:path'),V=require('../search/server/lib/verified-coverage');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',PACE=Number(process.env.MATRIX_PACE_MS||2500);
const cohort=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/verified-coverage/radar-cohort-20261121.json'),'utf8'));
const OUT=process.env.MATRIX_OUT||null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(t){const t0=Date.now();
 try{const r=await fetch(BASE+'/api/search?action=report&chain='+t.network+'&address='+t.address,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(60000)});
  if(!r.ok)return {error:'HTTP_'+r.status,ms:Date.now()-t0};return {body:await r.json(),ms:Date.now()-t0};}
 catch(e){return {error:e.name==='TimeoutError'?'TIMEOUT':'FETCH_FAILED',ms:Date.now()-t0};}}
const short=v=>v==null?null:String(typeof v==='object'?JSON.stringify(v):v).slice(0,80);
(async()=>{
 const rows=[],now=Date.now();
 for(const t of cohort.tokens){
  const r=await get(t),cards=r.body?.cards||{};
  const names=Object.keys(cards).sort();
  if(r.error)rows.push({section:t.section,chainId:t.chainId,symbol:t.symbol,address:t.address,card:'*',key:'*',tier:'NOT_VERIFIED',reason:'REPORT_'+r.error,ms:r.ms});
  for(const card of names){
   const fields=cards[card]?.fields||{};
   for(const key of Object.keys(fields).sort()){
    const f=fields[key],tr=V.tierOf(f,card,now),ev=Array.isArray(f?.evidence)?f.evidence[0]:null;
    rows.push({section:t.section,chainId:t.chainId,symbol:t.symbol,address:t.address,card,key,tier:tr.tier,reason:tr.tier==='VERIFIED'||tr.tier==='SOURCE_BACKED'?null:(f?.reasonCode||tr.reason||null),
     status:f?.status||null,dataState:f?.dataState||null,value:short(f?.value),source:short(f?.source||ev?.source||ev?.provider),
     crossCheck:f?.crossCheck?(f.crossCheck.reasonCode||f.crossCheck.state||null):null,block:ev?.block||f?.snapshot?.block||null,asOf:f?.freshness?.sourceAsOf||f?.freshness?.observedAt||ev?.sourceAsOf||null,ms:r.ms});
   }
  }
  await wait(PACE);
 }
 for(const x of rows)console.log('MATRIX_ROW '+JSON.stringify(x));
 const agg=(keyf)=>{const m={};for(const x of rows){const k=keyf(x);m[k]=m[k]||{total:0,VERIFIED:0,SOURCE_BACKED:0,other:0,NOT_VERIFIED:0};m[k].total++;
  if(x.tier==='VERIFIED'||x.tier==='SOURCE_BACKED'||x.tier==='NOT_VERIFIED')m[k][x.tier]++;else m[k].other++;}return m;};
 const summary={base:BASE,generatedAt:new Date(now).toISOString(),tokens:cohort.tokens.length,rows:rows.length,
  byField:agg(x=>x.card+'.'+x.key),bySection:agg(x=>x.section),overall:agg(()=>'all').all,
  topReasons:Object.entries(rows.filter(x=>x.tier==='NOT_VERIFIED').reduce((m,x)=>{const k=x.card+'.'+x.key+'|'+x.reason;m[k]=(m[k]||0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]).slice(0,60)};
 console.log('MATRIX_SUMMARY '+JSON.stringify(summary));
 if(OUT)fs.writeFileSync(OUT,JSON.stringify({summary,rows}));
})().catch(e=>{console.error(e.name);process.exitCode=1;});
