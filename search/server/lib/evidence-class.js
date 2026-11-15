'use strict';
// One evidence taxonomy for every displayed Search field. PURELY ADDITIVE: it never changes value/status/dataState, only adds
// `evidenceClass`, `evidenceClassBasis` and `provenance` so consumers (and the acceptance suite) can tell, per field:
//   ON_CHAIN_VERIFIED  value read/derived from chain state (or a signed pinned on-chain snapshot) and reconciled
//   CROSS_VERIFIED     two independent providers agreed within a documented tolerance (explicit `crossCheck.state==='AGREE'`)
//   SINGLE_SOURCE      one provider/explorer/getter reported it; nothing independent confirmed it
//   STALE              a value exists but its source/snapshot age exceeds the field's freshness limit (underlying class kept)
//   NOT_VERIFIED       no usable value; `provenance.failureReason` says why (never silent)
const lineageOf=require('./evidence-lineage').lineage;
const CLASSES=Object.freeze(['ON_CHAIN_VERIFIED','CROSS_VERIFIED','SINGLE_SOURCE','STALE','NOT_VERIFIED']);
const ONCHAIN=new Set(['ON_CHAIN','ON_CHAIN_DERIVED','SIGNED_ONCHAIN_SNAPSHOT','VERIFIED_SOURCE_AND_STATE']);
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
function underlying(f,lin){
 if(f.crossCheck?.state==='AGREE')return ['CROSS_VERIFIED','two independent providers agreed ('+(f.crossCheck.providers||[]).join(' + ')+')'];
 if(f.status==='SOURCE_REPORTED_RPC_RECONCILED')return ['SINGLE_SOURCE','RPC checked the source-ranked candidates at the pinned block; candidate-list completeness and the chain-wide ranking are not verified'];
 if(lin&&!lin.onchainOnly)return ['SINGLE_SOURCE','derived value capped by its weakest essential input: '+lin.reason+'; status '+f.status+' is kept for compatibility but is not an on-chain verification'];
 if(ONCHAIN.has(f.status))return ['ON_CHAIN_VERIFIED','status '+f.status+(lin?' (all essential inputs on-chain)':'')];
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
 const lin=lineageOf(f),[cls,why]=underlying(f,lin),stale=staleReason(f,card,now);
 if(lin)base.lineage=lin;
 if(f.crossCheck?.state==='DISAGREE')base.conflict={providers:f.crossCheck.providers||[],relativeDifference:f.crossCheck.relativeDifference??null};
 if(stale)return {evidenceClass:'STALE',evidenceClassBasis:stale,provenance:{...base,underlyingClass:cls,underlyingBasis:why,failureReason:null}};
 return {evidenceClass:cls,evidenceClassBasis:why,provenance:{...base,failureReason:null}};
}
// ── Data Engine V2 unified evidence state (additive; `evidenceClass` is unchanged) ──────────────────────────────────────
// VERIFIED · PARTIAL_EVIDENCE · SOURCE_DISAGREEMENT · STALE · NOT_VERIFIED · NOT_SUPPORTED.
// Two providers that serve the SAME underlying dataset are one source, not two: their agreement is PARTIAL_EVIDENCE.
const STATES=Object.freeze(['VERIFIED','PARTIAL_EVIDENCE','SOURCE_DISAGREEMENT','STALE','NOT_VERIFIED','NOT_SUPPORTED']);
const SAME_ORIGIN=Object.freeze([['geckoterminal','coingecko'],['blockscout','arcscan','explorer.robinhood.com'],['dexscreener','dex screener']]);
const originOf=p=>{const k=String(p||'').toLowerCase();const i=SAME_ORIGIN.findIndex(g=>g.some(x=>k.includes(x)));return i<0?k:'group:'+i;};
const independent=providers=>new Set((providers||[]).map(originOf)).size>=2;
const UNSUPPORTED=/UNSUPPORTED|NOT_SUPPORTED|NO_SUPPORTED|CHAIN_NOT_COVERED|NOT_APPLICABLE/;
function evidenceState(field,r){
 if(r.evidenceClass==='STALE')return ['STALE',r.evidenceClassBasis];
 if(field?.crossCheck?.state==='DISAGREE'||field?.reasonCode==='SOURCES_DISAGREE'||r.provenance?.conflict)return ['SOURCE_DISAGREEMENT','independent sources report different values'];
 if(r.evidenceClass==='NOT_VERIFIED'){
  const code=String(r.provenance?.failureReason||'');
  return UNSUPPORTED.test(code)?['NOT_SUPPORTED',code]:['NOT_VERIFIED',code||'no usable value'];
 }
 if(r.evidenceClass==='ON_CHAIN_VERIFIED')return ['VERIFIED','on-chain'];
 if(r.evidenceClass==='CROSS_VERIFIED')return independent(field?.crossCheck?.providers)?['VERIFIED','independent providers agree']:['PARTIAL_EVIDENCE','providers agree but share the same underlying dataset'];
 return ['PARTIAL_EVIDENCE','single source; not independently confirmed'];
}
// A licensing gate on a secondary provider is an operator matter; the user needs to know what is (not) established.
// Only the display sentence changes: reasonCode is kept and the original operator text moves to reasonDetail.
const PLAIN=Object.freeze({PROVIDER_DISABLED_LICENSE_UNVERIFIED:'Not established from verified source code or on-chain reads; no approved secondary source is enabled.'});
function plainReason(field){
 const text=PLAIN[field?.reasonCode];
 if(!text||field.value!==null&&field.value!==undefined||field.reasonDetail)return field;
 field.reasonDetail=field.reason||null;field.reason=text;return field;
}
function annotate(report,{now=Date.now()}={}){
 if(!report?.cards||typeof report.cards!=='object')return report;
 const summary={},total={},states={};for(const c of CLASSES)total[c]=0;for(const s of STATES)states[s]=0;let unlabeled=0,lineageCapped=0;
 for(const [card,body] of Object.entries(report.cards)){
  const row={};for(const c of CLASSES)row[c]=0;
  for(const [key,field] of Object.entries(body?.fields||{})){
   if(!field||typeof field!=='object')continue;
   plainReason(field);
   const r=classify(field,{card,now});field.evidenceClass=r.evidenceClass;field.evidenceClassBasis=r.evidenceClassBasis;field.provenance=r.provenance;
   const [st,stWhy]=evidenceState(field,r);field.evidenceState=st;field.evidenceStateBasis=stWhy;states[st]++;
   row[r.evidenceClass]++;total[r.evidenceClass]++;if(r.provenance.lineage&&!r.provenance.lineage.onchainOnly)lineageCapped++;if(r.provenance.failureReason==='UNSPECIFIED_NOT_VERIFIED')unlabeled++;
  }
  summary[card]=row;
 }
 report.evidenceSummary={classes:CLASSES,byCard:summary,total,unlabeledFailures:unlabeled,lineageCapped,states:STATES,stateTotal:states,generatedAt:new Date(now).toISOString()};
 return report;
}
module.exports={CLASSES,STATES,LIMITS,classify,annotate,plainReason,PLAIN,evidenceState,independent};
