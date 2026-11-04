'use strict';
// Arc Pulse cards: what changed / why it matters / main uncertainty / dated source, without generic filler.
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/pulse-claim');
const at='2026-11-02T09:00:00.000Z';
const cases=[
 ['Arc testnet adds faster finality for USDC transfers','TESTNET',/not prove a mainnet launch/],
 ['Roadmap: native FX swaps coming soon to Arc','PLANNED',/Not shipped/],
 ['Acme Pay partners with Arc for stablecoin payouts','PARTNERSHIP',/not proof of users or volume/],
 ['Arc mainnet launches with USDC as native gas','RELEASE',/not independently verified/],
 ['Notes from the Arc community call','ANNOUNCEMENT',/not independently measured/]
];
test('claim types separate testnet, plans, partnerships, releases and plain updates',()=>{
 for(const [title,type,risk] of cases){const d=C.describe({title,publishedAt:at,owner:'OFFICIAL ARC'},{type:'arc-blog',family:'Official Arc blog'});
  assert.equal(d.claimType,type,title);assert.match(d.uncertainty,risk);
  assert.match(d.summary,/ · 2026-11-02\. /,'dated');assert.ok(d.summary.length<=190,'one short line: '+d.summary.length);
  assert.doesNotMatch(d.summary,/strongest verified|worth watching/i,'no generic filler');}
});
test('a testnet or planned item is never labelled a release even if it mentions launch',()=>{
 assert.equal(C.classify({title:'Testnet launch of the Arc bridge'}).claimType,'TESTNET');
 assert.equal(C.classify({title:'Arc will launch mainnet payments next quarter'}).claimType,'PLANNED');
});
test('independent research and developer articles are classified from the source family, not the headline',()=>{
 assert.equal(C.classify({title:'Arc blockchain: first month',type:'research-article',family:'Bitquery original on-chain Arc investigation'}).claimType,'INDEPENDENT_RESEARCH');
 assert.equal(C.classify({title:'Fast Gateway Deposits and CCTP developer update',type:'research-article',family:'Arc House Circle developer release'}).claimType,'DEVELOPER_UPDATE');
});
test('missing or invalid dates are omitted rather than guessed',()=>{
 assert.doesNotMatch(C.describe({title:'Arc update',publishedAt:'not a date'}).summary,/\d{4}-\d{2}-\d{2}/);
});
test('both Pulse editions use the classifier instead of fixed generic summaries',()=>{
 const fs=require('node:fs');
 for(const f of ['lib/pulse-edition.js','search/server/lib/pulse-edition.js']){const s=fs.readFileSync(require('node:path').join(__dirname,'..',f),'utf8');
  assert.match(s,/pulse-claim'\)\.describe\(item/);assert.doesNotMatch(s,/The strongest verified Arc development from the current cycle/);}
});
