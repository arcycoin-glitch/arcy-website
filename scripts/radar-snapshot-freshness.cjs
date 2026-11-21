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
 const ageMin=Number.isFinite(t)?Math.max(0,Math.round((now-t)/60000)):null;
 const level=ageMin===null?'UNKNOWN':ageMin>=CRITICAL_MIN?'CRITICAL':ageMin>=STALE_MIN?'STALE':'FRESH';
 // only cron runs may be skipped; push / manual / pull_request always build
 const build=event!=='schedule'||ageMin===null||ageMin>=SKIP_UNDER_MIN;
 return {ageMin,level,build,reason:event!=='schedule'?'NON_SCHEDULED_EVENT':ageMin===null?'NO_READABLE_SNAPSHOT':build?'DUE':'FRESH_SKIP',
  thresholds:{targetMin:TARGET_MIN,skipUnderMin:SKIP_UNDER_MIN,staleMin:STALE_MIN,criticalMin:CRITICAL_MIN}};
}
async function main(){
 const url=process.env.SNAPSHOT_URL;
 let generatedAt=null,error=null;
 try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(r.ok)generatedAt=(await r.json()).generatedAt||null;else error='HTTP_'+r.status;}
 catch(e){error=e?.name||'FETCH_FAILED';}
 const d=decide({generatedAt,event:process.env.EVENT_NAME||'schedule'});
 const line=JSON.stringify({...d,generatedAt,error});
 console.log(line);
 if(d.level==='STALE'||d.level==='CRITICAL'||d.level==='UNKNOWN')
  console.log('::warning title=Radar snapshot '+d.level+'::Production Radar snapshot age '+(d.ageMin??'unknown')+' min (generatedAt '+(generatedAt||'unreadable')+(error?', '+error:'')+'). Expected cadence '+TARGET_MIN+' min.');
 const out=process.env.GITHUB_OUTPUT;
 if(out)require('node:fs').appendFileSync(out,'build='+d.build+'\nlevel='+d.level+'\nage_min='+(d.ageMin??'')+'\nreason='+d.reason+'\n');
}
if(require.main===module)main();
module.exports={decide,TARGET_MIN,SKIP_UNDER_MIN,STALE_MIN,CRITICAL_MIN};
