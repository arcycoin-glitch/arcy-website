'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const F=require('../scripts/radar-snapshot-freshness.cjs');
const now=Date.parse('2026-11-27T12:00:00Z'),ago=m=>new Date(now-m*60000).toISOString();
test('fresh publication retains two-hour cadence while an old section stays explicitly critical',()=>{
 const sections=Object.fromEntries(['arc','ethereum','robinhood','pons'].map(n=>[n,{asOf:ago(n==='pons'?720:15),sourceRadarAsOf:ago(n==='pons'?721:18),carriedForward:n==='pons'}]));
 const result=F.snapshotDecision({generatedAt:ago(15),sections},{now});
 assert.equal(result.build,false);assert.equal(result.ageMin,15);assert.equal(result.oldestSectionAgeMin,721);
 assert.equal(result.level,'CRITICAL');assert.deepEqual(result.degradedSections,{pons:'CRITICAL'});
 assert.equal(result.sectionFreshness.pons.carriedForward,true);
 const due=F.snapshotDecision({generatedAt:ago(120),sections},{now});assert.equal(due.build,true);
});
test('future or malformed publication and source timestamps never masquerade as fresh',()=>{
 assert.equal(F.decide({generatedAt:ago(-5),now}).level,'UNKNOWN');
 assert.equal(F.decide({generatedAt:ago(-5),now}).build,true);
 const result=F.snapshotDecision({generatedAt:ago(10),sections:{arc:{asOf:'invalid'},pons:{asOf:ago(10),sourceRadarAsOf:ago(-5)}}},{now});
 assert.equal(result.sectionFreshness.arc.level,'UNKNOWN');assert.equal(result.sectionFreshness.pons.level,'UNKNOWN');
});
test('snapshot freshness watchdog covers a hanging response body and HTTP failures',async()=>{
 await assert.rejects(F.readSnapshot('https://example.test',{timeoutMs:15,fetcher:async()=>({ok:true,text:()=>new Promise(()=>{})})}),e=>e.code==='SNAPSHOT_TIMEOUT');
 await assert.rejects(F.readSnapshot('https://example.test',{fetcher:async()=>({ok:false,status:503})}),e=>e.code==='HTTP_503');
 let cancelled=false;
 await assert.rejects(F.readSnapshot('https://example.test',{fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3000001));},cancel(){cancelled=true;}}))}),e=>e.code==='SNAPSHOT_TOO_LARGE');
 assert.equal(cancelled,true,'oversized snapshot stream is not retained');
});
test('serialized scheduler dispatch has an opt-in server freshness gate and preview stays the default',()=>{
 const workflow=fs.readFileSync(require('node:path').join(__dirname,'../.github/workflows/radar-v4-snapshot.yml'),'utf8');
 assert.match(workflow,/only_if_due:[\s\S]*?type: boolean[\s\S]*?default: false/);
 assert.match(workflow,/inputs\.target == 'production' && inputs\.only_if_due && 'schedule'/);
 assert.match(workflow,/default: preview/);assert.match(workflow,/cancel-in-progress: false/);
});
