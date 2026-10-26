'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),w=require('../search/server/lib/unlock-windows');
const address='0x'+'a'.repeat(40),now=Date.parse('2026-10-27T12:00:00Z');
const event=(date,amount='1')=>({chainId:1,contract:address,date,amount,sourceUrl:'https://issuer.example/schedule',status:'SOURCE_REPORTED'});
test('published unlock windows use UTC calendar boundaries and exact decimal sums, never transfer history',()=>{
 const r=w.windows({network:'ethereum',address,now,events:[event('2026-10-27T01:00:00Z','0.1'),event('2026-10-27T18:00:00Z','0.2'),event('2026-11-02T23:59:59Z','10'),event('2026-11-03T00:00:00Z','20')]});
 assert.equal(r.today.value.knownScheduledAmount,'0.3');assert.equal(r.days7.value.knownScheduledAmount,'10.3');assert.equal(r.days30.value.knownScheduledAmount,'30.3');assert.equal(r.days7.window.end,'2026-11-03T00:00:00.000Z');assert.equal(r.today.status,'SOURCE_REPORTED');assert.match(r.today.scope,/not proof of executed/);
});
test('empty/partial coverage is unknown, never a verified zero or invented schedule',()=>{
 const r=w.windows({network:'ethereum',address,now,events:[]});for(const k of ['today','days7','days30']){assert.equal(r[k].value,null);assert.equal(r[k].dataState,'NOT_VERIFIED');assert.equal(r[k].coverage,'KNOWN_PUBLISHED_EVENTS_ONLY');}
});
test('token/chain mismatches, unsupported claims, invalid dates and credentialed source URLs are rejected',()=>{
 const e=event('2026-10-28T00:00:00Z');const invalid=[{...e,chainId:4663},{...e,contract:'0x'+'b'.repeat(40)},{...e,status:'CLAIM'},{...e,date:'2026-02-31T00:00:00Z'},{...e,amount:'1e9'},{...e,sourceUrl:'https://secret:token@issuer.example'}];const r=w.windows({network:'ethereum',address,now,events:invalid});assert.equal(r.days30.value,null);assert.equal(r.rejected.length,invalid.length);
});
test('duplicate published events are not double-counted; conflicting amounts are not selected arbitrarily',()=>{
 const e=event('2026-10-28T00:00:00Z','10');let r=w.windows({network:'ethereum',address,now,events:[e,{...e,amount:'10.0'}]});assert.equal(r.days7.value.eventCount,1);assert.equal(r.days7.value.knownScheduledAmount,'10');r=w.windows({network:'ethereum',address,now,events:[e,{...e,amount:'11'}]});assert.equal(r.days7.value,null);assert.deepEqual(r.rejected,['CONFLICTING_PUBLISHED_EVENT']);
});
test('unknown next events retain their original state; valid schedule evidence receives source-scoped windows only',()=>{
 const missing={value:null,dataState:'NOT_VERIFIED'};assert.equal(w.attach(missing,{network:'ethereum',address}),missing);const f={value:'2026-10-28T00:00:00Z',dataState:'DATA_FOUND',evidence:[{sourceUrl:'https://issuer.example/schedule',eventAmount:'25'}]};const result=w.attach(f,{network:'ethereum',address,now});assert.equal(result.value,f.value);assert.equal(result.evidence[0].knownScheduleWindows.days7.value.knownScheduledAmount,'25');assert.equal(result.evidence[0].knownScheduleWindows.today.value,null);
});
