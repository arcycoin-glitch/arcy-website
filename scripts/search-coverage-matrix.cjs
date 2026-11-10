'use strict';
// Reproducible read-only audit: five token cards plus the separate, global Unlock calendar (sixth UI card).
// Pons is a Robinhood subset and is reported separately, never added to the three-chain total.
const fs=require('node:fs'),schema=require('../search/server/schema'),{classify}=require('../search/server/lib/evidence-class');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',PER=Math.max(1,Math.min(10,Number(process.env.PER_CHAIN)||10));
const raw={at:new Date().toISOString(),base:BASE,samples:[],errors:[],unlock:null,requestTimings:[]};
// Paced to stay under the production per-IP limiter (24/min): a 429 is a measurement artefact, not missing data.
// One bounded retry after the server's Retry-After (max 65 s); a second 429 is still reported as an error.
const PACE_MS=Math.max(0,Number(process.env.COVERAGE_PACE_MS??2700));let last=0,requests=0,throttled=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function get(p,retried=false){const gap=last+PACE_MS-Date.now();if(gap>0)await wait(gap);last=Date.now();requests++;const started=Date.now();
 const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/', 'sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(30000)});const text=await r.text();raw.requestTimings.push({path:p.split('?')[0],status:r.status,elapsedMs:Date.now()-started});
 if(r.status===429&&!retried){throttled++;await wait(Math.min(65000,Math.max(5000,Number(r.headers.get('retry-after'))*1000||30000)));return get(p,true);}
 if(!r.ok)throw Error('HTTP '+r.status+' '+p);try{return JSON.parse(text)}catch{throw Error('non-JSON '+p)}}
(async()=>{
 for(const section of ['arc','ethereum','robinhood','pons']){
  const chain=section==='pons'?'robinhood':section;let tokens=[];
  try{const d=await get('/api/search?action=radar&chain='+section);tokens=(d.tokens||[]).slice(0,PER);if(!tokens.length)raw.errors.push({section,error:'NO_RADAR_SAMPLE'});}catch(e){raw.errors.push({section,error:e.message});}
  for(const token of tokens){const address=token.address||token.token;if(!/^0x[0-9a-f]{40}$/i.test(address||''))continue;
   let report;try{report=await get('/api/search?action=report&chain='+chain+'&address='+address);}catch(e){raw.errors.push({section,address,error:e.message});}
   for(const card of schema)for(const [key] of card.fields){
    const cardData=report?.cards?.[card.id],field=cardData?.fields?.[key],classified=classify(field,{card:card.id});
    const outcome=require('./search-coverage-outcome.cjs').outcome({field,reportAvailable:Boolean(report),cardStatus:cardData?.status,evidenceClass:classified.evidenceClass});
    raw.samples.push({section,chain,address,card:card.id,key,field:field||null,cardStatus:cardData?.status||null,outcome,...classified});
   }
  }
 }
 try{raw.unlock=await get('/api/unlocks');}catch(e){raw.errors.push({section:'unlocks',error:e.message});}
 const totals={};for(const row of raw.samples){const k=row.section+'|'+row.card,t=totals[k]||={slots:0,filled:0,classes:{},outcomes:{}};t.slots++;if(row.evidenceClass!=='NOT_VERIFIED')t.filled++;t.classes[row.evidenceClass]=(t.classes[row.evidenceClass]||0)+1;t.outcomes[row.outcome]=(t.outcomes[row.outcome]||0)+1;}
 const outcomeTotals={};for(const row of raw.samples)outcomeTotals[row.outcome]=(outcomeTotals[row.outcome]||0)+1;
 const holderPopulation={};for(const section of ['arc','ethereum','robinhood']){const rows=raw.samples.filter(row=>row.section===section&&row.card==='holders'&&row.key==='holderCount');const t=holderPopulation[section]={tokens:rows.length,countFound:0,verifiedCount:0,oneTo20:0,21to60:0,over60:0,countUnavailable:0};for(const row of rows){const value=row.field?.value;const count=typeof value==='number'?value:(typeof value==='string'&&/^\\d+$/.test(value)?Number(value):null);if(count!==null&&Number.isSafeInteger(count)){t.countFound++;if(count<=20)t.oneTo20++;else if(count<=60)t['21to60']++;else t.over60++;}else t.countUnavailable++;if(row.outcome==='VERIFIED')t.verifiedCount++;}}
 const sorted=raw.requestTimings.map(x=>x.elapsedMs).sort((a,b)=>a-b);const percentile=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]:null;
 raw.totals=totals;raw.outcomeTotals=outcomeTotals;raw.holderPopulation=holderPopulation;raw.requestStats={requests,throttledRetries:throttled,paceMs:PACE_MS,totalResponseMs:sorted.reduce((a,b)=>a+b,0),p50ResponseMs:percentile(.5),p95ResponseMs:percentile(.95)};fs.writeFileSync(process.env.COVERAGE_OUTPUT||'/tmp/arcy-search-coverage.json',JSON.stringify(raw,null,2));console.log(JSON.stringify({at:raw.at,totals,outcomeTotals,holderPopulation,unlock:{ok:raw.unlock?.ok,status:raw.unlock?.status,confirmed:raw.unlock?.confirmed?.length,reported:raw.unlock?.reported?.length},errors:raw.errors,requestStats:raw.requestStats},null,2));
 // Public /api/unlocks (root Vercel route) publishes {ok, events, windows};
 // never confuse it with the search/server/lib unlock edition schema.
 const unlockValid=raw.unlock?.ok===true&&Array.isArray(raw.unlock?.events)&&
  ['today','next7','days8to30'].every(key=>Array.isArray(raw.unlock?.windows?.[key]));
 if(raw.errors.length||!raw.samples.length||!unlockValid)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
