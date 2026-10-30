'use strict';
// Reproducible read-only audit: five token cards plus the separate, global Unlock calendar (sixth UI card).
// Pons is a Robinhood subset and is reported separately, never added to the three-chain total.
const fs=require('node:fs'),schema=require('../search/server/schema'),{classify}=require('../search/server/lib/evidence-class');
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',PER=Math.max(1,Math.min(10,Number(process.env.PER_CHAIN)||10));
const raw={at:new Date().toISOString(),base:BASE,samples:[],errors:[],unlock:null};
async function get(p){const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/', 'sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(30000)});const text=await r.text();if(!r.ok)throw Error('HTTP '+r.status+' '+p);try{return JSON.parse(text)}catch{throw Error('non-JSON '+p)}}
(async()=>{
 for(const section of ['arc','ethereum','robinhood','pons']){
  const chain=section==='pons'?'robinhood':section;let tokens=[];
  try{const d=await get('/api/search?action=radar&chain='+section);tokens=(d.tokens||[]).slice(0,PER);if(!tokens.length)raw.errors.push({section,error:'NO_RADAR_SAMPLE'});}catch(e){raw.errors.push({section,error:e.message});}
  for(const token of tokens){const address=token.address||token.token;if(!/^0x[0-9a-f]{40}$/i.test(address||''))continue;
   let report;try{report=await get('/api/search?action=report&chain='+chain+'&address='+address);}catch(e){raw.errors.push({section,address,error:e.message});}
   for(const card of schema)for(const [key] of card.fields){const field=report?.cards?.[card.id]?.fields?.[key];raw.samples.push({section,chain,address,card:card.id,key,field:field||null,...classify(field,{card:card.id})});}
  }
 }
 try{raw.unlock=await get('/api/unlocks');}catch(e){raw.errors.push({section:'unlocks',error:e.message});}
 const totals={};for(const row of raw.samples){const k=row.section+'|'+row.card,t=totals[k]||={slots:0,filled:0,classes:{}};t.slots++;if(row.evidenceClass!=='NOT_VERIFIED')t.filled++;t.classes[row.evidenceClass]=(t.classes[row.evidenceClass]||0)+1;}
 raw.totals=totals;fs.writeFileSync(process.env.COVERAGE_OUTPUT||'/tmp/arcy-search-coverage.json',JSON.stringify(raw,null,2));console.log(JSON.stringify({at:raw.at,totals,unlock:{ok:raw.unlock?.ok,status:raw.unlock?.status,confirmed:raw.unlock?.confirmed?.length,reported:raw.unlock?.reported?.length},errors:raw.errors},null,2));
 if(raw.errors.length||!raw.samples.length||raw.unlock?.success!==true)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
