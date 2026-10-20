const test=require('node:test'),assert=require('node:assert/strict'),ui=require('../ui-model'),summary=require('../lib/contract-summary'),c=require('../lib/core');
const proof=[{source:'Exact reviewed contract',address:'0x'+'a'.repeat(40),block:'0x123'}],fact=(value,status='ON_CHAIN')=>c.fact(value,proof,status);
function data(){return {ok:true,...summary.present({buyTax:fact(0),sellTax:fact(0),transferTax:fact(0),mint:fact(false,'NOT_DETECTED'),ownerAbsence:fact(false,'NOT_DETECTED'),proxy:fact(false,'NOT_DETECTED'),pause:c.unknown(),buybackAndBurn:c.unknown()})};}
test('Mechanics presents proven absence and non-proxy as successful verified analysis while retaining deeper unknowns',()=>{const d=data(),v=ui.summarize('mechanics',d);assert.deepEqual(v.fields.map(f=>f.text),['Buy 0% · Sell 0% · Transfer 0% · VERIFIED','NONE DETECTED ✓','NONE DETECTED ✓','NON-PROXY · VERIFIED']);assert.equal(v.badge,'VERIFIED');assert.ok(v.fields.every(f=>f.verifiedPresentation));assert.equal(v.data.contractFields.pause.status,'NOT_VERIFIED');});
test('Mechanics absence cannot be manufactured from unknown, evidence-free or inconsistent false values',()=>{for(const raw of [{value:null,status:'NOT_VERIFIED'},{value:false,status:'NOT_DETECTED',dataState:'DATA_FOUND',evidence:[]},{value:true,status:'NOT_DETECTED',dataState:'DATA_FOUND',evidence:proof},{value:false,status:'VERIFIED',dataState:'DATA_FOUND',evidence:proof}]){const d=data();d.contractFields.mint=raw;const v=ui.summarize('mechanics',d);assert.equal(v.fields[1].text,'NOT VERIFIED');assert.notEqual(v.badge,'VERIFIED');assert.ok(!v.fields[1].verifiedPresentation);}});
test('Mechanics partial taxes stay partial and historical proof retains its freshness badge',()=>{const d=data();d.contractFields.sellTax=c.unknown();let v=ui.summarize('mechanics',d);assert.equal(v.badge,'PARTIAL EVIDENCE');assert.ok(!v.fields[0].verifiedPresentation);assert.match(v.fields[0].text,/Sell NOT VERIFIED/);const warm=data();warm.contractFields.mint.freshness={state:'LAST_VERIFIED',observedAt:'2026-10-01'};v=ui.summarize('mechanics',warm);assert.equal(v.badge,'LAST VERIFIED DATA');assert.equal(v.fields[1].freshness.state,'LAST_VERIFIED');});

test('Mechanics card is hidden when architecture is the only verified row',()=>{
 const d=data();for(const key of ['buyTax','sellTax','transferTax','mint','ownerAdmin'])d.contractFields[key]=c.unknown();
 const view=ui.summarize('mechanics',d);
 assert.equal(view.fields[3].verifiedPresentation,true);
 assert.equal(view.fields.filter(f=>f.verifiedPresentation).length,1);
 assert.equal(ui.mechanicsVisibility(view),false);
});
test('Mechanics card appears with complete verified taxes or two verified capability rows',()=>{
 const full=data();assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',full)),true);
 const taxes=data();for(const key of ['mint','ownerAdmin','proxyUpgradeable'])taxes.contractFields[key]=c.unknown();
 assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',taxes)),true);
 const capabilities=data();for(const key of ['buyTax','sellTax','transferTax','proxyUpgradeable'])capabilities.contractFields[key]=c.unknown();
 assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',capabilities)),true);
 const one=data();for(const key of ['buyTax','sellTax','transferTax','mint','proxyUpgradeable'])one.contractFields[key]=c.unknown();
 assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',one)),false);
});
test('Mechanics card remains hidden on missing evidence and failed data',()=>{
 assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',{ok:false,dataState:'SOURCE_API_FAILED'})),false);
 assert.equal(ui.mechanicsVisibility(ui.summarize('mechanics',undefined)),false);
});
