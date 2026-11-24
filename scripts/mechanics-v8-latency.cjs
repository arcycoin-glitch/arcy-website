'use strict';
// The paired V8 benchmark can read bounded live evidence not present in the V7 recording.
// Never describe such augmentation as pure recorded-response execution latency.
const key=r=>[r.chain||r.network,String(r.address||'').toLowerCase(),r.group||''].join('|');
const percentile=(values,q)=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.max(0,Math.ceil(sorted.length*q)-1)];
};
function augmentCount(row){
 return Object.entries(row.net||{}).reduce((n,[key,value])=>
  n+(/^aug[A-Z]/.test(key)&&Number.isFinite(value)?Math.max(0,value):0),0);
}
function timings(pairs){
 const ms=kind=>pairs.map(x=>x[kind].ms).filter(n=>Number.isFinite(n)&&n>=0);
 return {subjects:pairs.length,before:{p50Ms:percentile(ms('before'),.5),p95Ms:percentile(ms('before'),.95)},
  after:{p50Ms:percentile(ms('after'),.5),p95Ms:percentile(ms('after'),.95)}};
}
function compareLatency(before,after){
 const base=new Map();
 for(const row of before.rows||[]){
  const id=key(row);if(base.has(id))throw Error('Duplicate baseline row '+id);base.set(id,row);
 }
 const paired=[];
 for(const row of after.rows||[]){
  const old=base.get(key(row));if(!old||old.block!==row.block)continue;
  paired.push({before:old,after:row,extraRequests:augmentCount(row)});
 }
 const augmented=paired.filter(x=>x.extraRequests>0),recorded=paired.filter(x=>x.extraRequests===0);
 const outliers=[...augmented].sort((a,b)=>b.after.ms-a.after.ms).slice(0,12).map(x=>({
  network:x.after.chain||x.after.network,address:x.after.address,group:x.after.group||null,block:x.after.block,
  beforeMs:x.before.ms,afterMs:x.after.ms,additionalRequests:x.extraRequests
 }));
 return {
  measurementClass:augmented.length?'MIXED_REPLAY_WITH_LIVE_AUGMENTATION':'RECORDED_RESPONSE_REPLAY',
  warning:augmented.length?'Overall replay latency includes additional evidence requests; it is not a pure replay timing comparison.':null,
  pairedSubjects:paired.length,augmentationAffected:augmented.length,
  additionalRequests:augmented.reduce((n,x)=>n+x.extraRequests,0),
  overall:timings(paired),recordedOnly:timings(recorded),augmentedOnly:timings(augmented),
  byNetwork:Object.fromEntries([...new Set(paired.map(x=>x.after.chain||x.after.network))].map(network=>{
   const group=paired.filter(x=>(x.after.chain||x.after.network)===network);
   return [network,{overall:timings(group),recordedOnly:timings(group.filter(x=>!x.extraRequests)),
    augmentedOnly:timings(group.filter(x=>x.extraRequests))}];
  })),augmentedOutliers:outliers};
}
module.exports={compareLatency,augmentCount,percentile};
