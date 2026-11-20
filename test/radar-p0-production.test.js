'use strict';
// ARCY Radar P0 production fix: cold-cache section timeouts, Pons proof independent of the Robinhood intake, real 80-contract
// factory budget, no older-engine carry-forward, and a strict production publication gate.
const test=require('node:test'),assert=require('node:assert/strict');
const {sections}=require('../scripts/probe-radar-intel.cjs');
const pons=require('../lib/radar-v2/pons');
const E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot');
const CF=require('../lib/radar-v2/intel/custom-filter');
const NOW=Date.parse('2026-11-20T13:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0');

test('P0-1: a cold-cache section timeout is retried with a longer budget instead of failing the whole Robinhood/Pons build',async()=>{
 const calls={};
 const fetcher=async(url,{signal})=>{const chain=new URL(url,'https://x').searchParams.get('chain');calls[chain]=(calls[chain]||0)+1;
  if(chain==='robinhood'&&calls[chain]===1){const e=new Error('timeout');e.name='TimeoutError';throw e;}
  if(chain==='pons'&&calls[chain]===1)return {ok:false,status:504,json:async()=>({})};
  return {ok:true,status:200,json:async()=>({ok:true,network:chain})};};
 const s=await sections(fetcher,{attempts:[10,10,10],pauseMs:0});
 assert.equal(s.out.robinhood.ok,true);assert.equal(s.out.pons.ok,true);
 assert.equal(calls.robinhood,2);assert.equal(calls.pons,2);
 assert.equal(s.timing.robinhood.attempts[0].error,'TimeoutError');
 // persistent failure is reported, never guessed
 const dead=await sections(async()=>{const e=new Error('t');e.name='TimeoutError';throw e;},{attempts:[1,1,1],pauseMs:0});
 assert.equal(dead.out.robinhood.ok,false);assert.equal(dead.timing.robinhood.attempts.length,3);
});

test('P0-2: the factory budget is real — 80 contracts are checked in two 40-contract calls, any failure fails the check',async()=>{
 const seen=[];
 const many=async(_u,list)=>{seen.push(list.length);return {members:new Map(list.filter((_,i)=>i%10===0).map(a=>[a,{factory:'0xf'}]))};};
 const tokens=Array.from({length:80},(_,i)=>A(i+1));
 const r=await pons.membershipAll('rpc',tokens,{},{many,max:40});
 assert.deepEqual(seen,[40,40]);assert.equal(r.checked,80);assert.equal(r.members.size,8);
 await assert.rejects(pons.membershipAll('rpc',tokens,{},{many:async(_u,l)=>{if(seen.push(l.length)>3)throw new Error('RPC');return {members:new Map()};},max:40}));
});

test('P0-3: Pons launch proof still runs when the Robinhood intake failed',async()=>{
 const at=new Date(NOW).toISOString();
 const row=(n,o={})=>({address:A(n),chainId:4663,symbol:'P'+n,name:'P'+n,priceUsd:0.2,liquidityUsd:90000,volume24hUsd:60000,change24hPct:-4,officialLinks:{websites:['https://p'+n+'.example'],socials:[]},...o});
 const ponsSec={ok:true,network:'pons',chainId:4663,asOf:at,freshness:'FRESH',tokens:[],nearMiss:[{...row(1),stage:'BELOW_TOP_10'},{...row(2),stage:'BELOW_TOP_10'}]};
 const asked=[];
 const res=await E.run({sections:{pons:ponsSec,robinhood:{ok:false}},now:NOW,env:{},fetcher:async()=>{throw new Error('x');},
  limits:{customFilter:true,exit:false,pace:false,crossCheck:false,universe:false,ponsMembership:async a=>{asked.push(...a);return new Map([[A(1),{factory:'0xf'}]]);}}});
 assert.deepEqual(asked.sort(),[A(1),A(2)].sort());
 assert.equal(res.ponsExpansion.confirmedExisting,1);
 assert.equal(res.ponsExpansion.robinhoodIntake,'INVALID_SNAPSHOT');
 assert.equal(res.networks.pons.all.find(x=>x.address===A(1)).launch.status,'ONCHAIN_VERIFIED');
 assert.notEqual(res.networks.pons.all.find(x=>x.address===A(2))?.launch?.status,'ONCHAIN_VERIFIED','no membership inferred');
});

// minimal valid current-engine snapshot built through the real pipeline
const PROFILE={universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},officialLinks:{websites:['https://project.example'],socials:[]}};
const r=(n,net,chainId,o={})=>({key:chainId+':'+A(n),network:net,chainId,address:A(n),symbol:'X'+n,name:'Project '+n,
 category:{category:'EARLY_STAGE_CANDIDATE'},eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],risk:[],discoveryClass:'NEAR_MATCH',marketObserved:true,
 poolCreatedAt:new Date(NOW-70*86400000).toISOString(),snapshotNow:NOW,radarAsOf:new Date(NOW-360000).toISOString(),radarFreshness:'FRESH',
 priceUsd:0.1,liquidityUsd:450000,volume24hUsd:250000,change24hPct:-9,trades24h:125,buys24h:72,sells24h:53,marketCapUsd:9e6,fdvUsd:1e7,
 sourceEvidence:{crossCheck:'MATCHED'},v3Verification:{crossCheck:'MATCHED'},history:{observations:3,flags:[],drawdownFromPeakPct:-32},
 marketSpread:{liquidityUsd:{min:430000,max:450000,ratio:1.05}},evidenceConfidence:{score:0.4,missing:[]},opportunity:{score:25,dimensions:{},flags:[]},
 nearMatch:{maxDistance:0.4,missed:[],pending:[],passed:[]},...PROFILE,...(net==='pons'?{launch:{status:'ONCHAIN_VERIFIED'}}:{}),...o});
const NETS={arc:5042,ethereum:1,robinhood:4663,pons:4663};
function snapshot({counts={arc:10,ethereum:10,robinhood:10,pons:10}}={}){
 const at=new Date(NOW).toISOString(),networks={},input={};let base=1000;
 for(const [n,cid] of Object.entries(NETS)){
  const rows=E.selectDisplay(Array.from({length:counts[n]},(_,i)=>r(base+i,n,cid)),{network:n,now:NOW,filterB:false,customFilter:true});base+=100;
  networks[n]={source:{status:'OBSERVED',asOf:at},displayCandidates:rows,all:rows,display:{target:10,shortfall:rows.shortfall||null}};
  input[n]={asOf:at,tokens:rows.map(x=>({address:x.address,chainId:cid,symbol:x.symbol,priceUsd:x.priceUsd,volume24hUsd:x.volume24hUsd,liquidityUsd:x.liquidityUsd,change24hPct:x.change24hPct}))};
 }
 return S.build({riskLedger:[],networks},input,{now:NOW,commit:'abc'});
}

test('P0-4: production gate — fresh current-engine 4x10 publishes; stale, carried, older-engine, incomplete or overlapping never',()=>{
 const s=snapshot();
 assert.equal(S.validate(s).ok,true,JSON.stringify(S.validate(s)));
 const g=S.publishable(s,{commit:'abc'});
 assert.equal(g.ok,true,JSON.stringify(g));assert.deepEqual(g.counts,{arc:10,ethereum:10,robinhood:10,pons:10});assert.equal(g.unique,40);assert.equal(g.overlap,0);
 assert.ok(S.publishable(s,{commit:'other'}).problems.includes('ENGINE_COMMIT_MISMATCH'));
 const carried=structuredClone(s);carried.sections.robinhood.carriedForward=true;
 assert.ok(S.publishable(carried,{commit:'abc'}).problems.includes('robinhood:CARRIED_FORWARD'));
 const old=structuredClone(s);for(const x of old.sections.pons.rows)x.opportunity.researchRank.version='arcy-custom-filter-2';
 assert.ok(S.publishable(old,{commit:'abc'}).problems.includes('pons:OLDER_ENGINE_ROWS'));
 const cut=structuredClone(s);cut.sections.robinhood.rows=cut.sections.robinhood.rows.slice(0,1);
 assert.equal(S.publishable(cut,{commit:'abc'}).ok,false,'1/10 without a genuine shortfall is never published');
 const nb=structuredClone(s);nb.sections.pons={status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]};
 assert.ok(S.publishable(nb,{commit:'abc'}).problems.some(p=>p.startsWith('pons:NOT_BUILT')));
 // a fresh build whose ranked eligible pool truly had 9 rows is published with its recorded shortfall, not padded
 const nine=snapshot({counts:{arc:10,ethereum:10,robinhood:10,pons:9}});
 const g9=S.publishable(nine,{commit:'abc'});
 assert.equal(nine.sections.pons.rows.length,9);assert.equal(g9.ok,true,JSON.stringify(g9));
});

test('P0-5: a failed section is never filled with an older engine list; same-engine carry-forward stays labelled',()=>{
 const prev=snapshot();
 for(const x of prev.sections.robinhood.rows)x.opportunity.researchRank.version='arcy-custom-filter-2';
 const next=structuredClone(snapshot());next.generatedAt=new Date(NOW+3600000).toISOString();
 next.sections.robinhood={status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]};
 next.sections.pons={status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]};
 const m=S.merge(prev,next,{requireRankVersion:CF.VERSION});
 assert.equal(m.sections.robinhood.status,'NOT_BUILT');assert.equal(m.sections.robinhood.reason,'PREVIOUS_SECTION_FROM_OLDER_ENGINE');
 assert.equal(m.sections.pons.carriedForward,true,'same-engine section may be carried (labelled), but the publish gate still refuses it');
 assert.equal(S.publishable(m,{commit:'abc'}).ok,false);
});
