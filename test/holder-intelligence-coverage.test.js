'use strict';
// Holder census / concentration intelligence, on-chain role proofs and the fixed-cohort verified-coverage definition.
const test=require('node:test'),assert=require('node:assert/strict');
const HI=require('../search/server/lib/holder-intelligence');
const V=require('../search/server/lib/verified-coverage');
const {formatCard}=require('../search/server/lib/data-engine');
const {chain}=require('../search/server/lib/chains');
const A=n=>'0x'+n.toString(16).padStart(40,'0'),TOKEN=A(0xabc),BLOCK='0x1500000';
const f=(value,status,extra={})=>({value,status,dataState:'DATA_FOUND',source:'test',chainId:1,network:'ethereum',evidence:[{block:BLOCK,address:TOKEN}],...extra});
const nv=()=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',evidence:[]});

test('HI-1 census never presents bounded or count-only evidence as a complete census',()=>{
 const complete=HI.census({holderCount:f(18,'RECONCILED_SNAPSHOT'),largestWalletPct:f(40,'RECONCILED_SNAPSHOT'),top10Pct:f(90,'RECONCILED_SNAPSHOT'),top20Pct:f(100,'RECONCILED_SNAPSHOT')});
 assert.equal(complete.state,'COMPLETE_CENSUS');assert.equal(complete.complete,true);assert.equal(complete.reconciliation,'RECONCILED_TO_TOTAL_SUPPLY');
 assert.equal(complete.indexedBlock,String(0x1500000));
 const bounded=HI.census({holderCount:f(38211,'SOURCE_REPORTED'),largestWalletPct:f(21.4,'SOURCE_REPORTED_RPC_RECONCILED'),top10Pct:f(56.3,'SOURCE_REPORTED_RPC_RECONCILED'),top20Pct:nv()});
 assert.equal(bounded.state,'RECONCILED_CANDIDATES');assert.equal(bounded.complete,false);assert.equal(bounded.countBasis,'EXPLORER_OR_PROVIDER_REPORTED');
 assert.match(bounded.limitation,/Not an exhaustive census/);
 assert.equal(HI.census({holderCount:f(512,'SOURCE_REPORTED'),largestWalletPct:nv(),top10Pct:nv(),top20Pct:nv()}).state,'COUNT_ONLY');
 const hist=HI.census({holderCount:f(900,'HISTORICAL_ONCHAIN_VERIFIED'),largestWalletPct:f(12,'ONCHAIN_VERIFIED',{freshness:{state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'}}),top10Pct:nv(),top20Pct:nv()});
 assert.equal(hist.state,'HISTORICAL_SNAPSHOT');assert.equal(hist.complete,false);assert.equal(hist.snapshotAt,'2026-10-01T00:00:00Z');
 assert.equal(HI.census({}).state,'UNAVAILABLE');
 assert.equal(HI.census({holderCount:nv(),top10Pct:f(30,'SOURCE_REPORTED')}).state,'PROVIDER_REPORTED_CONCENTRATION');
});

test('HI-2 concentration: raw top 1/5/10/20; adjusted excludes ONLY positively identified infrastructure; unknown whales stay',()=>{
 const rows=[{address:A(1),sharePct:30,role:'LIQUIDITY_POOL',roleEvidence:{method:'getPair round-trip',block:BLOCK}},{address:A(2),sharePct:25,role:'UNKNOWN'},
  {address:'0x000000000000000000000000000000000000dead',sharePct:10,role:'BURN_ADDRESS'},...Array.from({length:12},(_,i)=>({address:A(10+i),sharePct:2-i*0.1,role:i%2?'EXTERNALLY_OWNED_ADDRESS':'UNKNOWN'}))];
 const c=HI.concentration(rows,{token:TOKEN});
 assert.equal(c.raw.top1,30,'raw keeps the pool (same rule as the published fields: only burn is excluded)');
 assert.equal(c.adjusted.largestNonInfrastructureWalletPct,25,'the unknown 25% wallet is never excluded');
 assert.equal(c.adjusted.excludedInfrastructurePct,40);
 assert.ok(c.raw.top10>c.adjusted.top10);
 assert.deepEqual(c.infrastructure.map(x=>x.role).sort(),['BURN_ADDRESS','LIQUIDITY_POOL']);
 assert.ok(c.unknownLargeWallets.some(w=>w.address===A(2)));
 // no identified infrastructure -> no adjusted block at all (nothing implied)
 assert.equal(HI.concentration([{address:A(2),sharePct:25,role:'UNKNOWN'}]).adjusted,null);
 assert.equal(HI.concentration([{address:A(2),sharePct:25,role:'UNKNOWN'}]).raw.top5,null,'top5 withheld with fewer than 5 candidates');
});

// minimal Ethereum RPC mock
function mock({codes={},calls={}}={}){
 return async(method,params)=>{
  if(method==='eth_getCode')return codes[params[0]]??'0x';
  if(method==='eth_call'){const k=params[0].to+':'+params[0].data;if(k in calls){const v=calls[k];if(v instanceof Error)throw v;return v;}return '0x';}
  throw Error('unexpected '+method);
 };
}
const pad=a=>'0x'+'0'.repeat(24)+a.slice(2),w=a=>a.slice(2).padStart(64,'0');
test('HI-3 on-chain role proofs: EOA, 7702, verified V2/V3 pools, v4 manager, token self; spoofed pools and errors fail closed',async()=>{
 const V2='0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f',V3='0x1f98431c8ad98523631ae4a59f267346ea31f984',WETH=A(0xeee);
 const pair=A(0x200),pool=A(0x300),fake=A(0x400);
 const rpc=mock({codes:{[pair]:'0x6080',[pool]:'0x6080',[fake]:'0x6080',[A(0x500)]:'0xef0100'+'1'.repeat(40),[A(0x600)]:'0x6080'},calls:{
  [pair+':0xc45a0155']:pad(V2),[pair+':0x0dfe1681']:pad(TOKEN),[pair+':0xd21220a7']:pad(WETH),[V2+':0xe6a43905'+w(TOKEN)+w(WETH)]:pad(pair),
  [pool+':0xc45a0155']:pad(V3),[pool+':0x0dfe1681']:pad(TOKEN),[pool+':0xd21220a7']:pad(WETH),[pool+':0xddca3f43']:'0x'+(3000).toString(16).padStart(64,'0'),
  [V3+':0x1698ee82'+w(TOKEN)+w(WETH)+(3000).toString(16).padStart(64,'0')]:pad(pool),
  // spoof: claims the V2 factory but the factory does not map the pair back to it
  [fake+':0xc45a0155']:pad(V2),[fake+':0x0dfe1681']:pad(TOKEN),[fake+':0xd21220a7']:pad(WETH),[V2+':0xe6a43905'+w(TOKEN)+w(WETH)+'']:pad(pair)}});
 const r=async a=>(await HI.classifyRole(a,{token:TOKEN,block:BLOCK,rpc})).role;
 assert.equal(await r(A(0x700)),'EXTERNALLY_OWNED_ADDRESS');
 assert.equal(await r(A(0x500)),'EIP7702_DELEGATED_EOA');
 assert.equal(await r(pair),'LIQUIDITY_POOL');
 assert.equal(await r(pool),'LIQUIDITY_POOL');
 assert.equal(await r(fake),'UNKNOWN_CONTRACT','a factory() claim without the round-trip is not a pool');
 assert.equal(await r(A(0x600)),'UNKNOWN_CONTRACT');
 assert.equal(await r(HI.ETH.V4_POOL_MANAGER),'DEX_POOL_MANAGER');
 assert.equal(await r(TOKEN),'TOKEN_CONTRACT_SELF');
 const failing=async()=>{throw Error('RPC down');};
 assert.equal((await HI.classifyRole(A(0x800),{token:TOKEN,block:BLOCK,rpc:failing})).role,'UNKNOWN','RPC outage never invents a role');
 const ev=(await HI.classifyRole(pair,{token:TOKEN,block:BLOCK,rpc})).roleEvidence;
 assert.equal(ev.block,BLOCK);assert.equal(ev.dex,'Uniswap V2');
 assert.equal(HI.enabled({}),false,'on-chain role proofs are OFF by default');
});

test('HI-4 data engine: proven roles need same-block evidence; four fields and holderIntelligence are additive',()=>{
 const cfg=chain('ethereum'),ctx={network:'ethereum',chainId:1,address:TOKEN,block:BLOCK};
 const fields={holderCount:f(38211,'SOURCE_REPORTED'),largestWalletPct:f(30,'SOURCE_REPORTED_RPC_RECONCILED'),top10Pct:f(60,'SOURCE_REPORTED_RPC_RECONCILED'),top20Pct:f(70,'SOURCE_REPORTED_RPC_RECONCILED')};
 const cand=(roleRow)=>[{address:A(1),rank:1,sharePct:30,block:BLOCK,...roleRow},{address:A(2),rank:2,sharePct:10,role:'UNKNOWN',block:BLOCK}];
 const ok=formatCard('holders',{fields,holderCandidates:cand({role:'LIQUIDITY_POOL',roleEvidence:{method:'getPair round-trip',block:BLOCK}})},cfg,ctx);
 assert.equal(ok.holderCandidates[0].role,'LIQUIDITY_POOL');
 assert.deepEqual(Object.keys(ok.fields),['holderCount','largestWalletPct','top10Pct','top20Pct'],'schema fields unchanged');
 assert.equal(ok.holderIntelligence.state,'RECONCILED_CANDIDATES');
 assert.equal(ok.holderIntelligence.concentration.adjusted.excludedInfrastructurePct,30);
 const noProof=formatCard('holders',{fields,holderCandidates:cand({role:'LIQUIDITY_POOL'})},cfg,ctx);
 assert.equal(noProof.holderCandidates,undefined,'role without evidence -> whole candidate list rejected (fail closed)');
 const wrongBlock=formatCard('holders',{fields,holderCandidates:cand({role:'LIQUIDITY_POOL',roleEvidence:{method:'x',block:'0x1'}})},cfg,ctx);
 assert.equal(wrongBlock.holderCandidates,undefined);
 const invented=formatCard('holders',{fields,holderCandidates:cand({role:'TREASURY_GUESS'})},cfg,ctx);
 assert.equal(invented.holderCandidates,undefined,'unknown role names are rejected');
 assert.equal(formatCard('mechanics',{fields:{}},cfg,ctx).holderIntelligence,undefined,'only the holders card carries it');
});

const rep=(over={})=>{const card=(keys,make)=>({fields:Object.fromEntries(keys.map(k=>[k,make(k)]))});
 return {cards:{activity:card(['priceUsd','valuation','change24h','volume24h'],()=>f(1,'ON_CHAIN')),liquidity:card(['liquidityUsd','volume24h','dexPairCount','liquidityTurnover24h'],()=>f(1,'SOURCE_REPORTED')),
  supply:card(['totalSupply','nonBurnSupply','burnAddressBalance','burnAddressPct'],()=>f('1000','ON_CHAIN')),holders:card(['holderCount','largestWalletPct','top10Pct','top20Pct'],k=>k==='holderCount'?f(12,'SOURCE_REPORTED'):f(9,'ON_CHAIN')),
  mechanics:card(['tradingTaxes','mintCapability','ownerAdmin','contractArchitecture'],()=>nv()),...over}};};
test('COV-1 fixed denominator: 12 core observations per token; failed reports stay in it; only the audited rule may exclude',()=>{
 const tok={section:'ethereum',network:'ethereum',address:TOKEN,symbol:'X'};
 const ok=V.observe(tok,rep());
 assert.equal(ok.length,12);
 // audit correction: an explorer-reported count below 20 is NOT reliable enough to drop top20Pct from the denominator
 assert.equal(ok.find(o=>o.key==='top20Pct').applicable,true);
 const census=rep({holders:{fields:{holderCount:f(12,'RECONCILED_SNAPSHOT'),largestWalletPct:f(40,'RECONCILED_SNAPSHOT'),top10Pct:f(99,'RECONCILED_SNAPSHOT'),top20Pct:f(100,'RECONCILED_SNAPSHOT')}}});
 const top20=V.observe(tok,census).find(o=>o.key==='top20Pct');assert.equal(top20.applicable,false);assert.match(top20.inapplicableReason,/FEWER_THAN_20_HOLDERS_COMPLETE_CENSUS \(12\)/);
 const histCensus=rep({holders:{fields:{holderCount:f(12,'RECONCILED_SNAPSHOT',{freshness:{state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'}}),largestWalletPct:f(40,'RECONCILED_SNAPSHOT'),top10Pct:f(99,'RECONCILED_SNAPSHOT'),top20Pct:f(100,'RECONCILED_SNAPSHOT')}}});
 assert.equal(V.observe(tok,histCensus).find(o=>o.key==='top20Pct').applicable,true,'historical count is not reliable for exclusion');
 const failed=V.observe(tok,null,{error:'HTTP_502'});
 assert.equal(failed.length,12);assert.ok(failed.every(o=>o.applicable&&o.tier==='NOT_VERIFIED'&&/REPORT_UNAVAILABLE/.test(o.reason)));
 const r=V.report([...ok,...failed]);
 assert.equal(r.overall.expected,24);assert.equal(r.overall.inapplicable,0);assert.equal(r.overall.applicable,24);
 // single-source market rows are evidence, not verified
 assert.equal(ok.find(o=>o.key==='liquidityUsd').tier,'SOURCE_BACKED');
 assert.equal(ok.find(o=>o.key==='priceUsd').tier,'VERIFIED');
 assert.ok(r.overall.verifiedCoveragePct<r.overall.evidenceCoveragePct);
});

test('COV-2 stale, historical and conflicting observations are never counted as verified; chains are reported separately',()=>{
 const tok=s=>({section:s,network:s==='pons'?'robinhood':s,address:A(s.length),symbol:s});
 const hist=rep({holders:{fields:{holderCount:f(50,'ON_CHAIN'),largestWalletPct:f(9,'HISTORICAL_ONCHAIN_VERIFIED',{freshness:{state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'}}),top10Pct:f(9,'ON_CHAIN',{snapshot:{freshness:'STALE'}}),top20Pct:f(9,'ON_CHAIN',{crossCheck:{state:'DISAGREE',providers:['a','b']}})}}});
 const o=V.observe(tok('arc'),hist);
 assert.equal(o.find(x=>x.key==='largestWalletPct').tier,'HISTORICAL');
 assert.equal(o.find(x=>x.key==='top10Pct').tier,'STALE');
 assert.equal(o.find(x=>x.key==='top20Pct').tier,'CONFLICTING');
 const r=V.report([...o,...V.observe(tok('pons'),rep())]);
 assert.deepEqual(Object.keys(r.byChain).sort(),['arc','pons']);
 assert.ok(r.byChain.arc.verified<r.byChain.arc.applicable);
 assert.ok(r.failures['holders.top10Pct'].byTier.STALE>=1);
});

test('COV-3 the cohort is fixed, unique per chain+contract and Pons maps to the Robinhood network (never mixed with it)',()=>{
 const c=require('../data/verified-coverage/radar-cohort-20261121.json');
 assert.equal(c.tokens.length,40);
 assert.equal(new Set(c.tokens.map(t=>t.section+':'+t.address)).size,40);
 assert.ok(c.tokens.filter(t=>t.section==='pons').every(t=>t.network==='robinhood'&&t.chainId===4663));
 const rh=new Set(c.tokens.filter(t=>t.section==='robinhood').map(t=>t.address));
 assert.equal(c.tokens.filter(t=>t.section==='pons').filter(t=>rh.has(t.address)).length,0,'no Pons/Robinhood overlap in the cohort');
 assert.match(c.source.commit,/^[0-9a-f]{40}$/);
});

test('COV-4 definitions: historical never counts as current evidence; compare() reports per chain x field on the same cohort',()=>{
 const tok={section:'arc',network:'arc',address:A(3),symbol:'H'};
 const hist=rep({holders:{fields:{holderCount:f(50,'HISTORICAL_ONCHAIN_VERIFIED',{freshness:{state:'LAST_VERIFIED',observedAt:'2026-10-01T00:00:00Z'}}),largestWalletPct:f(9,'ON_CHAIN'),top10Pct:f(9,'ON_CHAIN'),top20Pct:f(9,'ON_CHAIN')}}});
 const before=V.report(V.observe(tok,hist)),after=V.report(V.observe(tok,rep({holders:{fields:{holderCount:f(50,'ON_CHAIN'),largestWalletPct:f(9,'ON_CHAIN'),top10Pct:f(9,'ON_CHAIN'),top20Pct:f(9,'ON_CHAIN')}}})));
 assert.equal(before.overall.historical,1);assert.ok(before.overall.historicalCoveragePct>0);
 assert.equal(before.overall.evidenceCoveragePct,Math.round(10000*(before.overall.verified+before.overall.sourceBacked)/before.overall.applicable)/100);
 before.rows=V.observe(tok,hist);after.rows=V.observe(tok,rep({holders:{fields:{holderCount:f(50,'ON_CHAIN'),largestWalletPct:f(9,'ON_CHAIN'),top10Pct:f(9,'ON_CHAIN'),top20Pct:f(9,'ON_CHAIN')}}}));
 const d=V.compare(before,after);
 assert.equal(d.sameCohort,true);assert.equal(d.byField['holders.holderCount'].gained,1);assert.equal(d.byChainField['arc|holders.holderCount'].after,1);
 assert.equal(d.transitions['HISTORICAL->VERIFIED'],1);
 assert.equal(V.compare(before,{rows:after.rows.slice(1)}).sameCohort,false,'a different token/field set is never compared as before/after');
});

test('HI-5 role proofs obey a strict RPC budget and report a profile',async()=>{
 let calls=0;const rpc=async(m)=>{calls++;return m==='eth_getCode'?'0x6080':null;};
 const cands=Array.from({length:12},(_,i)=>({address:'0x'+String(i+1).padStart(40,'1'),rank:i+1,sharePct:1,role:'UNKNOWN'}));
 const out=await HI.classifyRoles(cands,{token:TOKEN,block:'0x1',rpc,maxCalls:12});
 assert.ok(calls<=12,'never exceeds maxCalls ('+calls+')');
 assert.equal(out.length,12);assert.ok(out.profile.skippedBudget>0);assert.equal(out.profile.budgetExhausted,true);
 assert.ok(out.slice(-1)[0].role==='UNKNOWN','budget-skipped candidates stay UNKNOWN');
 const slow=await HI.classifyRoles(cands,{token:TOKEN,block:'0x1',rpc,maxMs:0});assert.equal(slow.profile.classified,0);
});
