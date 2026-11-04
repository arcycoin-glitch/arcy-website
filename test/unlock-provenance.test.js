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
