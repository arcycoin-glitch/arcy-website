#!/usr/bin/env node
'use strict';
// Read-only exact-cohort Arc Holder measurement.
// Reads ONLY: GET /api/holders?address=<a> (signed/published COMPLETE snapshot; never queues) and
// GET /api/holders?address=<a>&action=status (worker job inspection; read-only), plus at most 3 Arc RPC
// reads per contract (eth_chainId once, eth_getBlockByNumber + totalSupply eth_call at the published block).
// It never calls /api/search token reports (those may queue /queue-missing or stale refreshes) and never
// calls ?action=queue. No unrestricted chain scans.
//
// The cohort is the exact 10-contract Arc sample of the 2026-11-04 06:42 UTC PR #148 measurement
// (job 126432314332). Full addresses were recovered from annotations of the same workflow run
// (job 126432314500, radar-missing-24h) and the same-commit/same-second Market Radar probe
// (job 126432314134); every 6-hex prefix maps to exactly one full address in those artifacts.
const BASE=process.env.ARCY_BASE||'https://www.arcyusdc.xyz';
const RPC=process.env.ARC_RPC_URL||'https://rpc.mainnet.arc.io';
const COHORT=[
 ['0x394d38f807ee0027a182216f5e67a15ae441fa2e','FAZE','ON_CHAIN_VERIFIED'],
 ['0xece5ca8bf9220718e5727754026757512212cb3c','ARGUS','ON_CHAIN_VERIFIED'],
 ['0x4c9b47dbd5933aa4574b2c27f82419e4dbbd0222','ASTOCK','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'],
 ['0xadd104a903dfed7700547c0dba11b265a8027777','jackass','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'],
 ['0x150268ed0859645d720aa58fe59e7a7eaddb5777','lasers','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'],
 ['0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e','AF','ON_CHAIN_VERIFIED'],
 ['0x493cd970c73eb6e0b2346ce728b1a8d664f8e777','DEMOCRATHO','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'],
 ['0xa99a1c762ba23b67c6bdeb7c43b053401f874777','Groyper','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE'],
 ['0xbc43ce8dec648ea298c4275559b81d6261c90b67','TOLLY','ON_CHAIN_VERIFIED'],
 ['0x3ead4e80e9e5bc0e01682d7ee74c4881b040d3ea','KAIRO','SIGNED_HOLDER_PUBLICATION_UNAVAILABLE']
];
const KEYS=['holderCount','largestWalletPct','top10Pct','top20Pct'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(path){
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(BASE+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(r.status===429){await sleep(15000);continue;}
  const text=await r.text();let d=null;try{d=JSON.parse(text);}catch{}
  return {http:r.status,d};
 }
 return {http:429,d:null};
}
let rpcId=0;
async function rpc(method,params){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Object.assign(Error('RPC HTTP '+r.status),{httpStatus:r.status});const d=await r.json();if(d.error)throw Error('RPC error '+d.error.code);return d.result;}
// Publication classes. COMPLETE requires all four fields DATA_FOUND + ONCHAIN_VERIFIED at the snapshot block.
function classify(h){
 if(!h.d)return 'REQUEST_FAILED';
 if(h.d.ok===false)return 'API_ERROR';
 const found=KEYS.every(k=>h.d.fields?.[k]?.dataState==='DATA_FOUND');
 if(found)return 'COMPLETE';
 if(h.d.reasonCode==='HOLDER_SNAPSHOT_NOT_PUBLISHED'||h.d.publicationLookup?.state==='ABSENT')return 'ABSENT';
 return 'UNAVAILABLE';
}
function fieldChecks(d){
 const block=d.block,out={};
 for(const k of KEYS){const f=d.fields?.[k];out[k]=Boolean(f&&f.dataState==='DATA_FOUND'&&f.status==='ONCHAIN_VERIFIED'&&f.value===d[k]&&(f.evidence||[]).some(e=>e.block===block&&/^0x[0-9a-f]{64}$/i.test(e.anchor||'')));}
 out.ordering=Number.isFinite(d.largestWalletPct)&&d.largestWalletPct<=d.top10Pct&&d.top10Pct<=d.top20Pct&&d.top20Pct<=100;
 out.positiveHolders=Number.isSafeInteger(d.holderCount)&&d.holderCount>=1;
 return out;
}
(async()=>{
 const at=new Date().toISOString(),rows=[];let chainId=null;
 try{chainId=Number(BigInt(await rpc('eth_chainId',[])));}catch(e){chainId='UNAVAILABLE:'+e.message;}
 for(const [a,symbol,nov4] of COHORT){
  const pub=await get('/api/holders?address='+a);await sleep(3000);
  const st=await get('/api/holders?address='+a+'&action=status');await sleep(3000);
  // Signed feed only: action=published reads the worker's Ed25519-signed publication (signature verified server-side) first.
  const signed=await get('/api/holders?address='+a+'&action=published');await sleep(3000);
  const cls=classify(pub),d=pub.d||{},job=st.d?.job||null;
  const row={address:a,symbol,nov4,publication:cls,http:pub.http,lookup:d.publicationLookup||null,reasonCode:d.reasonCode||null,
   block:d.block||null,blockNumber:d.block?Number(BigInt(d.block)):null,completedAt:d.snapshot?.completedAt||null,
   ageHours:d.snapshot?.completedAt?Math.round((Date.now()-Date.parse(d.snapshot.completedAt))/36e5*10)/10:null,
   values:cls==='COMPLETE'?Object.fromEntries(KEYS.map(k=>[k,d[k]])):null,
   job:job?{state:job.state,queued:job.queued,reasonCode:job.reasonCode,retryAt:job.retryAt,attempts:job.attempts,updatedAt:job.updatedAt,hasCompleteSnapshot:job.hasCompleteSnapshot,progress:job.progress}:{unavailable:st.d?.reasonCode||('HTTP '+st.http)}};
  const sd=signed.d||{};row.signed={class:classify(signed),block:sd.block||null,completedAt:sd.snapshot?.completedAt||null,sameAsDefault:Boolean(sd.block)&&sd.block===d.block};
  if(cls==='COMPLETE'){
   const ev0=(d.evidence||[]).find(e=>e.block===d.block)||{};
   row.evidence={balanceOfReads:ev0.balanceOfReads??null,balanceReadMethod:ev0.balanceReadMethod||null,transferTail:ev0.transferTail?{from:ev0.transferTail.fromBlock,to:ev0.transferTail.toBlock}:null,incrementalReconciliation:ev0.incrementalReconciliation?{carriedFromBlock:ev0.incrementalReconciliation.carriedFromBlock,reread:ev0.incrementalReconciliation.rereadAtPinnedBlock,carried:ev0.incrementalReconciliation.carriedUnchanged,lastFullReadAt:ev0.incrementalReconciliation.lastFullReadAt}:null,coverageBasis:(d.coverage?.basis||'').slice(0,60)};
   row.checks=fieldChecks(d);
   try{const ev=(d.evidence||[]).find(e=>e.block===d.block)||{};const b=await rpc('eth_getBlockByNumber',[d.block,false]);row.checks.anchorMatchesChain=Boolean(b?.hash)&&b.hash===ev.anchor;
    if(/^\d+$/.test(ev.totalSupplyRaw||'')){const ts=BigInt(await rpc('eth_call',[{to:a,data:'0x18160ddd'},d.block]));row.checks.totalSupplyAtBlock=ts.toString()===ev.totalSupplyRaw;}
    else row.checks.totalSupplyAtBlock='NOT_IN_EVIDENCE';
    row.checks.chainId5042=chainId===5042;
   }catch(e){row.checks.onchain='UNAVAILABLE:'+e.message;}
  }
  rows.push(row);
 }
 const count=k=>rows.filter(r=>r.publication===k).length,jobs=s=>rows.filter(r=>r.job?.state===s).length;
 const fields=rows.filter(r=>r.publication==='COMPLETE').reduce((n,r)=>n+KEYS.filter(k=>r.checks?.[k]).length,0);
 const summary={at,base:BASE,cohort:rows.length,publication:{COMPLETE:count('COMPLETE'),ABSENT:count('ABSENT'),UNAVAILABLE:count('UNAVAILABLE'),API_ERROR:count('API_ERROR'),REQUEST_FAILED:count('REQUEST_FAILED')},
  holderFieldCoverage:fields+'/'+rows.length*KEYS.length,
  jobStates:Object.fromEntries(['READY','INDEXING','VERIFYING','QUEUED','FAILED','UNSUPPORTED'].map(s=>[s,jobs(s)])),
  stalePublications:rows.filter(r=>r.ageHours!==null&&r.ageHours>24).length,
  incrementalPublications:rows.filter(r=>r.evidence?.incrementalReconciliation).length,
  signedComplete:rows.filter(r=>r.signed?.class==='COMPLETE').length,
  onchainChecksAllPass:rows.filter(r=>r.checks&&Object.values(r.checks).every(v=>v===true)).length};
 console.log(JSON.stringify({summary,rows},null,1));
 for(const r of rows)console.log('::notice title=cohort-'+r.symbol+'::'+JSON.stringify(r).slice(0,3800));
 console.log('::notice title=cohort-summary::'+JSON.stringify(summary));
 require('node:fs').writeFileSync(process.env.COHORT_OUTPUT||'cohort.json',JSON.stringify({summary,rows},null,1));
})().catch(e=>{console.error(e);process.exitCode=1;});
