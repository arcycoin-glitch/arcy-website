'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {compareLatency}=require('./mechanics-v8-latency.cjs');
const fixed=require('../data/verified-coverage/radar-cohort-20261121.json');
const priorPreview=new Set('FOBO TORCH FRONG TAO HOOKR CVX YFI SKY UNI DELTA HMM PONS'.split(' '));
const address=x=>String(x||'').toLowerCase();
const id=r=>(r.network||r.chain)+'|'+address(r.address);
const directions=['buy','sell','transfer'];
function classify(row){
 const f=row.f.tradingTaxes,ledger=row.fees?.TOKEN_CONTRACT_TAX;
 if(ledger?.verificationStatus==='CONFLICTED')return {state:'UNSUPPORTED',cause:ledger.reason,diagnosis:'CONFLICTED_EVIDENCE'};
 if(!row.block)return {state:'UNKNOWN',cause:row.err||'NO_PINNED_BLOCK',diagnosis:'UNAVAILABLE_EVIDENCE'};
 const proof=(f.evidence||[]).find(e=>e.block===row.block&&address(e.address)===address(row.address)&&
  e.coverage==='TOKEN_TAX_ALL_TRANSFERS'&&/^[0-9a-f]{64}$/.test(e.sourceDigest||'')&&
  e.tokenTax&&directions.every(k=>/^\d+$/.test(e.tokenTax[k]||''))&&
  (e.tokenTax.scope==='TOKEN_CONTRACT_ONLY'||e.tokenTaxScope==='TOKEN_CONTRACT_ONLY'||
    ['IMMUTABLE_POOL_BUY_TAX','LAUNCH_TAX_DECAY_FIXED_SUPPLY'].includes(e.reviewedTokenProfile)));
 if((proof||ledger?.verificationStatus==='VERIFIED')&&['ON_CHAIN_VERIFIED','CROSS_VERIFIED'].includes(f.cls)&&
  f.state!=='STALE'&&!/NOT VERIFIED/i.test(f.value||''))return {state:'VERIFIED',cause:proof?.profile||ledger?.classification||'TOKEN_DEDUCTION_PROVEN'};
 if(f.state==='STALE')return {state:'PARTIALLY_VERIFIED',cause:'HISTORICAL_OBSERVATION',diagnosis:'UNAVAILABLE_EVIDENCE'};
 if(f.ok){
  const hook=f.evidence?.some(e=>e.hookSourceDigest&&e.portalSourceDigest);
  const conditional=f.evidence?.some(e=>e.profile==='MINIME_CONTROLLED');
  if(ledger?.classification==='VERIFIED_CONDITIONAL_TAX')return {state:'PARTIALLY_VERIFIED',cause:'CONDITIONAL_TOKEN_ROUTE',diagnosis:'SCOPED_OR_CONDITIONAL'};
  return {state:'PARTIALLY_VERIFIED',cause:hook?'HOOK_AND_POOL_SCOPED':conditional?'EXTERNAL_TRANSFER_AUTHORIZATION':
   f.evidence?.find(e=>e.coverage==='TOKEN_TRANSFER_ONLY')?.profile||'TOKEN_WIDE_EXECUTION_OR_UNITS_UNCONFIRMED',
   diagnosis:hook||conditional?'SCOPED_OR_CONDITIONAL':'PARTIAL_TOKEN_PATH'};
 }
 const runtime=row.audit?.source;
 const failures=row.fails||[];
 if(f.reason==='MECHANICS_IMPLEMENTATION_UNRESOLVED'||failures.includes('IMPLEMENTATION_EXECUTION_UNRESOLVED'))
  return {state:'UNSUPPORTED',cause:row.audit?.path?.status&&row.audit.path.status!=='NO_FURTHER_STANDARD_CLONE'?row.audit.path.status:'IMPLEMENTATION_EXECUTION_UNRESOLVED',diagnosis:'UNSUPPORTED_EXECUTION_PATH'};
 if(f.state==='RPC_ERROR'||f.state==='SOURCE_UNAVAILABLE'||failures.some(x=>/^RPC_|^SOURCE_(?:CODE_UNAVAILABLE|TIMEOUT|RATE_LIMIT|API_FAILED|RESPONSE_LIMIT|CAPACITY_LIMIT)/.test(x)))
  return {state:'UNKNOWN',cause:failures.find(x=>/^SOURCE_|^RPC_/.test(x))||f.reason||row.err||f.state,diagnosis:'UNAVAILABLE_EVIDENCE'};
 if(f.state==='UNSUPPORTED_CONTRACT')return {state:'UNSUPPORTED',cause:f.reason||failures[0]||f.state,diagnosis:'UNSUPPORTED_OR_CONFLICTED_EVIDENCE'};
 if(runtime?.matched||f.reason==='MECHANICS_EXECUTION_PATH_UNREVIEWED')
  return {state:'UNSUPPORTED',cause:runtime?.templateRejection||'SOURCE_PATH_NOT_REVIEWED',diagnosis:'ENGINE_PROFILE_GAP'};
 return {state:'UNKNOWN',cause:f.reason||failures[0]||row.err||'UNRESOLVED',diagnosis:'UNAVAILABLE_EVIDENCE'};
}
const p=(arr,q)=>Array.from(arr).sort((a,b)=>a-b)[Math.ceil(arr.length*q)-1]??null;
function measure(before,after,tokens=fixed.tokens){
 const capture=doc=>{const map=new Map();for(const row of doc.rows){assert(!map.has(id(row)),'duplicate measured subject '+id(row));map.set(id(row),row);}return map;};
 const b=capture(before),a=capture(after),seen=new Set();
 const rows=tokens.map(t=>{
  const k=id(t),base=b.get(k),next=a.get(k);assert(!seen.has(k)&&base&&next,'Missing or repeated fixed subject '+k);seen.add(k);
  assert.equal(base.block,next.block,'Pinned blocks differ for '+k);
  const previous=priorPreview.has(t.symbol)?'VERIFIED':'NOT_STRICT_VERIFIED';
  const old=classify(base),current=classify(next);
  const audit=next.audit||{}, edges=audit.authority?.edges||[];
  return {symbol:t.symbol,network:t.network,chainId:t.chainId,address:t.address,section:t.section,block:next.block,
   previousPreview:previous,before:old,after:{...current,
    ...(previous!=='VERIFIED'&&old.state!=='VERIFIED'&&current.state==='VERIFIED'?{diagnosis:'V8_PROOF_GAP_FIXED'}:{})},
   contractArchitecture:next.f.contractArchitecture?.value||null,
   implementation:audit.proxy?(Object.hasOwn(audit.proxy,'effectiveImplementation')?audit.proxy.effectiveImplementation:
    audit.source?.implementationExecutionResolved?audit.proxy.implementation:null):null,
   implementationCandidate:audit.proxy?.immediateTarget||next.f.contractArchitecture?.evidence?.find(x=>x.implementation)?.implementation||null,
   selectorRoutes:audit.diamondRoutes||null,
   source:audit.source||null,sources:audit.sources||[],
   upgradeAuthority:{traversalStatus:audit.authority?.traversalStatus||'UNKNOWN',confirmed:edges.filter(x=>x.verificationStatus==='CONFIRMED_AUTHORITY'),observed:edges.filter(x=>x.verificationStatus==='OBSERVED_CONTROLLER'),
    unresolved:edges.filter(x=>['CANDIDATE_CONTROLLER','UNKNOWN_AUTHORITY'].includes(x.verificationStatus))},
   ownerAdmin:next.f.ownerAdmin||null,privileges:audit.privileges||[],forensics:audit.forensics||null,
   feeAttribution:next.fees||null,tokenTaxProof:next.f.tradingTaxes,
   failures:audit.failures?.length?audit.failures:next.fails||[],readBudget:audit.reads||null,
   evidenceConflicts:(audit.failures||[]).filter(x=>x.verificationStatus==='CONFLICTED').concat(Object.values(next.fees||{}).filter(x=>x.verificationStatus==='CONFLICTED'))};
 });
 const stats=(s)=>Object.fromEntries(['VERIFIED','PARTIALLY_VERIFIED','UNKNOWN','UNSUPPORTED'].map(k=>[k,s.filter(x=>x===k).length]));
 const aggregate=sub=>({tokens:sub.length,before:stats(sub.map(x=>x.before.state)),after:stats(sub.map(x=>x.after.state)),
  confirmedUpgradeAuthority:sub.filter(r=>r.upgradeAuthority.confirmed.length).length,
  truncatedAuthorityGraph:sub.filter(r=>r.upgradeAuthority.traversalStatus==='TRUNCATED').length,
  incompleteAuthorityGraph:sub.filter(r=>r.upgradeAuthority.traversalStatus==='INCOMPLETE').length,
  sourceStateOwnerOrRole:sub.filter(r=>r.ownerAdmin?.cls==='ON_CHAIN_VERIFIED'||r.ownerAdmin?.cls==='CROSS_VERIFIED').length,
  observedRoleMembership:sub.filter(r=>r.privileges.some(x=>x.method==='hasRole'&&x.value===true)).length,
  burnCapabilityVerified:sub.filter(r=>r.forensics?.burnCapability?.verificationStatus==='VERIFIED').length,
  burnCapabilityPresent:sub.filter(r=>r.forensics?.burnCapability?.verificationStatus==='VERIFIED'&&r.forensics.burnCapability.value===true).length,
  burnExecutionVerified:sub.filter(r=>r.forensics?.burnExecution?.verificationStatus==='VERIFIED').length,
  verifiedBuybackExecution:sub.filter(r=>r.forensics?.buybackExecution?.verificationStatus==='VERIFIED').length,
  evidenceConflict:sub.filter(r=>r.evidenceConflicts.length).length});
 function costs(m){
  const rs=tokens.map(t=>m.get(id(t))), times=rs.map(r=>r.ms), sum=k=>rs.reduce((s,r)=>s+(r.net?.[k]||0),0);
  return {p50Ms:p(times,.5),p95Ms:p(times,.95),rpc:sum('rpc'),source:sum('sourcify'),failedTransportResponses:sum('failed'),replayMiss:sum('replayMiss'),
   rpcPerToken:sum('rpc')/rs.length,deepRequestCacheHits:rs.reduce((n,r)=>n+(r.audit?.reads?.cacheHits||0),0)};
 }
 return {fixedCohort:fixed.source,strictDefinition:'Pinned source-bound token-contract deductions, all three directions with typed rates. Hook/pool scope and transfer-only facts are partial.',
  previousPreview:{verified:rows.filter(x=>x.previousPreview==='VERIFIED').length,total:rows.length,source:'PR #321; different observation time'},
  beforeCommit:before.commit,afterCommit:after.commit,beforeMode:before.mode,afterMode:after.mode,
  total:aggregate(rows),byNetwork:Object.fromEntries([...new Set(tokens.map(t=>t.network))].map(n=>[n,aggregate(rows.filter(r=>r.network===n))])),
  measurement:{before:costs(b),after:costs(a),latencyContext:{fixed40:compareLatency({rows:before.rows.filter(r=>seen.has(id(r)))},{rows:after.rows.filter(r=>seen.has(id(r)))}),allBenchmarkSubjects:compareLatency(before,after)}},previousPreviewMisses:rows.filter(r=>r.previousPreview!=='VERIFIED').map(r=>r.symbol),
  fixedByV8:rows.filter(r=>r.after.diagnosis==='V8_PROOF_GAP_FIXED').map(r=>({symbol:r.symbol,address:r.address,block:r.block,cause:r.after.cause})),rows};
}
if(require.main===module){
 const [base,changed,out]=process.argv.slice(2);
 assert(base&&changed&&out,'Usage: node scripts/measure-mechanics-v8.cjs BEFORE AFTER OUTPUT');
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 const result=measure(read(base),read(changed));
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,rows:undefined},null,2));
}
module.exports={measure,classify};
