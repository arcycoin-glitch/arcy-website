'use strict';
// Read-only, bounded production baseline: one report per network (fixed cohort), 12 s apart, no retries.
const BASE='https://www.arcyusdc.xyz',COHORT=[['arc','0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b','ARCY'],['ethereum','0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE'],['robinhood','0x39dbed3a2bd333467115de45665cc57f813c4571','PONS']];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{for(const [chain,address,label] of COHORT){const t=Date.now();try{const r=await fetch(`${BASE}/api/search?action=report&chain=${chain}&address=${address}`,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(55000)});const d=await r.json();
 const rows=[];for(const [card,body] of Object.entries(d.cards||{}))for(const [key,f] of Object.entries(body.fields||{}))rows.push({card,key,v:typeof f.value==='string'?f.value.slice(0,60):f.value,status:f.status,cls:f.evidenceClass,reasonCode:f.reasonCode||null,hasReason:!!f.reason,source:f.source||null});
 console.log('BASELINE '+JSON.stringify({chain,label,http:r.status,ms:Date.now()-t,ok:d.ok,block:d.block,summary:d.evidenceSummary?.total,unlabeled:d.evidenceSummary?.unlabeledFailures,rows}));}catch(e){console.log('BASELINE '+JSON.stringify({chain,label,error:e.name,message:String(e.message).slice(0,100)}));}await sleep(12000);}})();
