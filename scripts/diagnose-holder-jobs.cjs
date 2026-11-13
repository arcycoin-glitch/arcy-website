#!/usr/bin/env node
'use strict';
// Read-only Arc Holder job diagnosis. The public status endpoint reports only COUNTS (it never returns token addresses),
// so this script rebuilds a candidate list of Arc tokens from public sources and asks production for each token's
// worker job state through GET /api/holders?address=<a>&action=status (read-only job inspection; never queues work,
// never calls /api/search reports or ?action=queue). Output: every token whose job is FAILED / UNSUPPORTED, with the
// worker's reason code, attempts and retry time, plus the publication state. No secrets are used or printed.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const MAX=Math.min(400,Number(process.env.DIAG_MAX)||300);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ADDR=/^0x[0-9a-f]{40}$/;
async function json(url,timeout=20000){try{const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(timeout)});if(!r.ok)return {http:r.status};return {http:r.status,d:await r.json()};}catch(e){return {error:String(e.message).slice(0,60)};}}
async function blockscout(base){
 const out=[];let next='';
 for(let page=0;page<8&&out.length<MAX;page++){
  const r=await json(base+'/api/v2/tokens?type=ERC-20'+(next?'&'+next:''));
  if(!r.d?.items)break;
  for(const t of r.d.items){const a=String(t.address_hash||t.address||'').toLowerCase();if(ADDR.test(a))out.push([a,t.symbol||null,Number(t.holders_count||t.holders||0)]);}
  if(!r.d.next_page_params)break;next=new URLSearchParams(Object.entries(r.d.next_page_params).map(([k,v])=>[k,String(v)])).toString();
  await sleep(500);
 }
 return out;
}
async function gecko(){
 const out=[];
 for(let page=1;page<=5;page++){
  const r=await json('https://api.geckoterminal.com/api/v2/networks/arc/pools?page='+page);
  if(!r.d?.data?.length)break;
  for(const p of r.d.data)for(const rel of ['base_token','quote_token']){const id=p.relationships?.[rel]?.data?.id||'';const a=id.split('_').pop().toLowerCase();if(ADDR.test(a))out.push([a,null,null]);}
  await sleep(2200);
 }
 return out;
}
(async()=>{
 const sources={},candidates=new Map();
 for(const [name,fn] of [['arcscan',()=>blockscout('https://arcscan.app')],['explorer.arc.io',()=>blockscout('https://explorer.arc.io')],['geckoterminal',gecko]]){
  const list=await fn().catch(()=>[]);sources[name]=list.length;
  for(const [a,s,h] of list)if(!candidates.has(a))candidates.set(a,{symbol:s,holders:h});
 }
 for(const a of (process.env.DIAG_EXTRA||'').split(',').map(s=>s.trim().toLowerCase()).filter(a=>ADDR.test(a)))if(!candidates.has(a))candidates.set(a,{symbol:null,holders:null});
 console.log('DIAG_SOURCES '+JSON.stringify({...sources,unique:candidates.size}));
 const states={},rows=[];let checked=0;
 for(const [a,meta] of [...candidates].slice(0,MAX)){
  let r=await json(BASE+'/api/holders?address='+a+'&action=status',15000);
  if(r.http===429){await sleep(15000);r=await json(BASE+'/api/holders?address='+a+'&action=status',15000);}
  checked++;
  const job=r.d?.job||null,state=job?.state||(r.d?r.d.reasonCode||'NO_JOB':'HTTP_'+(r.http||r.error));
  states[state]=(states[state]||0)+1;
  if(job&&(job.state==='FAILED'||job.state==='UNSUPPORTED'||(job.attempts||0)>0)){
   const row={address:a,symbol:meta.symbol,explorerHolders:meta.holders,job:{state:job.state,reasonCode:job.reasonCode||null,attempts:job.attempts??null,retryAt:job.retryAt?new Date(job.retryAt).toISOString():null,updatedAt:job.updatedAt?new Date(job.updatedAt).toISOString():null,hasCompleteSnapshot:job.hasCompleteSnapshot??null,progress:job.progress||null}};
   rows.push(row);console.log('DIAG_JOB '+JSON.stringify(row));
  }
  await sleep(700);
 }
 console.log('DIAG_SUMMARY '+JSON.stringify({checked,states,flagged:rows.length}));
})().catch(e=>{console.error('DIAG_FAILED',e.message);process.exit(1);});
