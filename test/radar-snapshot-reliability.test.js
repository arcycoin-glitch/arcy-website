'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/radar-v2/v4-snapshot');
const {sections}=require('../scripts/probe-radar-intel.cjs');
const NOW=Date.parse('2026-11-27T12:00:00Z'),HOUR=3600000,NETS=['arc','ethereum','robinhood','pons'];
const at=t=>new Date(t).toISOString();
function input(times={}){
 const networks={},raw={};
 for(const n of NETS){const asOf=times[n]===undefined?at(NOW):times[n];
  networks[n]={source:{status:'OBSERVED',asOf},displayCandidates:[],all:[],display:{target:10,shortfall:{rankedEligible:0,shown:0}}};
  raw[n]={asOf,tokens:[]};
 }
 return {engine:{networks,riskLedger:[]},raw};
}
function snapshot(times={}){const f=input(times);return S.build(f.engine,f.raw,{now:NOW,commit:'engine-326'});}
const fetched=snapshot=>async()=>({ok:true,status:200,text:async()=>JSON.stringify(snapshot)});
const chainOf=url=>new URL(url).searchParams.get('chain');
const response=(chain,status=200,headers=null)=>({ok:status===200,status,headers:{get:()=>headers},json:async()=>({ok:true,network:chain})});

test('snapshot build keeps market asOf on all four networks and refuses unknown or future source clocks independently',()=>{
 for(const n of NETS){
  const old=at(NOW-8*HOUR),s=snapshot({[n]:old});
  assert.equal(s.generatedAt,at(NOW));assert.equal(s.sections[n].asOf,old);
  assert.equal(s.sections[n].sourceRadarAsOf,old);assert.equal(s.sections[n].status,'BUILT_FROM_STALE_SOURCE');
  assert.ok(NETS.filter(x=>x!==n).every(x=>s.sections[x].status==='BUILT'));
  for(const invalid of ['not-a-time',at(NOW+10*60000)]){
   const bad=snapshot({[n]:invalid});
   assert.equal(bad.sections[n].status,'NOT_BUILT');assert.equal(bad.sections[n].reason,'SOURCE_OBSERVATION_TIME_INVALID');
   assert.equal(bad.sections[n].asOf,null);assert.equal(S.validate(bad).ok,true);
   assert.equal(S.publishDecision(bad,{commit:'engine-326'}).mode,'SECTION_ISOLATED');
  }
 }
});

test('Pons expansion retains the original Robinhood row observation instead of a newer Pons section clock',()=>{
 const f=input(),old=at(NOW-9*HOUR),address='0x'+'11'.repeat(20);
 f.raw.robinhood.tokens=[{address,symbol:'P',priceUsd:1,liquidityUsd:50000,volume24hUsd:10000}];
 f.engine.networks.pons.displayCandidates=[{address,symbol:'P',radarAsOf:old,eligibility:'REVIEW',displayTier:'WATCHLIST_NOT_VERIFIED',
  category:{category:'EARLY_STAGE_CANDIDATE'},infoV4:'Observed Pons candidate',provenance:['RADAR_RANKED'],launch:{status:'ONCHAIN_VERIFIED'}}];
 const s=S.build(f.engine,f.raw,{now:NOW,commit:'engine-326'});
 assert.equal(s.sections.pons.rows[0].measuredAt,old);assert.equal(s.sections.pons.asOf,old);
 assert.equal(s.sections.pons.status,'BUILT_FROM_STALE_SOURCE');
 assert.equal(s.sections.robinhood.asOf,at(NOW));
});

test('stale input uses section-isolated publication, preserves true timestamps and never bypasses structural or shortfall gates',()=>{
 const old=at(NOW-8*HOUR),s=snapshot({arc:old});
 assert.equal(S.publishable(s,{commit:'engine-326'}).ok,false);
 assert.ok(S.publishable(s,{commit:'engine-326'}).problems.includes('arc:STALE_SOURCE'));
 const d=S.publishDecision(s,{commit:'engine-326'});
 assert.equal(d.ok,true);assert.equal(d.mode,'SECTION_ISOLATED');assert.deepEqual(d.fresh,['ethereum','robinhood','pons']);
 assert.ok(d.degraded.arc.includes('arc:STALE_SOURCE'));assert.equal(s.sections.arc.asOf,old);
 const short=structuredClone(s);delete short.sections.arc.display.shortfall;
 assert.equal(S.publishDecision(short,{commit:'engine-326'}).ok,false,'stale input cannot waive an unrecorded eligible shortfall');
 const wrong=structuredClone(s);wrong.sections.ethereum.asOf=at(NOW+10*60000);
 assert.equal(S.publishDecision(wrong,{commit:'engine-326'}).ok,false,'future observation is a structural blocker');
 assert.equal(S.publishDecision(s,{commit:'another-engine'}).ok,false);
 const all=snapshot(Object.fromEntries(NETS.map(n=>[n,old])));
 assert.ok(S.publishDecision(all,{commit:'engine-326'}).blocking.includes('NO_FRESH_SECTION'));
 const expired=snapshot({arc:at(NOW-25*HOUR)});
 assert.ok(S.publishDecision(expired,{commit:'engine-326'}).degraded.arc.includes('arc:SOURCE_BEYOND_24H_NOT_SERVED'));
});

test('mixed-age LKG preserves old observations and exposes failure while healthy new sections publish',()=>{
 const prior=snapshot(Object.fromEntries(NETS.map(n=>[n,at(NOW-8*HOUR)]))),fresh=snapshot();
 fresh.sections.pons={status:'NOT_BUILT',reason:'INVALID_SNAPSHOT',asOf:null,rows:[]};
 // A real same-engine shortfall of zero is a valid prior result; requireRankVersion remains covered by populated fixtures.
 const merged=S.merge(prior,fresh);
 assert.equal(merged.sections.pons.carriedForward,true);assert.equal(merged.sections.pons.asOf,at(NOW-8*HOUR));
 assert.equal(merged.sections.pons.buildFailure,'INVALID_SNAPSHOT');
 assert.equal(merged.sections.ethereum.asOf,at(NOW));
 const decision=S.publishDecision(merged,{commit:'engine-326'});
 assert.equal(decision.mode,'SECTION_ISOLATED');assert.deepEqual(decision.fresh,['arc','ethereum','robinhood']);
 assert.equal(S.validate(merged).ok,true);
});

test('serving ages the original market clock for every network, including snapshots written before truthful-asOf fix',async()=>{
 try{
  for(const n of NETS){
   for(const hours of [8,25]){
    const s=snapshot();s.sections[n].sourceRadarAsOf=at(NOW-hours*HOUR);
    S._reset();const r=await S.serve(n,{env:{RADAR_V4_OPPORTUNITY_ENABLED:'true'},fetcher:fetched(s),now:NOW});
    if(hours===8){assert.equal(r.data.freshness,'STALE');assert.equal(r.data.asOf,at(NOW-hours*HOUR));}
    else{assert.equal(r.data,null);assert.equal(r.reason,'SNAPSHOT_SECTION_EXPIRED');}
   }
  }
 }finally{S._reset();}
});

test('snapshot fetch outage preserves LKG but retries recovery after one minute instead of hiding failure for ten',async()=>{
 const old=snapshot(),updated=snapshot();updated.engineCommit='recovered';let calls=0;
 const fetcher=async()=>{calls++;return calls===2?{ok:false,status:503}:fetched(calls===1?old:updated)();};
 try{
  S._reset();assert.equal((await S.read({fetcher,env:{},now:NOW})).snapshot.engineCommit,'engine-326');
  const failed=await S.read({fetcher,env:{},now:NOW+600001});
  assert.equal(failed.snapshot.engineCommit,'engine-326');assert.equal(failed.reason,'SNAPSHOT_HTTP_503');
  await S.read({fetcher,env:{},now:NOW+630001});assert.equal(calls,2);
  const recovered=await S.read({fetcher,env:{},now:NOW+660002});
  assert.equal(calls,3);assert.equal(recovered.snapshot.engineCommit,'recovered');assert.equal(recovered.reason,null);
 }finally{S._reset();}
});

test('Arc and Ethereum intake progresses independently while a Robinhood request hangs; Pons shares a sequential 4663 lane',async()=>{
 const completed=[],started=[];let release;
 const held=new Promise(r=>{release=r;});
 const pending=sections(async url=>{const n=chainOf(url);started.push(n);if(n==='robinhood')await held;completed.push(n);return response(n);},{attempts:[1000],pauseMs:0});
 try{
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(completed,['arc','ethereum']);assert.ok(!started.includes('pons'));
 }finally{release();}
 const s=await pending;assert.ok(NETS.every(n=>s.out[n].ok===true));assert.deepEqual(Object.keys(s.out),NETS);
});

test('transient intake responses honor Retry-After and exponential backoff without retrying deterministic 403',async()=>{
 const counts={},delays=[];
 const s=await sections(async url=>{const n=chainOf(url),i=counts[n]=(counts[n]||0)+1;
  if(n==='robinhood'&&i===1)return response(n,429,'2');
  if(n==='robinhood'&&i===2)return response(n,503);
  if(n==='pons')return response(n,403);
  return response(n);
 },{attempts:[100,100,100],pauseMs:5,sleep:async ms=>{delays.push(ms);}});
 assert.equal(counts.robinhood,3);assert.equal(s.out.robinhood.ok,true);assert.deepEqual(delays,[2000,10]);
 assert.equal(counts.pons,1);assert.equal(s.out.pons.http,403);
 assert.equal(s.timing.robinhood.attempts.length,3);
});

test('oversized Retry-After defers that network rather than retrying before the provider permits',async()=>{
 const counts={};
 const s=await sections(async url=>{const n=chainOf(url);counts[n]=(counts[n]||0)+1;return n==='robinhood'?response(n,429,'120'):response(n);},
  {attempts:[100,100,100],pauseMs:0,sleep:async()=>{throw Error('must not wait/retry');}});
 assert.equal(counts.robinhood,1);assert.equal(s.out.robinhood.ok,false);
 assert.equal(s.timing.robinhood.attempts[0].retryDeferred,'RETRY_AFTER_EXCEEDS_BUDGET');
 assert.ok(['arc','ethereum','pons'].every(n=>s.out[n].ok));
});

test('watchdog bounds a fetcher ignoring abort and circular V4 input is refused per section',async()=>{
 const counts={};
 const s=await sections(async url=>{const n=chainOf(url);counts[n]=(counts[n]||0)+1;
  if(n==='robinhood')return new Promise(()=>{});
  if(n==='pons')return {...response(n),json:async()=>({ok:true,network:n,opportunity:{servedList:'V4_OPPORTUNITY'}})};
  return response(n);
 },{attempts:[2,2,2],pauseMs:0});
 assert.equal(counts.robinhood,3);assert.equal(s.out.robinhood.ok,false);
 assert.equal(s.timing.robinhood.attempts.length,3);assert.equal(s.timing.robinhood.error,'TimeoutError');
 assert.equal(s.out.pons.reason,'CIRCULAR_V4_INPUT_REFUSED');assert.ok(s.out.arc.ok&&s.out.ethereum.ok);
});
