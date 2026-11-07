#!/usr/bin/env node
'use strict';
// Read-only A/B mobile lab measurement. Does not modify Production or call token APIs directly.
// Runs equal Lighthouse 12 mobile/slow-4G simulations on current production and a pinned PR preview.
// Invalid or protected preview pages fail the measurement, rather than reporting false improvement.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const prod='https://www.arcyusdc.xyz/';
const preview=process.env.PREVIEW_URL;
const runs=Math.max(2,Math.min(3,Number(process.env.MOBILE_RUNS)||3));
const med=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null};
if(!/^https:\/\/arcy-official-[a-z0-9]+-arcy3\.vercel\.app\/$/.test(preview||''))throw Error('Expected exact pinned Vercel preview URL');
(async()=>{
 const initial={};
 for(const [k,url] of [['prod',prod],['preview',preview]]){
  const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(25000)});
  const html=await r.text();
  if(!r.ok||!html.includes('ARCY SEARCH')||html.includes('Vercel Authentication'))throw Error(k+' unavailable or protected, HTTP '+r.status);
  initial[k]={bytes:Buffer.byteLength(html),hasExternalCommunity:html.includes('src="/assets/arcy-community-illustration.webp"'),embeddedCommunity:html.includes('data:image/webp;base64,')};
 }
 const records={prod:[],preview:[]};
 // Interleave runs to minimize temporary traffic differences.
 for(let n=1;n<=runs;n++){
  for(const [k,url] of [['prod',prod],['preview',preview]]){
   const file='mobile-'+k+'-'+n+'.json';
   const args=['-y','lighthouse@12',url,'--quiet','--only-categories=performance','--form-factor=mobile','--screenEmulation.mobile','--throttling-method=simulate','--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage','--max-wait-for-load=60000','--output=json','--output-path='+file];
   const run=spawnSync('npx',args,{encoding:'utf8',timeout:135000,stdio:'pipe'});
   if(run.status!==0)throw Error(k+' lighthouse run '+n+' failed: '+(run.stderr||run.stdout||'').slice(-800));
   const data=JSON.parse(fs.readFileSync(file,'utf8'));const urlOut=new URL(data.finalDisplayedUrl||data.finalUrl||'about:blank');
   if(urlOut.hostname!==new URL(url).hostname)throw Error(k+' measurement navigated to unexpected host '+urlOut.hostname);
   const a=data.audits||{};
   const row={lcp:a['largest-contentful-paint']?.numericValue,fcp:a['first-contentful-paint']?.numericValue,cls:a['cumulative-layout-shift']?.numericValue,tbt:a['total-blocking-time']?.numericValue,bytes:a['total-byte-weight']?.numericValue,score:data.categories?.performance?.score,element:a['largest-contentful-paint-element']?.details?.items?.[0]?.node?.snippet||null};
   if(!Number.isFinite(row.lcp)||!Number.isFinite(row.cls))throw Error(k+' Lighthouse did not report valid LCP/CLS');
   records[k].push(row);
   console.log(k+' run='+n+' '+JSON.stringify(row));
  }
 }
 const summary={initial,runCount:runs,prod:Object.fromEntries(['lcp','fcp','cls','tbt','bytes','score'].map(k=>[k,med(records.prod.map(x=>x[k]))])),preview:Object.fromEntries(['lcp','fcp','cls','tbt','bytes','score'].map(k=>[k,med(records.preview.map(x=>x[k]))]))};
 summary.lcpDeltaMs=Number((summary.preview.lcp-summary.prod.lcp).toFixed(1));
 summary.lcpImprovementPct=Number(((summary.prod.lcp-summary.preview.lcp)/summary.prod.lcp*100).toFixed(1));
 summary.clsDelta=Number((summary.preview.cls-summary.prod.cls).toFixed(4));
 fs.writeFileSync('mobile-lcp-summary.json',JSON.stringify({summary,records},null,2));
 console.log('::notice title=mobile-lcp-comparison::'+JSON.stringify(summary).slice(0,3000));
 if(summary.lcpImprovementPct<0||summary.clsDelta>0.03)throw Error('Mobile preview LCP or CLS regressed; keep PR draft and do not merge.');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
