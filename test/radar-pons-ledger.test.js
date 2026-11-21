'use strict';
// Pons launch ledger: an on-chain-verified factory launch stays a Pons launch across runs (Pons priority over Robinhood).
const test=require('node:test'),assert=require('node:assert/strict');
const {seedLedger}=require('../lib/radar-v2/pons-ledger');
const E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot');
const NOW=Date.parse('2026-11-21T00:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0'),F='0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';

test('PL-1: seed only from on-chain verified launches with an exact factory; never from symbols or unverified rows',()=>{
 const docs=[{generatedAt:'2026-11-20T16:23:40Z',sections:{pons:{rows:[{address:A(1),symbol:'ZZZ',launch:{status:'ONCHAIN_VERIFIED',factory:F}},{address:A(2),symbol:'NOPE',launch:{status:'NOT_VERIFIED'}},{address:A(3),symbol:'NOF',launch:{status:'ONCHAIN_VERIFIED'}}]}}},
  {generatedAt:'2026-11-20T20:47:20Z',ponsLaunchLedger:[{address:A(4),factory:F,verifiedAt:'2026-11-19T00:00:00Z'},{address:'bad',factory:F,verifiedAt:'2026-11-19T00:00:00Z'},{address:A(5),factory:F}],sections:{pons:{rows:[]}}},null,{}];
 const l=seedLedger(docs);
 assert.deepEqual(l.map(x=>x.address).sort(),[A(1),A(4)].sort());
 assert.equal(l.find(x=>x.address===A(1)).verifiedAt,'2026-11-20T16:23:40Z');
});

const row=(n,o={})=>({address:A(n),chainId:4663,symbol:'R'+n,name:'R'+n,priceUsd:0.2,liquidityUsd:90000,volume24hUsd:60000,change24hPct:-4,officialLinks:{websites:['https://r'+n+'.example'],socials:[]},...o});
const sec=(net,tokens)=>({ok:true,network:net,chainId:4663,asOf:new Date(NOW).toISOString(),freshness:'FRESH',tokens});
const run=(sections,limits)=>E.run({sections,now:NOW,env:{},fetcher:async()=>{throw new Error('x');},limits:{customFilter:true,exit:false,pace:false,crossCheck:false,universe:false,...limits}});

test('PL-2: a ledger launch the RPC budget did not reach (ZZZ-like) moves to Pons and never stays in Robinhood',async()=>{
 const asked=[];
 const res=await run({pons:sec('pons',[row(10,{launch:{status:'ONCHAIN_VERIFIED',factory:F}})]),robinhood:sec('robinhood',[row(1),row(20),row(21)])},
  {ponsLaunchLedger:[{address:A(1),factory:F,verifiedAt:'2026-11-20T16:23:40Z'}],ponsMembership:async a=>{asked.push(...a);return new Map();}});
 assert.equal(asked.includes(A(1)),false,'ledger launches need no RPC call');
 assert.equal(res.networks.robinhood.all.some(x=>x.address===A(1)),false);
 const p=res.networks.pons.all.find(x=>x.address===A(1));
 assert.equal(p.launch.status,'ONCHAIN_VERIFIED');assert.equal(p.volume24hUsd,60000,'observed market data kept');
 assert.equal(res.ponsExpansion.fromLedger,1);
 const led=res.ponsLaunchLedger.map(x=>x.address);
 assert.ok(led.includes(A(1))&&led.includes(A(10)),'ledger carries old + newly verified launches');
});

test('PL-3: Pons intake down — ledger launches still never appear in Robinhood; RPC failure never erases the ledger',async()=>{
 const res=await run({pons:{ok:false},robinhood:sec('robinhood',[row(1),row(20)])},{ponsLaunchLedger:[{address:A(1),factory:F,verifiedAt:'2026-11-20T16:23:40Z'}]});
 assert.equal(res.networks.robinhood.all.some(x=>x.address===A(1)),false);
 assert.ok(res.ponsLaunchLedger.some(x=>x.address===A(1)));
 const res2=await run({pons:sec('pons',[]),robinhood:sec('robinhood',[row(1),row(20)])},
  {ponsLaunchLedger:[{address:A(1),factory:F,verifiedAt:'2026-11-20T16:23:40Z'}],ponsMembership:async()=>{const e=new Error('rpc');e.code='RADAR_PONS_MEMBERSHIP_UNAVAILABLE';throw e;}});
 assert.equal(res2.ponsExpansion.error,'RADAR_PONS_MEMBERSHIP_UNAVAILABLE');
 assert.equal(res2.networks.robinhood.all.some(x=>x.address===A(1)),false);
 assert.ok(res2.networks.pons.all.some(x=>x.address===A(1)));
});

test('PL-4: publication gate refuses a Robinhood row that the ledger records as a Pons launch',()=>{
 const snap={ponsLaunchLedger:[{address:A(1),factory:F,verifiedAt:'2026-11-20T16:23:40Z'}],sections:{robinhood:{rows:[{address:A(1),symbol:'ZZZ'}]},pons:{rows:[]}}};
 assert.ok(S.publishable(snap).problems.includes('ROBINHOOD_HAS_PONS_LAUNCH:ZZZ'));
});
