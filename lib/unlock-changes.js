'use strict';
// Deterministic change detection between two VERIFIED (signature-checked) unlock editions.
// Identity = project (projectId, else normalized name) + ticker + allocation, never ticker alone.
// Rolling-window effects are separated from real source changes:
//  - an event that left because its date passed is EXPIRED, not REMOVED;
//  - an event that appears only because the 30-day horizon moved is ENTERED_WINDOW, not ADDED.
// Nothing is averaged or guessed: a changed date or amount is reported with both published values.
const HORIZON_DAYS=30,MATERIAL_AMOUNT_SHARE=0.01;
const norm=v=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim();
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):null;
const dayOf=iso=>{const t=Date.parse(iso||'');return Number.isFinite(t)?new Date(t).toISOString().slice(0,10):null;};
const plus=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function identity(e){return [e.projectId?'id:'+norm(e.projectId):'name:'+norm(e.name),norm(e.symbol),norm(e.allocation)].join('|');}
function amountOf(e){const m=/^\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kmb])?\b/i.exec(String(e.amount||''));if(!m)return null;const n=Number(m[1].replace(/,/g,''))*({k:1e3,m:1e6,b:1e9}[String(m[2]||'').toLowerCase()]||1);return Number.isFinite(n)?n:null;}
function index(events){const map=new Map(),dup=new Set();for(const e of events||[]){if(!day(e?.date))continue;const k=identity(e);if(map.has(k)){dup.add(k);continue;}map.set(k,e);}for(const k of dup)map.delete(k);return {map,ambiguous:dup.size};}
const view=e=>({name:e.name,symbol:e.symbol,allocation:e.allocation||'',date:e.date,amount:e.amount||'',verification:e.verification||null,sourceUrl:e.sourceUrl||null});
function diff(previous,current){
 if(!previous||!current||!Array.isArray(previous.events)||!Array.isArray(current.events))return null;
 const prevDay=dayOf(previous.generatedAt),curDay=dayOf(current.generatedAt);
 if(!prevDay||!curDay||curDay<prevDay)return null;
 const before=index(previous.events),after=index(current.events),prevHorizon=plus(prevDay,HORIZON_DAYS);
 const added=[],enteredWindow=[],removed=[],expired=[],rescheduled=[],amountChanged=[];
 for(const [k,e] of after.map){
  const old=before.map.get(k);
  if(!old){(e.date>prevHorizon?enteredWindow:added).push(view(e));continue;}
  if(old.date!==e.date)rescheduled.push({...view(e),previousDate:old.date});
  const a=amountOf(old),b=amountOf(e);
  if(a!==null&&b!==null&&a>0&&Math.abs(b-a)/a>MATERIAL_AMOUNT_SHARE)amountChanged.push({...view(e),previousAmount:old.amount});
 }
 for(const [k,e] of before.map)if(!after.map.has(k))(e.date<curDay?expired:removed).push(view(e));
 const counts={added:added.length,removed:removed.length,rescheduled:rescheduled.length,amountChanged:amountChanged.length,enteredWindow:enteredWindow.length,expired:expired.length};
 return {comparedWith:{generatedAt:previous.generatedAt,eventCount:previous.events.length},counts,
  material:counts.added+counts.removed+counts.rescheduled+counts.amountChanged,
  added,removed,rescheduled,amountChanged,enteredWindow:enteredWindow.length,expired:expired.length,ambiguousIdentities:before.ambiguous+after.ambiguous,
  basis:'Diff of two signature-verified editions from the same publisher(s). REMOVED/RESCHEDULED mean the publisher changed its listing, not that the issuer changed the schedule.'};
}
module.exports={diff,identity,amountOf};
