'use strict';
// Additive Unlocks provenance: one publisher's several sort orders are one source; calendars never prove execution.
const {test}=require('node:test'),assert=require('node:assert/strict');
const cal=require('../lib/unlock-calendar');
const row=(sort,extra={})=>({name:'Example',symbol:'EXM',date:'2026-11-10',amount:'1.5M EXM',percent:'1.2%',value:'$1M',allocation:'Team',source:'CoinBell / DefiLlama',sourceUrl:`https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`,verification:'source-published',evidence:[{url:`https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`,kind:'published-calendar',checkedAt:'2026-11-04T00:00:00.000Z'}],...extra});

test('three sort endpoints of one publisher merge into one event counted as ONE independent publisher',()=>{
 const {events,conflicts}=cal.mergeEvents([row('soonest'),row('impact'),row('value')]);
 assert.equal(conflicts.length,0);assert.equal(events.length,1);
 const e=events[0];
 assert.equal(e.evidenceCategory,'THIRD_PARTY_CALENDAR');assert.equal(e.independentPublishers,1);assert.deepEqual(e.publishers,['coinbell.in']);
 assert.equal(e.identityBasis,'NAME_AND_TICKER_ONLY');assert.equal(e.executionStatus,'NOT_CHECKED_ONCHAIN');
 // Existing fields are preserved exactly.
 for(const k of ['name','symbol','date','amount','percent','value','allocation','source','sourceUrl','verification'])assert.equal(e[k],row('soonest')[k]);
 assert.equal(e.evidence.length,3,'existing evidence list unchanged');
});

test('amount conflicts are labelled CONFLICTING_SOURCES with the real publisher count',()=>{
 const {events,conflicts}=cal.mergeEvents([row('soonest'),row('impact',{amount:'1.6M EXM'})]);
 assert.equal(events.length,0);assert.equal(conflicts[0].reason,'Conflicting published amounts');
 assert.equal(conflicts[0].evidenceCategory,'CONFLICTING_SOURCES');assert.equal(conflicts[0].independentPublishers,1);
});

test('a reviewed project-confirmed schedule is PROJECT_SCHEDULE_CONFIRMED, still not on-chain execution',()=>{
 const p=cal.provenance({verification:'project-confirmed',tokenVersion:'v1',sourceUrl:'https://docs.example.org/unlocks',evidence:[{url:'https://docs.example.org/unlocks'}]});
 assert.equal(p.evidenceCategory,'PROJECT_SCHEDULE_CONFIRMED');assert.equal(p.identityBasis,'PROJECT_ID_AND_TOKEN_VERSION');
 assert.equal(p.executionStatus,'NOT_CHECKED_ONCHAIN');assert.equal(p.independentPublishers,1);
});

test('malformed evidence URLs never inflate the publisher count',()=>{
 assert.deepEqual(cal.publishers(['not a url','https://www.example.com/a','https://example.com/b',undefined]),['example.com']);
});

const confirmed=(extra={})=>({name:'Example',symbol:'EXM',projectId:'example',tokenVersion:'v1',date:'2026-11-10',amount:'1500000 EXM',percent:'',value:'',allocation:'Team',source:'Example official schedule',sourceUrl:'https://docs.example.org/unlocks',verification:'project-confirmed',evidence:[{url:'https://docs.example.org/unlocks',kind:'explicit-event'}],...extra});

test('a project-confirmed event and the same calendar row are ONE event; the calendar becomes a second publisher',()=>{
 const {events,conflicts}=cal.mergeEvents([row('soonest'),row('impact'),confirmed()]);
 assert.equal(events.length,1,'no duplicate row in the table');assert.equal(conflicts.length,0);
 const e=events[0];
 assert.equal(e.verification,'project-confirmed');assert.equal(e.evidenceCategory,'PROJECT_SCHEDULE_CONFIRMED');
 assert.equal(e.independentPublishers,2);assert.deepEqual(e.publishers.sort(),['coinbell.in','docs.example.org']);
 assert.equal(e.amount,'1500000 EXM','primary-source amount is displayed');assert.equal(e.executionStatus,'NOT_CHECKED_ONCHAIN');
 assert.ok(e.evidence.some(x=>x.kind==='corroborating-calendar'));
});

test('a calendar amount that differs from the confirmed schedule is recorded as a conflict, never shown as a second event',()=>{
 const {events,conflicts}=cal.mergeEvents([row('soonest',{amount:'1.8M EXM'}),confirmed()]);
 assert.equal(events.length,1);assert.equal(events[0].verification,'project-confirmed');
 assert.equal(conflicts.length,1);assert.equal(conflicts[0].evidenceCategory,'CONFLICTING_SOURCES');
 assert.equal(conflicts[0].calendarAmount,'1.8M EXM');assert.equal(conflicts[0].confirmedAmount,'1500000 EXM');
});

test('rounding is judged by the calendar display precision only',()=>{
 assert.equal(cal.sameAmount('92.65M ARB','92650000 ARB'),true);
 assert.equal(cal.sameAmount('92.65M ARB','92654999 ARB'),true,'within ±0.005M display rounding');
 assert.equal(cal.sameAmount('92.65M ARB','92660000 ARB'),false);
 assert.equal(cal.sameAmount('1,500,000 EXM','1500000 EXM'),true);
 assert.equal(cal.sameAmount('garbage','1500000 EXM'),false);
});

test('other tokens, other dates and a different-allocation tranche on the same day are left untouched',()=>{
 const other=row('soonest',{symbol:'OTH',name:'Other',amount:'1.5M OTH'}),later=row('soonest',{date:'2026-11-11'});
 const tranche=row('value',{allocation:'Investors',amount:'3M EXM'});
 const {events}=cal.mergeEvents([other,later,row('soonest'),tranche,confirmed()]);
 assert.equal(events.length,4,'only the duplicate Team row is merged');
 assert.ok(events.some(e=>e.allocation==='Investors'&&e.verification==='source-published'));
});

test('without project-confirmed supplements the output is identical to before',()=>{
 const rows=[row('soonest'),row('impact'),row('soonest',{symbol:'OTH',name:'Other',amount:'2M OTH'})];
 const a=cal.mergeEvents(rows);assert.equal(a.events.length,2);assert.ok(a.events.every(e=>e.verification==='source-published'));
});

test('guard: the protected Vercel fallback (api/unlocks.js) cannot show a confirmed/calendar duplicate while no supplement is registered',async()=>{
 // api/unlocks.js is a protected file (test/fixtures/approved-baseline.json). Its live-collection fallback has no
 // reconcileConfirmed step; the worker edition (lib/unlock-calendar.js) does. Registering a VERIFIED_EVENTS supplement
 // must therefore come with an approved baseline refresh that ports reconcileConfirmed into api/unlocks.js.
 const cjs=require('../lib/unlock-evidence.cjs'),esm=await import('../lib/unlock-evidence.js');
 assert.equal(cjs.VERIFIED_EVENTS.length,0,'port reconcileConfirmed into api/unlocks.js before registering supplements');
 assert.equal(esm.VERIFIED_EVENTS.length,0,'port reconcileConfirmed into api/unlocks.js before registering supplements');
});
