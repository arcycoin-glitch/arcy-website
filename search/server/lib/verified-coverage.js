'use strict';
// ARCY verified data coverage — fixed definition, measured on a FIXED token cohort (docs/audits/verified-coverage.md).
//   Coverage(verified)  = verified applicable core observations / applicable expected core observations × 100
//   Coverage(evidence)  = (verified + single-source, fresh) / applicable × 100   — reported separately, never mixed
// "Verified" uses the project's evidence taxonomy (evidence-class.js): ON_CHAIN_VERIFIED or CROSS_VERIFIED only.
// SINGLE_SOURCE, STALE, historical and NOT_VERIFIED observations are never counted as verified. A failed report keeps all of
// its expected observations in the denominator (as NOT_VERIFIED / REPORT_UNAVAILABLE). The only exclusion rule is listed in
// INAPPLICABLE and recorded per observation with its reason.
const {classify}=require('./evidence-class');
const VERSION='arcy-verified-coverage-1';
const CORE=Object.freeze([
 ['MARKET','activity','priceUsd'],['MARKET','liquidity','liquidityUsd'],['MARKET','liquidity','volume24h'],
 ['SUPPLY','supply','totalSupply'],
 ['HOLDERS','holders','holderCount'],['HOLDERS','holders','largestWalletPct'],['HOLDERS','holders','top10Pct'],['HOLDERS','holders','top20Pct'],
 ['MECHANICS','mechanics','tradingTaxes'],['MECHANICS','mechanics','mintCapability'],['MECHANICS','mechanics','ownerAdmin'],['MECHANICS','mechanics','contractArchitecture']]);
const FAMILIES=['MARKET','SUPPLY','HOLDERS','MECHANICS'];
// Auditable applicability rules. Nothing else may leave the denominator.
// Audit correction (phase 2): top20Pct may leave the denominator ONLY when the holder count itself is reliable, i.e. a COMPLETE
// census (holder-intelligence census().complete) whose count field is current (not historical, stale, conflicting or missing).
// An explorer-reported or candidate-based count below 20 keeps top20Pct in the denominator.
const INAPPLICABLE=Object.freeze({
 'holders.top20Pct':(r,{now=Date.now()}={})=>{const h=r?.cards?.holders,f=h?.fields?.holderCount;const n=Number(f?.value);
  if(!(f?.dataState==='DATA_FOUND'&&Number.isSafeInteger(n)&&n>0&&n<20))return null;
  const HI=require('./holder-intelligence'),census=HI.census(h.fields,{network:r?.network||null});
  if(!census.complete||!HI.COMPLETE_STATUSES.has(f.status))return null;
  const t=tierOf(f,'holders',now).tier;
  return t==='VERIFIED'||t==='SOURCE_BACKED'?'FEWER_THAN_20_HOLDERS_COMPLETE_CENSUS ('+n+')':null;}
});
function fieldOf(report,card,key){
 const c=report?.cards?.[card];
 // totalSupply lives in the supply card's auxiliary context (it is not one of the four Supply research checks)
 if(card==='supply'&&key==='totalSupply')return c?.fields?.totalSupply||c?.context?.totalSupply||null;
 return c?.fields?.[key]||null;
}
function tierOf(field,card,now){
 if(!field)return {tier:'NOT_VERIFIED',reason:'FIELD_ABSENT',evidenceClass:'NOT_VERIFIED'};
 const historical=field.status==='HISTORICAL_ONCHAIN_VERIFIED'||field.freshness?.state==='LAST_VERIFIED';
 const k=classify(field,{card,now});
 if(k.evidenceClass==='NOT_VERIFIED')return {tier:'NOT_VERIFIED',reason:k.provenance?.failureReason||'UNSPECIFIED',evidenceClass:k.evidenceClass};
 if(historical)return {tier:'HISTORICAL',reason:'LAST_VERIFIED_SNAPSHOT',evidenceClass:k.evidenceClass,asOf:k.provenance?.asOf||null};
 if(k.evidenceClass==='STALE')return {tier:'STALE',reason:k.evidenceClassBasis,evidenceClass:k.evidenceClass,asOf:k.provenance?.asOf||null};
 if(field.crossCheck?.state==='DISAGREE')return {tier:'CONFLICTING',reason:'PROVIDERS_DISAGREE',evidenceClass:k.evidenceClass};
 if(k.evidenceClass==='ON_CHAIN_VERIFIED'||k.evidenceClass==='CROSS_VERIFIED')return {tier:'VERIFIED',evidenceClass:k.evidenceClass,asOf:k.provenance?.asOf||null};
 return {tier:'SOURCE_BACKED',evidenceClass:k.evidenceClass,status:field.status||null,asOf:k.provenance?.asOf||null};
}
// One cohort token -> 12 observations (or the same 12 as NOT_VERIFIED when the report itself was unavailable)
function observe(token,report,{now=Date.now(),error=null}={}){
 return CORE.map(([family,card,key])=>{
  const id=card+'.'+key,base={section:token.section,network:token.network,address:token.address,symbol:token.symbol||null,family,card,key};
  if(!report||error)return {...base,applicable:true,tier:'NOT_VERIFIED',reason:'REPORT_UNAVAILABLE'+(error?':'+String(error).slice(0,60):'')};
  const why=INAPPLICABLE[id]?.(report,{now});
  if(why)return {...base,applicable:false,inapplicableReason:why,tier:'INAPPLICABLE'};
  return {...base,applicable:true,...tierOf(fieldOf(report,card,key),card,now)};
 });
}
const pct=(a,b)=>b?Math.round(10000*a/b)/100:null;
function summarise(rows,keyOf){
 const out={};
 for(const r of rows){const k=keyOf(r);const t=out[k]||={expected:0,applicable:0,inapplicable:0,verified:0,sourceBacked:0,stale:0,historical:0,conflicting:0,notVerified:0};
  t.expected++;if(!r.applicable){t.inapplicable++;continue;}t.applicable++;
  ({VERIFIED:()=>t.verified++,SOURCE_BACKED:()=>t.sourceBacked++,STALE:()=>t.stale++,HISTORICAL:()=>t.historical++,CONFLICTING:()=>t.conflicting++,NOT_VERIFIED:()=>t.notVerified++})[r.tier]?.();}
 // Definitions (audit correction): evidenceCoveragePct = CURRENT evidence only (verified + fresh single-source);
 // historicalCoveragePct = last-verified snapshots older than their freshness window, reported separately and never mixed into
 // current evidence; anyValuePct = every applicable field that carries a real value of any age (verified+source+stale+historical).
 for(const t of Object.values(out)){t.verifiedCoveragePct=pct(t.verified,t.applicable);t.evidenceCoveragePct=pct(t.verified+t.sourceBacked,t.applicable);
  t.historicalCoveragePct=pct(t.historical,t.applicable);t.staleCoveragePct=pct(t.stale,t.applicable);t.anyValuePct=pct(t.verified+t.sourceBacked+t.stale+t.historical,t.applicable);}
 return out;
}
function failures(rows){
 const m={};for(const r of rows)if(r.applicable&&r.tier!=='VERIFIED'){const k=r.card+'.'+r.key;const f=m[k]||={total:0,byTier:{},byReason:{}};f.total++;f.byTier[r.tier]=(f.byTier[r.tier]||0)+1;
  const why=String(r.reason||r.status||r.evidenceClass||'').slice(0,80);if(why)f.byReason[why]=(f.byReason[why]||0)+1;}
 return m;
}
function report(rows,{cohort=null,base=null,at=new Date().toISOString(),census=null,timings=null}={}){
 const all=summarise(rows,()=> 'ALL').ALL||null;
 return {version:VERSION,at,base,cohort,definition:{core:CORE.map(([f,c,k])=>f+':'+c+'.'+k),verified:'evidence-class ON_CHAIN_VERIFIED | CROSS_VERIFIED, fresh, not conflicting',
   evidence:'CURRENT evidence: verified + SINGLE_SOURCE (fresh, not conflicting); historical and stale are excluded and reported separately',historical:'last-verified snapshot outside its freshness window (never counted as current evidence)',inapplicable:Object.keys(INAPPLICABLE)},
  overall:all,byChain:summarise(rows,r=>r.section),byFamily:summarise(rows,r=>r.family),byChainFamily:summarise(rows,r=>r.section+'|'+r.family),
  byToken:summarise(rows,r=>r.section+'|'+r.symbol+'|'+r.address),byField:summarise(rows,r=>r.card+'.'+r.key),failures:failures(rows),census,timings};
}
// Fixed-cohort before/after comparison: same token set required; gains are reported per chain, per field and per chain x field.
function compare(before,after){
 const key=r=>r.section+'|'+r.address+'|'+r.card+'.'+r.key,b=new Map((before?.rows||[]).map(r=>[key(r),r])),a=new Map((after?.rows||[]).map(r=>[key(r),r]));
 const same=b.size>0&&b.size===a.size&&[...b.keys()].every(k=>a.has(k));
 const transitions={},cell=(m,k)=>m[k]||={before:0,after:0,gained:0,lost:0,applicableBefore:0,applicableAfter:0};
 const byChain={},byField={},byChainField={};
 for(const [k,rb] of b){const ra=a.get(k);if(!ra)continue;const id=rb.card+'.'+rb.key,vb=rb.applicable&&rb.tier==='VERIFIED',va=ra.applicable&&ra.tier==='VERIFIED';
  const tk=(rb.applicable?rb.tier:'INAPPLICABLE')+'->'+(ra.applicable?ra.tier:'INAPPLICABLE');transitions[tk]=(transitions[tk]||0)+1;
  for(const c of [cell(byChain,rb.section),cell(byField,id),cell(byChainField,rb.section+'|'+id)]){c.before+=vb;c.after+=va;c.gained+=(!vb&&va);c.lost+=(vb&&!va);c.applicableBefore+=rb.applicable;c.applicableAfter+=ra.applicable;}}
 for(const m of [byChain,byField,byChainField])for(const c of Object.values(m)){c.beforePct=pct(c.before,c.applicableBefore);c.afterPct=pct(c.after,c.applicableAfter);}
 return {sameCohort:same,overall:{before:before?.overall?.verifiedCoveragePct??null,after:after?.overall?.verifiedCoveragePct??null},byChain,byField,byChainField,transitions};
}
module.exports={VERSION,compare,CORE,FAMILIES,INAPPLICABLE,fieldOf,tierOf,observe,summarise,report};
