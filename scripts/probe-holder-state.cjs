'use strict';
// Read-only Arc Holder state probe. Uses only GET /api/holders?action=status|published and the cached Arc Radar list.
// It never calls action=queue or action=report, so it cannot start worker jobs or consume the first-time admission budget.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz',PACE=Math.max(300,Number(process.env.PACE_MS)||1200);
const FIXED=['0x73e5F588d27d6B5EC89C89c82692D1E7fECBd38b','0xf76b1d00bd3d63a37246b5f512074e864010e33d'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(p){await sleep(PACE);const r=await fetch(BASE+p,{headers:{accept:'application/json',referer:BASE+'/','sec-fetch-site':'same-origin'},signal:AbortSignal.timeout(20000)});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{}return {http:r.status,j};}
(async()=>{
 const rows=[];let list=[];
 try{const d=(await get('/api/search?action=radar&chain=arc')).j;list=(d?.tokens||[]).map(x=>x.address).filter(a=>/^0x[0-9a-f]{40}$/i.test(a||''));}catch{}
 const cohort=[...new Set([...FIXED,...list].map(a=>a.toLowerCase()))];
 for(const a of cohort){
  const [st,pub]=await Promise.all([get('/api/holders?address='+a+'&action=status'),get('/api/holders?address='+a+'&action=published')]);
  const job=st.j?.job||null,p=pub.j||{};
  rows.push({a,fixed:FIXED.map(x=>x.toLowerCase()).includes(a),
   job:job?{state:job.state,queued:job.queued,reason:job.reasonCode,attempts:job.attempts,retryAt:job.retryAt,updatedAt:job.updatedAt,hasComplete:job.hasCompleteSnapshot,progress:job.progress}:{http:st.http,ok:st.j?.ok,reason:st.j?.reasonCode},
   pub:{http:pub.http,status:p.status,reason:p.reasonCode||null,count:p.holderCount??null,largest:p.largestWalletPct??null,top10:p.top10Pct??null,top20:p.top20Pct??null,block:p.block||p.snapshot?.block||null,completedAt:p.snapshot?.completedAt||null,fresh:p.snapshot?.freshness||null,ageS:p.snapshot?.ageSeconds??null,complete:p.coverage?.complete??null}});
 }
 const sum={tokens:rows.length,complete:rows.filter(r=>r.pub.complete===true||r.pub.status==='ONCHAIN_VERIFIED').length,hasCompleteJob:rows.filter(r=>r.job.hasComplete).length,queued:rows.filter(r=>r.job.queued).length,states:{}};
 for(const r of rows){const s=r.job.state||('http'+r.job.http);sum.states[s]=(sum.states[s]||0)+1;}
 console.log('::notice title=holder-state-summary::'+JSON.stringify(sum));
 for(let i=0;i<rows.length;i+=3)console.log('::notice title=holder-state-rows-'+(i/3)+'::'+JSON.stringify(rows.slice(i,i+3)).slice(0,3900));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
