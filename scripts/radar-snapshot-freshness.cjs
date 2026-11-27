#!/usr/bin/env node
'use strict';
// Radar snapshot freshness: decides whether a scheduled run needs to build, and raises an explicit alert when the published
// Production snapshot is stale. Root cause it compensates for: GitHub drops most scheduled triggers of this repository
// (a `41 */2` cron ran ~2x/day), so the cron is now frequent and THIS check skips runs while the snapshot is still fresh.
// It never changes the engine, the snapshot, or what the site serves. Exit code is always 0 (the workflow reads outputs).
const TARGET_MIN=120;   // intended Production cadence
const SKIP_UNDER_MIN=100;  // a scheduled run inside this age does nothing (keeps provider usage at the 2-hour cadence)
const STALE_MIN=180;    // past this age the snapshot is flagged STALE: explicit warning annotation + issue
const CRITICAL_MIN=360; // the serving layer's FRESH limit (6 h): beyond this the site shows STALE data
function decide({generatedAt,now=Date.now(),event='schedule'}){
 const t=Date.parse(generatedAt||'');
 const ageMin=Number.isFinite(t)&&t<=now+60000?Math.max(0,Math.round((now-t)/60000)):null;
 const level=ageMin===null?'UNKNOWN':ageMin>=CRITICAL_MIN?'CRITICAL':ageMin>=STALE_MIN?'STALE':'FRESH';
 // only cron runs may be skipped; push / manual / pull_request always build
 const build=event!=='schedule'||ageMin===null||ageMin>=SKIP_UNDER_MIN;
 return {ageMin,level,build,reason:event!=='schedule'?'NON_SCHEDULED_EVENT':ageMin===null?'NO_READABLE_SNAPSHOT':build?'DUE':'FRESH_SKIP',
  thresholds:{targetMin:TARGET_MIN,skipUnderMin:SKIP_UNDER_MIN,staleMin:STALE_MIN,criticalMin:CRITICAL_MIN}};
}
function snapshotDecision(snapshot,{now=Date.now(),event='schedule'}={}){
 const decision=decide({generatedAt:snapshot?.generatedAt,now,event}),sectionFreshness={},degradedSections={};
 const rank={FRESH:0,STALE:1,CRITICAL:2,UNKNOWN:3};let level=decision.level;
 if(snapshot?.sections&&typeof snapshot.sections==='object')for(const name of ['arc','ethereum','robinhood','pons']){
  const section=snapshot.sections[name],times=[section?.asOf,section?.sourceRadarAsOf].filter(x=>typeof x==='string');
  const valid=times.length>0&&times.every(x=>Number.isFinite(Date.parse(x))&&Date.parse(x)<=now+60000);
  const observedAt=valid?new Date(Math.min(...times.map(Date.parse))).toISOString():null;
  const age=decide({generatedAt:observedAt,now,event});
  sectionFreshness[name]={observedAt,ageMin:age.ageMin,level:age.level,carriedForward:Boolean(section?.carriedForward)};
  if(age.level!=='FRESH')degradedSections[name]=age.level;
  if(rank[age.level]>rank[level])level=age.level;
 }
 // Fresh healthy sections prove that a rebuild was recently attempted. Surface
 // the older section clocks, while retaining the global two-hour work budget.
 return {...decision,level,sectionFreshness,degradedSections,
  oldestSectionAgeMin:Object.values(sectionFreshness).reduce((oldest,x)=>x.ageMin===null?oldest:Math.max(oldest??0,x.ageMin),null)};
}
async function readSnapshot(url,{fetcher=global.fetch,timeoutMs=20000}={}){
 const controller=new AbortController();let timer,response;
 try{return await Promise.race([(async()=>{
  response=await fetcher(url,{headers:{accept:'application/json','cache-control':'no-cache'},redirect:'error',signal:controller.signal});
  if(!response.ok)throw Object.assign(Error('SNAPSHOT_HTTP'),{code:'HTTP_'+response.status});
  const text=await response.text();if(Buffer.byteLength(text)>3000000)throw Object.assign(Error('SNAPSHOT_SIZE'),{code:'SNAPSHOT_TOO_LARGE'});
  return JSON.parse(text);
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();Promise.resolve().then(()=>response?.body?.cancel?.()).catch(()=>{});reject(Object.assign(Error('SNAPSHOT_TIMEOUT'),{code:'SNAPSHOT_TIMEOUT'}));},timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
async function main(){
 const url=process.env.SNAPSHOT_URL;
 let snapshot=null,error=null;
 try{snapshot=await readSnapshot(url);}
 catch(e){error=e?.code||e?.name||'FETCH_FAILED';}
 const generatedAt=snapshot?.generatedAt||null,d=snapshotDecision(snapshot,{event:process.env.EVENT_NAME||'schedule'});
 const line=JSON.stringify({...d,generatedAt,error});
 console.log(line);
 if(d.level==='STALE'||d.level==='CRITICAL'||d.level==='UNKNOWN')
  console.log('::warning title=Radar snapshot '+d.level+'::Production Radar publication age '+(d.ageMin??'unknown')+' min; oldest observed section '+(d.oldestSectionAgeMin??'unknown')+' min; degraded sections '+JSON.stringify(d.degradedSections)+' (generatedAt '+(generatedAt||'unreadable')+(error?', '+error:'')+'). Expected cadence '+TARGET_MIN+' min.');
 const out=process.env.GITHUB_OUTPUT;
 if(out)require('node:fs').appendFileSync(out,'build='+d.build+'\nlevel='+d.level+'\nage_min='+(d.ageMin??'')+'\noldest_section_age_min='+(d.oldestSectionAgeMin??'')+'\nsection_levels='+JSON.stringify(d.degradedSections)+'\nreason='+d.reason+'\n');
}
if(require.main===module)main();
module.exports={decide,snapshotDecision,readSnapshot,TARGET_MIN,SKIP_UNDER_MIN,STALE_MIN,CRITICAL_MIN};
