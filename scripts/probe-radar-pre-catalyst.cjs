#!/usr/bin/env node
'use strict';
// One read-only request per existing Radar section; no direct provider calls,
// publication, persistence, schedule or new route. Opt in explicitly.
const P=require('../lib/radar-v2/pre-catalyst');
const CHAINS=['arc','ethereum','robinhood','pons'];
async function probe({fetcher=global.fetch,base='https://www.arcyusdc.xyz',now=Date.now()}={}){
 if(base!=='https://www.arcyusdc.xyz')throw Error('SHADOW_BASE_NOT_ALLOWED');
 const out={mode:'SHADOW_ONLY',asOf:new Date(now).toISOString(),maxRequests:4,requests:0,sections:{}};
 const unique=new Set();let sectionRows=0;
 for(const chain of CHAINS){
  try{
   out.requests++;
   const response=await fetcher(base+'/api/search?action=radar&chain='+chain,{method:'GET',headers:{referer:base+'/',accept:'application/json','sec-fetch-site':'same-origin'},redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!response.ok){out.sections[chain]={http:response.status,status:'SOURCE_UNAVAILABLE',eligible:0};continue;}
   const data=await response.json();
   if(data?.ok!==true||data.network!==chain||!Array.isArray(data.tokens)||data.tokens.length>20){out.sections[chain]={http:response.status,status:'INVALID_SNAPSHOT',eligible:0};continue;}
   sectionRows+=data.tokens.length;
   for(const t of data.tokens)if(/^0x[0-9a-f]{40}$/i.test(t?.address||''))unique.add(data.chainId+':'+t.address.toLowerCase());
   const candidates=data.tokens.map(t=>({...t,poolCount:t.discovery?.poolsSeen||null,
    radarAsOf:data.asOf,radarFreshness:data.freshness}));
   const shadow=P.shortlist(candidates,{},now,chain);
   const reasons={};for(const d of shadow.diagnostics)for(const reason of d.reasons||[])reasons[reason]=(reasons[reason]||0)+1;
   out.sections[chain]={http:response.status,status:data.freshness==='STALE'?'STALE_SOURCE':'OBSERVED',asOf:data.asOf,
    observedCandidates:data.tokens.length,eligible:shadow.counts.eligible,review:shadow.counts.review,excluded:shadow.counts.excluded,
    firstReasons:Object.fromEntries(Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,8)),
    providerCallsReported:data.usage||null,poolsInspected:data.coverage?.poolsInspected??null,
    note:'Existing Radar candidate window only. No licensed OHLCV, historical liquidity, official token affiliation or dated project evidence was supplied to shadow evaluation.'};
  }catch(e){out.sections[chain]={status:'SOURCE_UNAVAILABLE',error:e?.name==='TimeoutError'?'TIMEOUT':'REQUEST_FAILED',eligible:0};}
 }
 out.sectionRows=sectionRows;out.uniqueExactContracts=unique.size;
 return out;
}
if(require.main===module){
 if(process.env.RADAR_PRECATALYST_SHADOW!=='1'){
  console.error('Shadow probe is OFF. Set RADAR_PRECATALYST_SHADOW=1 for one bounded read-only run.');process.exitCode=2;
 }else probe().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={probe};
