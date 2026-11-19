'use strict';
// Radar V5 Quality Discovery (#279): Filter A (unchanged early discovery) + Filter B (quality expansion for empty slots only)
// + separate, versioned Quality Ranking. "Adaptive discovery is permitted. Adaptive safety is not."
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/radar-v2/intel/engine'),QX=require('../lib/radar-v2/intel/quality-expansion'),QR=require('../lib/radar-v2/intel/quality-rank');
const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds'),F=require('../lib/radar-v2/intel/fetch'),D=require('../lib/radar-v2/discovery');
const DAY=86400000,NOW=Date.parse('2026-11-20T10:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
const CID={arc:5042,ethereum:1,robinhood:4663,pons:4663};
const ART={url:'https://assets.geckoterminal.com/v5-fixture',source:'GeckoTerminal'};
const act=(o={})=>({source:'GeckoTerminal pool windows',volumeUsd:{h1:50000,h6:300000,h24:1200000},trades:{h1:40,h6:300,h24:900},buyers:{h24:260},sellers:{h24:210},...o});
// Engine-result shaped rows (what selectDisplay receives).
const early=(network,n,o={})=>({key:CID[network]+':'+A(n),network,chainId:CID[network],address:A(n),symbol:'E'+n,eligibility:'REVIEW',reasons:[],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:0.2,liquidityUsd:network==='ethereum'?400000:60000,volume24hUsd:network==='ethereum'?300000:20000,
 change24hPct:4,trades24h:200,buys24h:100,sells24h:100,poolCreatedAt:iso(40),snapshotNow:NOW,artwork:ART,category:{category:'EARLY_STAGE_CANDIDATE',basis:'NO_NON_EARLY_SIGNAL'},
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:30,dimensions:{product:0,team:0,adoption:0}},evidenceConfidence:{score:30,missing:['EXIT']},infoV4:'NİTELİKLİ — tüm sıralama eşiklerini geçti; Araştırma izleme listesi',...o});
const est=(network,n,o={})=>({key:CID[network]+':'+A(n),network,chainId:CID[network],address:A(n),symbol:'B'+n,name:'Blue '+n,eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY'],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:12,liquidityUsd:network==='ethereum'?8e6:400000,volume24hUsd:network==='ethereum'?3e6:150000,change24hPct:2.5,
 trades24h:900,buys24h:470,sells24h:430,pairCount:4,poolCreatedAt:iso(700),snapshotNow:NOW,artwork:ART,activity:act(),
 category:{category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST',detail:'fixture'},sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:3,of:3,sourcesDisagree:false},
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:10,dimensions:{product:null,team:null,adoption:null}},evidenceConfidence:{score:10,missing:[]},evidenceSummary:{risk:{}},infoV4:'x',...o});

test('V5-1. Filter B fills ONLY empty slots, after every Filter A row, never displaces Filter A, and is explicitly labelled',()=>{
 const rows=[early('ethereum',1),early('ethereum',2,{discoveryClass:'NEAR_MATCH',nearMatch:{passed:[],maxDistance:0.2,missed:[],pending:[]}}),est('ethereum',50),est('ethereum',51,{change24hPct:1})];
 const out=E.selectDisplay(rows,{network:'ethereum',now:NOW});
 assert.deepEqual(out.map(x=>x.discoveryFilter),['A_EARLY_DISCOVERY','A_EARLY_DISCOVERY','B_QUALITY_EXPANSION','B_QUALITY_EXPANSION']);
 assert.deepEqual(out.slice(0,2).map(x=>x.address),[A(1),A(2)],'Filter A order unchanged');
 const b=out[2];
 assert.equal(b.eligibility,'QUALITY_EXPANSION_REVIEW');assert.equal(b.displayTier,'WATCHLIST_NOT_VERIFIED');
 assert.deepEqual(b.earlyStage,{decision:'EXCLUDE',reason:'NOT_EARLY_STAGE_CATEGORY',category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST'});
 assert.match(b.infoV4,/^KALİTE GENİŞLEMESİ \(Filtre B\) — YERLEŞİK PROJE, erken aşama keşfi DEĞİLDİR; /);
 assert.doesNotMatch(b.infoV4,/güvenli(?!k)|\bsafe\b/i);
 assert.equal(out.byFilter.B_QUALITY_EXPANSION,2);assert.equal(out.filterB.accepted,2);
 // Ten Filter A rows => Filter B does not run at all.
 const full=E.selectDisplay([...Array.from({length:10},(_,i)=>early('ethereum',100+i)),est('ethereum',52)],{network:'ethereum',now:NOW});
 assert.equal(full.length,10);assert.ok(full.every(x=>x.discoveryFilter==='A_EARLY_DISCOVERY'));assert.equal(full.filterB.ran,false);
});

test('V5-2. SHARK, Gamooor, Louie and WASTED patterns cannot enter through Filter A or Filter B under 10-slot pressure',()=>{
 for(const [symbol,change,network] of [['SHARK',238.712,'arc'],['Gamooor',202.725,'arc'],['Louie',199.526,'arc'],['WASTED',30636.245,'ethereum']]){
  const a=early(network,7,{symbol,change24hPct:change,discoveryClass:'MONITOR_ONLY',liquidityUsd:0,artwork:null,nearMatch:{passed:[],pending:['INDEPENDENT_CROSS_CHECK_PENDING'],maxDistance:0.4}});
  // Same pattern presented as an "established" category must not slip in through Filter B either.
  const b=est(network,8,{symbol,change24hPct:change});
  const out=E.selectDisplay([a,b],{network,now:NOW});
  assert.equal(out.length,0,symbol);
  assert.equal(out.shortfall.filterB.droppedByReason.B_ALREADY_SPIKED_24H,1,symbol);
 }
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:39.9}),'ethereum',{now:NOW}),null);
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:40}),'ethereum',{now:NOW}),'B_ALREADY_SPIKED_24H');
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:-30}),'ethereum',{now:NOW}),'B_EXTREME_DRAWDOWN_24H');
});

test('V5-3. persistent risk-hold, critical risks, conflicts and identity blocks are never overridden by Filter B',()=>{
 const AF='5042:0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e';
 const held=new Set(RH.list(RH.initial(null)).filter(x=>x.state==='HELD').map(x=>x.key));
 assert.ok(held.has(AF),'seeded AF hold present');
 const af=est('arc',1,{key:AF,address:'0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e',symbol:'AF'});
 assert.equal(QX.gate(af,'arc',{held,now:NOW}),'B_PERSISTENT_RISK_HOLD');
 assert.equal(E.selectDisplay([af],{network:'arc',held,now:NOW}).length,0);
 const cases=[[{reasons:['NOT_EARLY_STAGE_CATEGORY','PERSISTENT_LOW_EXIT_LIQUIDITY']},'B_CRITICAL_RISK'],[{reasons:['NOT_EARLY_STAGE_CATEGORY'],risk:['SELL_DISABLED']},'B_CRITICAL_RISK'],
  [{reasons:['NOT_EARLY_STAGE_CATEGORY','SOURCE_CONTRADICTION']},'B_CRITICAL_RISK'],[{reasons:['NOT_EARLY_STAGE_CATEGORY','ENGINE_ERROR_TIMEOUT']},'B_CRITICAL_RISK'],
  [{reasons:['IDENTITY_CATEGORY_BLOCKED']},'B_NOT_A_CATEGORY_EXCLUSION'],[{discoveryClass:'CONFLICT'},'B_SOURCE_CONFLICT'],[{discoveryClass:'HARD'},'B_CRITICAL_V3_GATE'],
  [{discoveryClass:'MONITOR_ONLY'},'B_V3_GATES_NOT_MET'],[{sourceEvidence:{crossCheck:'CONFLICT'}},'B_SOURCE_CONFLICT']];
 for(const [o,why] of cases)assert.equal(QX.gate(est('ethereum',2,o),'ethereum',{now:NOW}),why,JSON.stringify(o));
});

test('V5-4. stablecoins, wrapped, bridged, commodity, tokenized equity and legacy memes are never used to fill the list',()=>{
 for(const cat of ['STABLECOIN','WRAPPED_OR_BASE_ASSET','BRIDGED_ESTABLISHED_ASSET','COMMODITY_BACKED','TOKENIZED_EQUITY','LEGACY_MEME'])
  assert.equal(QX.gate(est('ethereum',3,{category:{category:cat,basis:'EXACT_CONTRACT_LIST'}}),'ethereum',{now:NOW}),'B_CATEGORY_NOT_ELIGIBLE_'+cat);
 assert.equal(QX.gate(est('pons',3),'pons',{now:NOW}),'B_NETWORK_NOT_IN_SCOPE','Pons Launch is a launch subset');
});

test('V5-5. weak liquidity, churn, thin trades and unsourced artwork are rejected by Filter B',()=>{
 const p=D.PROFILES.ethereum;
 const cases=[[{liquidityUsd:p.minLiq-1},'B_LIQUIDITY_BELOW_NETWORK_FLOOR'],[{liquidityUsd:null},'B_LIQUIDITY_BELOW_NETWORK_FLOOR'],[{priceUsd:0},'B_PRICE_NOT_OBSERVED'],
  [{volume24hUsd:p.minVol*0.5-1},'B_ACTIVITY_BELOW_FLOOR'],[{volume24hUsd:5e7,liquidityUsd:5e6},'B_HIGH_VOLUME_TO_LIQUIDITY_RATIO'],[{trades24h:9},'B_TRADES_INSUFFICIENT'],
  [{change24hPct:null},'B_MOMENTUM_NOT_OBSERVED'],[{poolCreatedAt:null},'B_POOL_AGE_NOT_VERIFIED'],[{artwork:null},'B_TOKEN_ARTWORK_NOT_SOURCED']];
 for(const [o,why] of cases)assert.equal(QX.gate(est('ethereum',4,o),'ethereum',{now:NOW}),why,JSON.stringify(o));
});

test('V5-6. measured large-cap identity needs independent corroboration, a mature pool and a unique ticker; exact contracts keep identity',()=>{
 const lc=o=>est('ethereum',5,{category:{category:'ESTABLISHED_LARGE_CAP',basis:'MEASURED_MARKET_SIZE'},...o});
 assert.equal(QX.gate(lc({sourceEvidence:{crossCheck:null}}),'ethereum',{now:NOW}),'B_INDEPENDENT_CROSS_CHECK_MISSING','low-float FDV alone is not identity');
 assert.equal(QX.gate(lc({poolCreatedAt:iso(10)}),'ethereum',{now:NOW}),'B_POOL_YOUNGER_THAN_30D');
 const tickers=new Map([['b5',new Set([A(5),A(6)])]]);
 assert.equal(QX.gate(lc(),'ethereum',{tickers,now:NOW}),'B_DUPLICATE_TICKER_UNRESOLVED');
 assert.equal(QX.gate(est('ethereum',5),'ethereum',{tickers,now:NOW}),null,'exact listed contract is not a look-alike');
 // Segment labels follow measured facts, never marketing.
 const q=QR.compute(lc({poolCreatedAt:iso(120),activity:act({volumeUsd:{h1:1,h6:10,h24:1000}})}),'ethereum',NOW);
 assert.equal(QX.segmentOf(lc({poolCreatedAt:iso(120)}),q,NOW),'GROWING_PROJECT');
 const q2=QR.compute(est('ethereum',5),'ethereum',NOW);
 assert.equal(QX.segmentOf(est('ethereum',5,{activity:act({volumeUsd:{h1:1,h6:10,h24:1000}})}),{...q2,components:{...q2.components,earlyMomentum:0}},NOW),'ESTABLISHED_PROJECT');
});

test('V5-7. Quality Ranking is separate, versioned, weights sum to 100, missing data earns nothing, a run-up earns no momentum',()=>{
 assert.equal(QR.VERSION,'arcy-quality-rank-1');
 assert.equal(Object.values(QR.WEIGHTS).reduce((a,b)=>a+b,0),100);
 const empty=QR.compute({},'ethereum',NOW);
 assert.equal(empty.score,0);
 for(const m of ['LIQUIDITY_NOT_OBSERVED','TRADES_NOT_OBSERVED','OFFICIAL_IDENTITY_NOT_VERIFIED','INDEPENDENT_CROSS_CHECK_MISSING','VOLUME_WINDOWS_NOT_OBSERVED'])assert.ok(empty.missing.includes(m),m);
 const flat=QR.compute(est('ethereum',6,{change24hPct:2}),'ethereum',NOW),ran=QR.compute(est('ethereum',6,{change24hPct:35}),'ethereum',NOW);
 assert.ok(flat.components.earlyMomentum>0);assert.equal(ran.components.earlyMomentum,0);assert.ok(ran.score<flat.score);
 assert.equal(flat.notSafetyVerdict,true);assert.equal(flat.notForecast,true);
 // Filter A rows carry the ranking for explanation only; the existing Discovery Score is untouched.
 const a=E.selectDisplay([early('ethereum',7,{discoveryScore:55.5})],{network:'ethereum',now:NOW});
 assert.equal(a[0].qualityRank.version,'arcy-quality-rank-1');assert.equal(a[0].discoveryScore,55.5);
 assert.match(a[0].infoV4,/^NİTELİKLİ — tüm sıralama eşiklerini geçti; Kalite Sıralaması \d+\/100/);
 // Chasing volume without wallets is not organic growth.
 const churn=QR.compute(est('ethereum',8,{activity:act({buyers:{h24:3},sellers:{h24:2}})}),'ethereum',NOW);
 assert.ok(churn.components.organicGrowth<flat.components.organicGrowth);
});

test('V5-8. snapshot: Filter A + Filter B rows publish and validate; wrong order, wrong category or hidden EXCLUDE are rejected',()=>{
 const rows=[early('ethereum',1),est('ethereum',60)];
 const display=E.selectDisplay(rows,{network:'ethereum',now:NOW});
 const engine={networks:{ethereum:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{},display:{shown:2,byClass:display.byClass,byFilter:display.byFilter,filterB:display.filterB},all:rows}},riskLedger:null};
 const sections={ethereum:{tokens:[],nearMiss:[],excluded:[],asOf:iso(0.01)}};
 const snap=S.build(engine,sections,{now:NOW,commit:'test'});
 const sec=snap.sections.ethereum;
 assert.equal(S.validate(snap).ok,true,JSON.stringify(S.validate(snap)));
 assert.equal(sec.rows[1].opportunity.discoveryFilter,'B_QUALITY_EXPANSION');
 assert.equal(sec.rows[1].opportunity.category,'ESTABLISHED_BLUE_CHIP');
 assert.equal(sec.rows[1].opportunity.expansion.segment,'ESTABLISHED_PROJECT');
 assert.match(sec.rows[1].discovery.reason,/^KALİTE GENİŞLEMESİ/);
 const clone=()=>structuredClone(snap);
 let bad=clone();bad.sections.ethereum.rows=[bad.sections.ethereum.rows[1],bad.sections.ethereum.rows[0]].map((r,i)=>({...r,rank:i+1}));
 assert.equal(S.validate(bad).ok,false,'Filter B before Filter A is invalid');
 bad=clone();bad.sections.ethereum.rows[1].opportunity.category='STABLECOIN';assert.equal(S.validate(bad).ok,false);
 bad=clone();bad.sections.ethereum.rows[1].opportunity.eligibility='EXCLUDE';assert.equal(S.validate(bad).ok,false);
 bad=clone();bad.sections.ethereum.rows[1].opportunity.discoveryFilter='A_EARLY_DISCOVERY';assert.equal(S.validate(bad).ok,false,'an established row may not pose as early discovery');
 bad=clone();bad.sections.ethereum.rows[1].opportunity.qualityRank.score=10;assert.equal(S.validate(bad).ok,false);
 // Pre-V5 snapshots (no discoveryFilter) stay valid.
 const old=clone();old.sections.ethereum.rows=[old.sections.ethereum.rows[0]];delete old.sections.ethereum.rows[0].opportunity.discoveryFilter;assert.equal(S.validate(old).ok,true);
});

test('V5-9. carry-forward during a source outage re-checks Filter B rows on their own measurements',()=>{
 const display=E.selectDisplay([est('ethereum',61),est('ethereum',62)],{network:'ethereum',now:NOW});
 const engine={networks:{ethereum:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{displayed:2,watchOnly:2},display:{shown:2,byClass:display.byClass},all:[]}},riskLedger:null};
 const raw=n=>({address:A(n),symbol:'B'+n,name:'Blue '+n,priceUsd:12,liquidityUsd:8e6,volume24hUsd:3e6,change24hPct:2.5,logo:ART});
 const prev=S.build(engine,{ethereum:{asOf:iso(0.01),tokens:[raw(61),raw(62)]}},{now:NOW-60000,commit:'t'});
 prev.sections.ethereum.rows[1].change24hPct=45; // previously-published row that would now fail the B rule
 const next={...prev,generatedAt:new Date(NOW).toISOString(),sections:{ethereum:{status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]}}};
 const m=S.merge(prev,next);
 assert.equal(m.sections.ethereum.carriedForward,true);
 assert.equal(m.sections.ethereum.rows.length,1);
 assert.equal(m.sections.ethereum.display.shortfall.droppedByReason.CARRIED_QUALITY_FILTER_REMOVED,1);
 assert.equal(S.validate(m).ok,true);
});

test('V5-10. end-to-end engine run: an exact-listed established Ethereum contract fills an empty slot as Filter B; XAUt/PEPE stay excluded',async()=>{
 F._reset();E._clearCache();
 const fields={priceUsd:{status:'CROSS_VERIFIED'},volume24hUsd:{status:'CROSS_VERIFIED'},liquidityUsd:{status:'CROSS_VERIFIED'}};
 const tok=(a,symbol,name,o={})=>({rank:1,address:a,chainId:1,symbol,name,priceUsd:100,volume24hUsd:4e6,liquidityUsd:2e7,change24hPct:1.5,poolCreatedAt:iso(900),buys24h:500,sells24h:450,
  logo:ART,fields,verification:{crossCheck:'MATCHED'},activity:act(),discovery:{version:'arcy-discovery-2',score:60,poolsSeen:3},...o});
 const tokens=[tok('0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9','AAVE','Aave Token'),tok('0x68749665ff8d2d112fa859aa293f07a622782f38','XAUt','Tether Gold'),tok('0x6982508145454ce325ddbe47a25d4ec3d2311933','PEPE','Pepe')].map((t,i)=>({...t,rank:i+1}));
 const r=await E.run({sections:{ethereum:{ok:true,network:'ethereum',chainId:1,asOf:iso(0.01),freshness:'FRESH',tokens,excluded:[],nearMiss:[],discovery:{uniqueCandidates:3}}},
  now:NOW,env:{},fetcher:async()=>{throw Error('offline');},rpc:{},registryDoc:{schema:'arcy-radar-project-registry/1',version:'t',projects:[]},limits:{concurrency:1,pace:false}});
 const n=r.networks.ethereum;
 assert.deepEqual(n.displayCandidates.map(x=>x.symbol),['AAVE']);
 assert.equal(n.displayCandidates[0].discoveryFilter,'B_QUALITY_EXPANSION');
 assert.equal(n.display.filterB.droppedByReason.B_CATEGORY_NOT_ELIGIBLE_COMMODITY_BACKED,1);
 assert.equal(n.display.filterB.droppedByReason.B_CATEGORY_NOT_ELIGIBLE_LEGACY_MEME,1);
 assert.equal(n.funnel.shownByFilter.B_QUALITY_EXPANSION,1);
 const snap=S.build(r,{ethereum:{tokens,asOf:iso(0.01)}},{now:NOW,commit:'t'});
 assert.equal(S.validate(snap).ok,true);
 assert.equal(snap.sections.ethereum.rows[0].logo.url,ART.url,'exact-contract artwork kept');
});

test('V5-11. builder cross-check adopts exact-contract DEX Screener artwork only for the base token, never a quote-side or other contract',async()=>{
 F._reset();E._clearCache();
 const base=A(70),other=A(71),USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
 const pair=(b,q,img)=>({chainId:'ethereum',pairAddress:A(9000+Number(BigInt(b)%100n)),baseToken:{address:b},quoteToken:{address:q},priceUsd:'0.5',volume:{h24:70000},liquidity:{usd:150000},
  priceChange:{h24:1},pairCreatedAt:NOW-40*DAY,info:{imageUrl:img}});
 const fetcher=async()=>({ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify([pair(base,USDC,'https://cdn.dexscreener.com/cms/images/base-logo.png'),pair(USDC,other,'https://cdn.dexscreener.com/cms/images/usdc.png')])});
 const nm=a=>({address:a,symbol:'X'+a.slice(-2),name:'X',reason:'POOL_LEVEL_GATES',priceUsd:0.5,volume24hUsd:70000,liquidityUsd:150000,change24hPct:1,logo:null,poolCreatedAt:iso(40),buys24h:60,sells24h:55,
  pool:A(9000+Number(BigInt(a)%100n)),quote:USDC,stage:'POOL_LEVEL_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR','LIQUIDITY_BELOW_NETWORK_FLOOR']});
 const r=await E.run({sections:{ethereum:{ok:true,network:'ethereum',chainId:1,asOf:iso(0.01),freshness:'FRESH',tokens:[],excluded:[],nearMiss:[nm(base),nm(other)],discovery:{uniqueCandidates:2}}},
  now:NOW,env:{},fetcher:async()=>{throw Error('offline');},rpc:{},registryDoc:{schema:'arcy-radar-project-registry/1',version:'t',projects:[]},limits:{concurrency:1,pace:false,crossCheckFetcher:fetcher}});
 const by=a=>r.networks.ethereum.all.find(x=>x.address===a);
 assert.equal(by(base).artwork?.url,'https://cdn.dexscreener.com/cms/images/base-logo.png');
 assert.equal(by(base).artwork?.source,'DEX Screener');
 assert.equal(by(other).artwork,null,'a quote-side appearance never lends another project’s logo');
 assert.equal(r.cost.artworkAdoptedFromCrossCheck,1);
});

test('V5-12. Filter B never runs on Pons, and Robinhood keeps its Filter A list when already full',()=>{
 const out=E.selectDisplay([est('pons',1)],{network:'pons',now:NOW});
 assert.equal(out.length,0);assert.equal(out.shortfall.filterB.droppedByReason.B_NETWORK_NOT_IN_SCOPE,1);
 const rh=E.selectDisplay([...Array.from({length:10},(_,i)=>early('robinhood',200+i)),est('robinhood',300)],{network:'robinhood',now:NOW});
 assert.equal(rh.length,10);assert.ok(rh.every(x=>x.discoveryFilter==='A_EARLY_DISCOVERY'));
});

test('V5-13. extreme 24h run-ups and crashes are not shown on Robinhood or Pons either; ordinary moves stay; other microcap rules unchanged',()=>{
 const Q=require('../lib/radar-v2/intel/discovery-quality');
 for(const network of ['robinhood','pons']){
  assert.equal(Q.reason({change24hPct:-71},network),'EXTREME_DRAWDOWN_24H',network+' WOOD-like crash');
  assert.equal(Q.reason({change24hPct:-56},network),'EXTREME_DRAWDOWN_24H',network+' OPHIRIS-like crash');
  assert.equal(Q.reason({change24hPct:238},network),'ALREADY_SPIKED_24H');
  assert.equal(Q.reason({change24hPct:-34},network),null,'ordinary decline remains observable');
  assert.equal(Q.reason({change24hPct:null,liquidityUsd:0,artwork:null},network),null,'liquidity/artwork rules still Arc/Ethereum only');
 }
 const out=E.selectDisplay([early('robinhood',1,{change24hPct:-71}),early('robinhood',2)],{network:'robinhood',now:NOW});
 assert.deepEqual(out.map(x=>x.address),[A(2)]);
});
