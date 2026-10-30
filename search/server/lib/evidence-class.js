'use strict';
// One evidence taxonomy for every displayed Search field. PURELY ADDITIVE: it never changes value/status/dataState, only adds
// `evidenceClass`, `evidenceClassBasis` and `provenance` so consumers (and the acceptance suite) can tell, per field:
//   ON_CHAIN_VERIFIED  value read/derived from chain state (or a signed pinned on-chain snapshot) and reconciled
//   CROSS_VERIFIED     two independent providers agreed within a documented tolerance (explicit `crossCheck.state==='AGREE'`)
//   SINGLE_SOURCE      one provider/explorer/getter reported it; nothing independent confirmed it
//   STALE              a value exists but its source/snapshot age exceeds the field's freshness limit (underlying class kept)
//   NOT_VERIFIED       no usable value; `provenance.failureReason` says why (never silent)
const CLASSES=Object.freeze(['ON_CHAIN_VERIFIED','CROSS_VERIFIED','SINGLE_SOURCE','STALE','NOT_VERIFIED']);
const ONCHAIN=new Set(['ON_CHAIN','ON_CHAIN_DERIVED','SIGNED_ONCHAIN_SNAPSHOT','VERIFIED_SOURCE_AND_STATE','SOURCE_REPORTED_RPC_RECONCILED']);
// Freshness limits (documented targets, see docs/audits/quality-targets-*.md). Market data is live-fetched; holder snapshots are pinned.
const LIMITS=Object.freeze({marketAgeMs:30*60*1000,holderBlockAgeSeconds:24*3600,defaultAgeMs:24*3600*1000});
const MARKET_CARDS=new Set(['liquidity','activity']);
const iso=v=>{const t=typeof v==='number'?v:Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null;};
function sources(f){
 const out=new Set();if(typeof f.source==='string'&&f.source)out.add(f.source);
 for(const e of Array.isArray(f.evidence)?f.evidence:[]){for(const k of ['provider','source','legacySource']){if(typeof e?.[k]==='string'&&e[k])out.add(e[k]);}
  if(typeof e?.url==='string'){try{out.add(new URL(e.url).hostname);}catch{}}}
 for(const p of f.crossCheck?.providers||[])out.add(p);
 return [...out].slice(0,8);
}
function asOf(f){
 const s=f.snapshot;
 if(s?.completedAt)return {at:iso(s.completedAt),basis:'snapshot completion time (NOT the pinned block time unless blockTime is given)'};
 if(f.freshness?.retrievedAt)return {at:iso(f.freshness.retrievedAt),basis:f.freshness.basis||'provider response retrieval time'};
 const ev=(Array.isArray(f.evidence)?f.evidence:[]).map(e=>e?.checkedAt||e?.fetchedAt).find(Boolean);
 return ev?{at:iso(ev),basis:'evidence checkedAt'}:{at:null,basis:'no source timestamp supplied'};
}
function underlying(f){
 if(f.crossCheck?.state==='AGREE')return ['CROSS_VERIFIED','two independent providers agreed ('+(f.crossCheck.providers||[]).join(' + ')+')'];
 if(ONCHAIN.has(f.status))return ['ON_CHAIN_VERIFIED','status '+f.status];
 return ['SINGLE_SOURCE','status '+f.status+(f.source?' from '+f.source:'')+'; no independent confirmation recorded'];
}
function staleReason(f,card,now){
 const s=f.snapshot||{};
 if(Number.isFinite(s.blockAgeSeconds)&&s.blockAgeSeconds>LIMITS.holderBlockAgeSeconds)return 'pinned block is '+Math.round(s.blockAgeSeconds/3600)+' h old (limit '+LIMITS.holderBlockAgeSeconds/3600+' h)';
 if(s.freshness==='STALE')return 'snapshot freshness STALE';
 const age=Number.isFinite(f.freshness?.ageMs)?f.freshness.ageMs:null;
 if(age!==null&&age>(MARKET_CARDS.has(card)?LIMITS.marketAgeMs:LIMITS.defaultAgeMs))return 'source age '+Math.round(age/60000)+' min exceeds limit';
 return null;
}
function classify(f,{card='',now=Date.now()}={}){
 if(!f||typeof f!=='object')return {evidenceClass:'NOT_VERIFIED',evidenceClassBasis:'field missing from report',provenance:{sources:[],asOf:null,asOfBasis:'none',failureReason:'FIELD_ABSENT'}};
 const present=f.value!==null&&f.value!==undefined&&f.dataState!=='NOT_VERIFIED'&&f.status!=='NOT_VERIFIED'&&f.dataState!=='SOURCE_API_FAILED';
 const t=asOf(f),base={sources:sources(f),asOf:t.at,asOfBasis:t.basis,status:f.status||null,block:f.snapshot?.block||f.block||null};
 if(!present){
  const reason=f.reasonCode||(f.dataState==='SOURCE_API_FAILED'?'SOURCE_API_FAILED':null);
  return {evidenceClass:'NOT_VERIFIED',evidenceClassBasis:f.reason||'no usable value',provenance:{...base,failureReason:reason||'UNSPECIFIED_NOT_VERIFIED',failureDetail:f.reason||null}};
 }
 const [cls,why]=underlying(f),stale=staleReason(f,card,now);
 if(stale)return {evidenceClass:'STALE',evidenceClassBasis:stale,provenance:{...base,underlyingClass:cls,underlyingBasis:why,failureReason:null}};
 return {evidenceClass:cls,evidenceClassBasis:why,provenance:{...base,failureReason:null}};
}
function annotate(report,{now=Date.now()}={}){
 if(!report?.cards||typeof report.cards!=='object')return report;
 const summary={},total={};for(const c of CLASSES)total[c]=0;let unlabeled=0;
 for(const [card,body] of Object.entries(report.cards)){
  const row={};for(const c of CLASSES)row[c]=0;
  for(const [key,field] of Object.entries(body?.fields||{})){
   if(!field||typeof field!=='object')continue;
   const r=classify(field,{card,now});field.evidenceClass=r.evidenceClass;field.evidenceClassBasis=r.evidenceClassBasis;field.provenance=r.provenance;
   row[r.evidenceClass]++;total[r.evidenceClass]++;if(r.provenance.failureReason==='UNSPECIFIED_NOT_VERIFIED')unlabeled++;
  }
  summary[card]=row;
 }
 report.evidenceSummary={classes:CLASSES,byCard:summary,total,unlabeledFailures:unlabeled,generatedAt:new Date(now).toISOString()};
 return report;
}
module.exports={CLASSES,LIMITS,classify,annotate};
