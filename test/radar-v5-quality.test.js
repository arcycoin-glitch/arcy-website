'use strict';
// Radar V5 (#279): three-tier discovery — EARLY (Filter A), GROWTH, ESTABLISHED QUALITY (A-class) — from the V3 window AND a
// separate bounded established/growth universe, ranked together by `arcy-research-rank-1`. Hard safety gates never relax.
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/radar-v2/intel/engine'),QX=require('../lib/radar-v2/intel/quality-expansion'),QR=require('../lib/radar-v2/intel/quality-rank');
const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds'),F=require('../lib/radar-v2/intel/fetch'),D=require('../lib/radar-v2/discovery');
const U=require('../lib/radar-v2/intel/universe');
const DAY=86400000,NOW=Date.parse('2026-11-20T10:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
const CID={arc:5042,ethereum:1,robinhood:4663,pons:4663};
const ART={url:'https://assets.geckoterminal.com/v5-fixture',source:'GeckoTerminal'};
const act=(o={})=>({source:'GeckoTerminal pool windows',volumeUsd:{h1:50000,h6:300000,h24:1200000},trades:{h1:40,h6:300,h24:900},buyers:{h24:260},sellers:{h24:210},...o});
const REVIEW=['DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED','PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED','EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED'];
const HIST=(o={})=>({version:'arcy-market-memory-1',observations:3,from:iso(2),to:iso(0),flags:[],coverage:'OBSERVED',peak24hRisePct:5,drawdownFromPeakPct:-3,...o});
// Engine-result shaped rows (what selectDisplay receives).
const early=(network,n,o={})=>({key:CID[network]+':'+A(n),network,chainId:CID[network],address:A(n),symbol:'E'+n,eligibility:'REVIEW',reasons:[...REVIEW],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:0.2,liquidityUsd:network==='ethereum'?400000:60000,volume24hUsd:network==='ethereum'?300000:20000,
 change24hPct:4,trades24h:200,buys24h:100,sells24h:100,poolCreatedAt:iso(40),snapshotNow:NOW,artwork:ART,category:{category:'EARLY_STAGE_CANDIDATE',basis:'NO_NON_EARLY_SIGNAL'},
 v3Verification:{crossCheck:'MATCHED'},sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:2,of:3},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},history:HIST(),
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:30,dimensions:{product:0,team:0,adoption:0},flags:[]},evidenceConfidence:{score:30,missing:['EXIT']},infoV4:'NİTELİKLİ — tüm sıralama eşiklerini geçti; Araştırma izleme listesi',...o});
const est=(network,n,o={})=>({key:CID[network]+':'+A(n),network,chainId:CID[network],address:A(n),symbol:'B'+n,name:'Blue '+n,eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY',...REVIEW],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:12,liquidityUsd:network==='ethereum'?8e6:400000,volume24hUsd:network==='ethereum'?3e6:150000,change24hPct:2.5,
 trades24h:900,buys24h:470,sells24h:430,pairCount:4,poolCreatedAt:iso(700),snapshotNow:NOW,artwork:ART,activity:act(),
 category:{category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST',detail:'fixture'},sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:3,of:3,sourcesDisagree:false},
 universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'},registry:{project:'Blue',kind:'LENDING_GOVERNANCE'}},history:HIST(),
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:10,dimensions:{product:null,team:null,adoption:null},flags:[]},evidenceConfidence:{score:10,missing:[]},evidenceSummary:{risk:{}},infoV4:'x',...o});

test('V5-1. combined ranking: a corroborated A-class project outranks a weak MONITOR row; class order and verified evidence still lead; Info explains',()=>{
 const monitor=early('ethereum',3,{discoveryClass:'MONITOR_ONLY',symbol:'WEAK',nearMatch:{passed:[],pending:['POOL_AGE_UNKNOWN'],maxDistance:0.4}});
 const eligible=early('ethereum',1,{eligibility:'ELIGIBLE',reasons:[],opportunity:{score:70,dimensions:{product:80,team:80,adoption:80},flags:[]}});
 const out=E.selectDisplay([monitor,eligible,est('ethereum',50)],{network:'ethereum',now:NOW});
 assert.deepEqual(out.map(x=>x.address),[A(1),A(50)],'verified-evidence first, then A-class; the weak monitor never fills the main list');
 assert.deepEqual(out.watch.map(x=>x.address),[A(3)]);assert.ok(out.watch[0].reasons.includes('MONITOR_ONLY_CLASS'));
 assert.deepEqual(out.map(x=>x.discoveryTier),['EARLY','ESTABLISHED']);
 const b=out[1];
 assert.equal(b.discoveryFilter,'B_QUALITY_EXPANSION');assert.equal(b.eligibility,'QUALITY_EXPANSION_REVIEW');assert.equal(b.displayTier,'WATCHLIST_NOT_VERIFIED');
 assert.equal(b.researchRank.version,'arcy-research-rank-1');assert.equal(b.researchRank.position,2);
 for(const part of [/^ARAŞTIRMAYA UYGUN \(güvenlik sertifikası değildir\); A-SINIFI YERLEŞİK PROJE — yerleşik proje kalitesi, getiri tahmini veya güvenlik garantisi değildir; /,/Kimlik: kontrat bağımsız kaynaklarla eşleşti \(resmi ihraççı doğrulaması değil\)/,/Profil: %\d+ kanıtlı \(eksik: /,/Geçmiş: 3 gözlem/,/Neden: listelenmiş kontrat, iki kaynakta kimlik eşleşti/,
  /Kalite Sıralaması \d+\/100/,/Piyasa: likidite \$8\.0M, 24s hacim \$3\.0M, 900 işlem/,/Eksik doğrulama: /,/Sıra #2: araştırma sınıfı, sınıf \(nitelikli\)/,/Veri: 2026-11-20 10:00 UTC/])
  assert.match(b.infoV4,part);
 assert.doesNotMatch(b.infoV4,/güvenli(?!k)|\bsafe\b|yükselecek|pump/i);
 assert.deepEqual(out.byTier,{EARLY:1,ESTABLISHED:1});
 // Filter A rows keep their class statement first; an old pool is labelled GROWTH, not "early".
 // An old pool is not "growth" by age: without observed activity growth it is a MATURE market; with it, GROWTH.
 const old=E.selectDisplay([early('arc',9,{poolCreatedAt:iso(400)})],{network:'arc',now:NOW});
 assert.equal(old[0].discoveryTier,'MATURE');assert.match(old[0].infoV4,/NİTELİKLİ — tüm sıralama eşiklerini geçti; OLGUN PİYASA — yeni değil, büyüme kanıtı henüz yok/);
 const grew=E.selectDisplay([early('arc',9,{poolCreatedAt:iso(400),history:HIST({flags:['ACTIVITY_GROWTH_OBSERVED'],growth:{spanHours:96,liquidityPct:35,volumePct:80}})})],{network:'arc',now:NOW});
 assert.equal(grew[0].discoveryTier,'GROWTH');
});

test('V5-2. SHARK, Gamooor, Louie and WASTED patterns cannot enter through any tier under 10-slot pressure',()=>{
 for(const [symbol,change,network] of [['SHARK',238.712,'arc'],['Gamooor',202.725,'arc'],['Louie',199.526,'arc'],['WASTED',30636.245,'ethereum']]){
  const a=early(network,7,{symbol,change24hPct:change,discoveryClass:'MONITOR_ONLY',liquidityUsd:0,artwork:null,nearMatch:{passed:[],pending:['INDEPENDENT_CROSS_CHECK_PENDING'],maxDistance:0.4}});
  const b=est(network,8,{symbol,change24hPct:change});
  const out=E.selectDisplay([a,b],{network,now:NOW});
  assert.equal(out.length,0,symbol);
  assert.equal(out.shortfall.filterB.droppedByReason.B_ALREADY_SPIKED_24H,1,symbol);
 }
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:39.9}),'ethereum',{now:NOW}),null);
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:40}),'ethereum',{now:NOW}),'B_ALREADY_SPIKED_24H');
 assert.equal(QX.gate(est('ethereum',9,{change24hPct:-30}),'ethereum',{now:NOW}),'B_EXTREME_DRAWDOWN_24H');
});

test('V5-3. persistent risk-hold, critical risks, conflicts and identity blocks are never overridden by popularity or size',()=>{
 const AF='5042:0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e';
 const held=new Set(RH.list(RH.initial(null)).filter(x=>x.state==='HELD').map(x=>x.key));
 assert.ok(held.has(AF),'seeded AF hold present');
 const af=est('arc',1,{key:AF,address:'0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e',symbol:'AF',liquidityUsd:5e7});
 assert.equal(QX.gate(af,'arc',{held,now:NOW}),'B_PERSISTENT_RISK_HOLD');
 assert.equal(E.selectDisplay([af],{network:'arc',held,now:NOW}).length,0);
 const big={liquidityUsd:9e8,volume24hUsd:5e7,fdvUsd:5e10};
 const cases=[[{reasons:['NOT_EARLY_STAGE_CATEGORY','PERSISTENT_LOW_EXIT_LIQUIDITY']},'B_CRITICAL_RISK'],[{risk:['SELL_DISABLED']},'B_CRITICAL_RISK'],
  [{reasons:['NOT_EARLY_STAGE_CATEGORY','LOW_EXIT_LIQUIDITY']},'B_CRITICAL_RISK'],[{reasons:['NOT_EARLY_STAGE_CATEGORY','SOURCE_CONTRADICTION']},'B_CRITICAL_RISK'],
  [{reasons:['NOT_EARLY_STAGE_CATEGORY','HOLDER_CONCENTRATION_RISK']},'B_CRITICAL_RISK'],[{reasons:['NOT_EARLY_STAGE_CATEGORY','ENGINE_ERROR_TIMEOUT']},'B_CRITICAL_RISK'],
  [{reasons:['IDENTITY_CATEGORY_BLOCKED']},'B_NOT_A_CATEGORY_EXCLUSION'],[{discoveryClass:'CONFLICT'},'B_SOURCE_CONFLICT'],[{discoveryClass:'HARD'},'B_CRITICAL_V3_GATE'],
  [{discoveryClass:'MONITOR_ONLY'},'B_V3_GATES_NOT_MET'],[{sourceEvidence:{crossCheck:'CONFLICT'}},'B_SOURCE_CONFLICT']];
 for(const [o,why] of cases)assert.equal(QX.gate(est('ethereum',2,{...big,...o}),'ethereum',{now:NOW}),why,JSON.stringify(o));
});

test('V5-4. stablecoins, wrapped, bridged, commodity, tokenized equity and legacy memes are never used to fill the list; Pons has no expansion',()=>{
 for(const cat of ['STABLECOIN','WRAPPED_OR_BASE_ASSET','BRIDGED_ESTABLISHED_ASSET','COMMODITY_BACKED','TOKENIZED_EQUITY','LEGACY_MEME'])
  assert.equal(QX.gate(est('ethereum',3,{category:{category:cat,basis:'EXACT_CONTRACT_LIST'}}),'ethereum',{now:NOW}),'B_CATEGORY_NOT_ELIGIBLE_'+cat);
 assert.equal(QX.gate(est('pons',3),'pons',{now:NOW}),'B_NETWORK_NOT_IN_SCOPE','Pons Launch stays factory-verified only');
 const out=E.selectDisplay([est('pons',1)],{network:'pons',now:NOW});assert.equal(out.length,0);
});

test('V5-5. weak liquidity, churn, thin trades and missing market facts are rejected; a missing logo is NOT a rejection',()=>{
 const p=D.PROFILES.ethereum;
 const cases=[[{liquidityUsd:p.minLiq-1},'B_LIQUIDITY_BELOW_NETWORK_FLOOR'],[{liquidityUsd:null},'B_LIQUIDITY_BELOW_NETWORK_FLOOR'],[{priceUsd:0},'B_PRICE_NOT_OBSERVED'],
  [{volume24hUsd:p.minVol*0.5-1},'B_ACTIVITY_BELOW_FLOOR'],[{volume24hUsd:5e7,liquidityUsd:5e6},'B_HIGH_VOLUME_TO_LIQUIDITY_RATIO'],[{trades24h:9},'B_TRADES_INSUFFICIENT'],
  [{change24hPct:null},'B_MOMENTUM_NOT_OBSERVED'],[{poolCreatedAt:null},'B_POOL_AGE_NOT_VERIFIED']];
 for(const [o,why] of cases)assert.equal(QX.gate(est('ethereum',4,o),'ethereum',{now:NOW}),why,JSON.stringify(o));
 assert.equal(QX.gate(est('ethereum',4,{artwork:null}),'ethereum',{now:NOW}),null);
});

test('V5-6. tiers: A-class needs a listed exact contract corroborated in this run; measured size alone is GROWTH and needs a cross-check, a 30-day pool and a unique ticker',()=>{
 const lc=o=>est('ethereum',5,{category:{category:'ESTABLISHED_LARGE_CAP',basis:'MEASURED_MARKET_SIZE'},...o});
 assert.equal(QX.gate(lc({sourceEvidence:{crossCheck:null}}),'ethereum',{now:NOW}),'B_INDEPENDENT_CROSS_CHECK_MISSING','low-float FDV alone is not identity');
 assert.equal(QX.gate(lc({poolCreatedAt:iso(10)}),'ethereum',{now:NOW}),'B_POOL_YOUNGER_THAN_30D');
 const tickers=new Map([['b5',new Set([A(5),A(6)])]]);
 assert.equal(QX.gate(lc(),'ethereum',{tickers,now:NOW}),'B_DUPLICATE_TICKER_UNRESOLVED');
 assert.equal(QX.tierOf(lc()),'GROWTH','popular by size is not A-class');
 assert.equal(QX.gate(est('ethereum',5,{sourceEvidence:{crossCheck:null},universe:null}),'ethereum',{now:NOW}),'B_LISTED_IDENTITY_NOT_CORROBORATED','a listing alone is not identity');
 assert.equal(QX.tierOf(est('ethereum',5,{sourceEvidence:{crossCheck:null},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}}})),'ESTABLISHED');
 assert.equal(QX.gate(est('ethereum',5),'ethereum',{tickers,now:NOW}),null,'exact listed contract is not a look-alike');
});

test('V5-7 (weakness 3). Quality Ranking separates organic participation from transaction-count proxies; identity needs corroboration',()=>{
 assert.equal(QR.VERSION,'arcy-quality-rank-1');
 assert.equal(Object.values(QR.WEIGHTS).reduce((a,b)=>a+b,0),100);
 const empty=QR.compute({},'ethereum',NOW);
 assert.equal(empty.score,0);
 // Same 900 trades: no participant data => proxy only, capped at 30% of the component.
 const proxy=QR.compute(est('ethereum',6,{activity:act({buyers:{h24:null},sellers:{h24:null}})}),'ethereum',NOW);
 assert.equal(proxy.organicBasis,'TRANSACTION_COUNT_PROXY');assert.ok(proxy.components.organicGrowth<=0.3);assert.ok(proxy.missing.includes('UNIQUE_PARTICIPANTS_NOT_OBSERVED'));
 const wallets=QR.compute(est('ethereum',6),'ethereum',NOW);
 assert.equal(wallets.organicBasis,'PROVIDER_UNIQUE_WALLETS');assert.ok(wallets.components.organicGrowth>proxy.components.organicGrowth);
 const churn=QR.compute(est('ethereum',6,{activity:act({buyers:{h24:3},sellers:{h24:2}})}),'ethereum',NOW);
 assert.ok(churn.components.organicGrowth<proxy.components.organicGrowth,'many trades by few wallets is not adoption');
 const reviewed=QR.compute(est('ethereum',6,{evidenceSummary:{demand:{distinctBuyers:300,cluster:'REVIEWED_NO_CONCENTRATION',wash:'REVIEWED_NO_SELF_TRADE'}}}),'ethereum',NOW);
 assert.equal(reviewed.organicBasis,'ONCHAIN_DEMAND_REVIEWED');assert.equal(reviewed.components.organicGrowth,1);
 // Identity: a listing without corroboration earns nothing; a logo never earns identity.
 assert.equal(QR.compute(est('ethereum',6,{sourceEvidence:{crossCheck:null},universe:null}),'ethereum',NOW).components.identity,0);
 assert.equal(QR.compute(early('ethereum',7,{artwork:ART}),'ethereum',NOW).components.identity,QR.compute(early('ethereum',7,{artwork:null}),'ethereum',NOW).components.identity);
 // A 24h run-up earns no momentum.
 assert.equal(QR.compute(est('ethereum',6,{change24hPct:35}),'ethereum',NOW).components.earlyMomentum,0);
});

test('V5-8. snapshot: tiers publish and validate; class order is enforced for every row; wrong category or hidden EXCLUDE is rejected',()=>{
 const weaker=early('ethereum',1,{activity:null,buys24h:null,sells24h:null});
 const display=E.selectDisplay([weaker,est('ethereum',60)],{network:'ethereum',now:NOW});
 assert.deepEqual(display.map(x=>x.discoveryFilter),['B_QUALITY_EXPANSION','A_EARLY_DISCOVERY'],'A-class may now precede a weaker Filter A row');
 const engine={networks:{ethereum:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{},display:{shown:2,byClass:display.byClass,byTier:display.byTier},all:[]}},riskLedger:null};
 const snap=S.build(engine,{ethereum:{tokens:[],nearMiss:[],excluded:[],asOf:iso(0.01)}},{now:NOW,commit:'test'});
 assert.deepEqual(S.validate(snap),{ok:true});
 const b=snap.sections.ethereum.rows[0].opportunity;
 assert.equal(b.discoveryTier,'ESTABLISHED');assert.equal(b.category,'ESTABLISHED_BLUE_CHIP');assert.equal(b.researchRank.version,'arcy-research-rank-1');
 assert.deepEqual(b.expansion.reviewedReasons,REVIEW);
 const clone=()=>structuredClone(snap);
 let bad=clone();bad.sections.ethereum.rows[1].opportunity.researchTier='WATCH_ONLY';assert.equal(S.validate(bad).ok,false,'WATCH_ONLY never in the main list');
 bad=clone();bad.sections.ethereum.rows[1].opportunity.discoveryClass='MONITOR_ONLY';assert.equal(S.validate(bad).ok,false,'MONITOR_ONLY never in the main list');
 bad=clone();bad.sections.ethereum.rows[0].opportunity.researchTier='RESEARCH_CANDIDATE';bad.sections.ethereum.rows[1].opportunity.researchTier='RESEARCH_QUALIFIED';
 assert.equal(S.validate(bad).ok,false,'a QUALIFIED research row may never sit below a CANDIDATE');
 bad=clone();bad.sections.ethereum.rows[1].opportunity.identityLevel='EXACT_CONTRACT_OBSERVED';assert.equal(S.validate(bad).ok,false,'uncorroborated identity never in the main list');
 bad=clone();bad.sections.ethereum.rows[1].opportunity.researchProfile.level='MINIMAL';assert.equal(S.validate(bad).ok,false,'a minimal profile never in the main list');
 bad=clone();bad.sections.ethereum.rows[0].opportunity.category='STABLECOIN';assert.equal(S.validate(bad).ok,false);
 bad=clone();bad.sections.ethereum.rows[0].opportunity.eligibility='EXCLUDE';assert.equal(S.validate(bad).ok,false);
 bad=clone();bad.sections.ethereum.rows[0].opportunity.discoveryFilter='A_EARLY_DISCOVERY';assert.equal(S.validate(bad).ok,false,'an established row may not pose as early discovery');
 bad=clone();bad.sections.ethereum.rows[0].opportunity.discoveryTier='EARLY';assert.equal(S.validate(bad).ok,false);
 bad=clone();bad.sections.ethereum.rows[0].opportunity.qualityRank.score=10;assert.equal(S.validate(bad).ok,false);
 const old=clone();old.sections.ethereum.rows=[old.sections.ethereum.rows[1]].map(r=>({...r,rank:1}));for(const k of ['researchRank','researchTier','identityLevel','researchProfile','marketHistory','identityEvidence'])delete old.sections.ethereum.rows[0].opportunity[k];
 delete old.sections.ethereum.rows[0].opportunity.discoveryFilter;assert.equal(S.validate(old).ok,true,'pre-V5 rows stay valid');
});

test('V5-9 (weakness 4). carry-forward re-checks published quality-expansion rows against every gate they carry',()=>{
 const display=E.selectDisplay([est('ethereum',61),est('ethereum',62),est('ethereum',63),est('ethereum',64),est('ethereum',65)],{network:'ethereum',now:NOW});
 const engine={networks:{ethereum:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{displayed:5,watchOnly:5},display:{shown:5,byClass:display.byClass},all:[]}},riskLedger:null};
 const raw=n=>({address:A(n),symbol:'B'+n,name:'Blue '+n,priceUsd:12,liquidityUsd:8e6,volume24hUsd:3e6,change24hPct:2.5,buys24h:470,sells24h:430,poolCreatedAt:iso(700),logo:ART});
 const prev=S.build(engine,{ethereum:{asOf:iso(0.01),tokens:[61,62,63,64,65].map(raw)}},{now:NOW-60000,commit:'t'});
 assert.equal(S.validate(prev).ok,true);
 const rows=prev.sections.ethereum.rows,byAddr=a=>rows.find(r=>r.address===a);
 byAddr(A(62)).change24hPct=45;                                           // price move now out of range
 byAddr(A(63)).opportunity.expansion.reviewedReasons=['SOMETHING_NEW'];   // unreviewed reason smuggled into a carried row
 byAddr(A(64)).volume24hUsd=9e7;                                          // churn far above liquidity
 byAddr(A(65)).opportunity.sourceEvidence.crossCheck=null;byAddr(A(65)).opportunity.sourceEvidence.identity=null; // identity no longer corroborated
 const next={...prev,generatedAt:new Date(NOW).toISOString(),sections:{ethereum:{status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]}}};
 const m=S.merge(prev,next);
 assert.equal(m.sections.ethereum.carriedForward,true);
 assert.deepEqual(m.sections.ethereum.rows.map(r=>r.address),[A(61)]);
 assert.equal(m.sections.ethereum.display.shortfall.droppedByReason.CARRIED_QUALITY_FILTER_REMOVED,4);
 assert.equal(S.validate(m).ok,true);
 assert.equal(QX.publishedReason(byAddr(A(63)),'ethereum'),'B_UNREVIEWED_EXCLUSION_REASON');
 assert.equal(QX.publishedReason(byAddr(A(65)),'ethereum'),'B_LISTED_IDENTITY_NOT_CORROBORATED');
});

test('V5-10 (weakness 1). Filter B never bypasses an unknown or unreviewed exclusion reason',()=>{
 for(const r of ['SOME_FUTURE_CODE','PONS_FACTORY_NOT_VERIFIED','RADAR_SNAPSHOT_STALE_OR_UNVERIFIED'])
  assert.notEqual(QX.gate(est('ethereum',10,{reasons:['NOT_EARLY_STAGE_CATEGORY',r]}),'ethereum',{now:NOW}),null,r);
 assert.equal(QX.gate(est('ethereum',10,{reasons:['NOT_EARLY_STAGE_CATEGORY','SOME_FUTURE_CODE']}),'ethereum',{now:NOW}),'B_UNREVIEWED_EXCLUSION_REASON');
 for(const r of QX.REVIEWED_NON_BLOCKING)assert.equal(QX.CRITICAL.has(r),false,r+' cannot be both reviewed-non-blocking and critical');
});

test('V5-11 (weakness 2). artwork is decorative: no logo never disqualifies, a borrowed logo is never published, and a logo earns no score',()=>{
 const noLogo=E.selectDisplay([est('ethereum',70,{artwork:null}),early('ethereum',71,{artwork:null})],{network:'ethereum',now:NOW});
 assert.equal(noLogo.length,2);
 const Q=require('../lib/radar-v2/intel/discovery-quality');
 assert.equal(Q.reason(early('arc',72,{discoveryClass:'MONITOR_ONLY',artwork:null}),'arc'),null);
 assert.equal(Q.reason(early('arc',73,{discoveryClass:'MONITOR_ONLY',artwork:ART,v3Verification:null,sourceEvidence:null,universe:null}),'arc'),'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED','a logo does not stand in for identity');
 const {candidateArtwork}=require('../lib/radar-v2/artwork-evidence');
 assert.equal(candidateArtwork({network:'ethereum',address:A(74),logo:{url:'https://evil.example/aave.png',source:'GeckoTerminal'}}),null);
});

// ── universe intake (registry + explorer index + DEX Screener), mocked providers ──
const AAVE='0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',LINK='0x514910771af9ca656af840dff83e8264ecf986ca',UNI='0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
function providers({explorer={},pairs=[],explorerList=[],calls=[]}={}){
 const res=b=>({ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify(b),json:async()=>b});
 return async u=>{u=String(u);calls.push(u);
  if(/blockscout\.com\/api\/v2\/tokens\?type=ERC-20/.test(u))return res({items:explorerList});
  const one=/blockscout\.com\/api\/v2\/tokens\/(0x[0-9a-f]{40})$/.exec(u);if(one)return explorer[one[1]]?res(explorer[one[1]]):{ok:false,status:404,headers:new Map(),text:async()=>'{}'};
  if(/explorer\.arc\.io/.test(u))return {ok:false,status:503,headers:new Map(),text:async()=>'{}'};
  const tp=/api\.dexscreener\.com\/token-pairs\/v1\/(\w+)\/(0x[0-9a-f]{40})$/.exec(u);
  if(tp)return res(pairs.filter(p=>p.chainId===tp[1]&&(p.baseToken.address===tp[2]||p.quoteToken.address===tp[2])));
  if(/api\.dexscreener\.com\/tokens\/v1\/(\w+)\//.test(u)){const chain=/tokens\/v1\/(\w+)\//.exec(u)[1];return res(pairs.filter(p=>p.chainId===chain));}
  throw Error('unexpected '+u);};
}
const pair=(base,sym,o={})=>({chainId:'ethereum',pairAddress:A(0x9000+parseInt(base.slice(-4),16)),dexId:'uniswap',url:'https://dexscreener.com/ethereum/x',baseToken:{address:base,symbol:sym,name:sym+' Token'},
 quoteToken:{address:WETH},priceUsd:'100',volume:{h1:40000,h6:300000,h24:1200000},liquidity:{usd:2.5e7},txns:{h1:{buys:20,sells:18},h6:{buys:150,sells:140},h24:{buys:600,sells:560}},
 priceChange:{h24:1.2},pairCreatedAt:NOW-900*DAY,info:{imageUrl:'https://cdn.dexscreener.com/cms/images/'+sym.toLowerCase()+'.png'},...o});

test('V5-12. universe intake: exact registry contracts need two-indexer symbol agreement; no market or mismatch is rejected; bounded calls',async()=>{
 const calls=[];
 const fetcher=providers({calls,explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'101',holders_count:'190000'},[LINK]:{symbol:'LINK',name:'ChainLink Token',exchange_rate:'100',holders_count:'800000'},
  [UNI]:{symbol:'UNI',name:'Uniswap',exchange_rate:'100'}},
  pairs:[pair(AAVE,'AAVE'),pair(LINK,'LINKX'),pair(UNI,'UNI',{priceUsd:'160'})]});
 F._reset();
 const {rows,report}=await U.discover({network:'ethereum',fetcher,now:NOW,o:{fetcher},dexTokens:require('../lib/radar-v2/dexscreener').tokens,maxCandidates:40});
 const by=a=>rows.find(r=>r.address===a);
 assert.equal(by(AAVE).universe.identity.status,'TWO_SOURCE_SYMBOL_MATCH');assert.equal(by(AAVE).v3.verification.crossCheck,'MATCHED');
 assert.equal(by(AAVE).liquidityUsd,2.5e7);assert.equal(by(AAVE).buys24h,600);assert.equal(by(AAVE).logo.source,'DEX Screener');
 assert.equal(by(LINK),undefined,'DEX symbol differs from the explorer record: rejected, never corrected');
 assert.equal(by(UNI).v3.verification.crossCheck,'CONFLICT','60% price disagreement is a conflict');
 assert.ok(report.rejected.IDENTITY_MISMATCH>=1);assert.ok(report.rejected.NO_DEX_MARKET>=1,'registry contracts without a DEX market are reported');
 assert.equal(report.dexCalls,1,'one batched DEX Screener request for <=30 contracts');
 assert.ok(calls.filter(u=>/blockscout/.test(u)).length<=1+report.registryListed,'bounded explorer reads');
 assert.ok(calls.every(u=>!/arc\.io|robinhoodchain/.test(u)),'Ethereum intake never touches another chain');
});

test('V5-13. end-to-end: universe rows go through the unchanged V4 gates; a corroborated A-class contract is ranked, a conflicting one is not; nothing crosses chains',async()=>{
 F._reset();E._clearCache();
 const fetcher=providers({explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'101'},[UNI]:{symbol:'UNI',name:'Uniswap',exchange_rate:'100'}},
  pairs:[pair(AAVE,'AAVE'),pair(UNI,'UNI',{priceUsd:'160'})]});
 const sec=(network)=>({ok:true,network,chainId:CID[network],asOf:iso(0.01),freshness:'FRESH',tokens:[],excluded:[],nearMiss:[],discovery:{uniqueCandidates:0}});
 const r=await E.run({sections:{ethereum:sec('ethereum'),arc:sec('arc')},now:NOW,env:{},fetcher:async()=>{throw Error('offline');},rpc:{},
  registryDoc:{schema:'arcy-radar-project-registry/1',version:'t',projects:[]},limits:{concurrency:1,pace:false,universeFetcher:fetcher}});
 const eth=r.networks.ethereum;
 assert.deepEqual(eth.displayCandidates.map(x=>x.symbol),['AAVE']);
 const aave=eth.displayCandidates[0];
 assert.equal(aave.discoveryTier,'ESTABLISHED');assert.equal(aave.eligibility,'QUALITY_EXPANSION_REVIEW');
 assert.equal(eth.display.filterB.droppedByReason.B_SOURCE_CONFLICT,1,'UNI with a price conflict stays out');
 assert.equal(r.networks.arc.displayCandidates.length,0,'Arc is never filled with Ethereum contracts');
 assert.equal(r.networks.arc.universe.explorer,'INTEL_PROVIDER_UNAVAILABLE');
 const snap=S.build(r,{ethereum:sec('ethereum'),arc:sec('arc')},{now:NOW,commit:'t'});
 assert.deepEqual(S.validate(snap),{ok:true});
 const row=snap.sections.ethereum.rows[0];
 assert.equal(row.priceUsd,100);assert.equal(row.liquidityUsd,2.5e7);assert.equal(row.opportunity.universe.identity.status,'TWO_SOURCE_SYMBOL_MATCH');
 assert.equal(row.logo.url,'https://cdn.dexscreener.com/cms/images/aave.png');
 // without an explicit builder fetcher there is no universe intake (visitor requests never run it)
 F._reset();E._clearCache();
 const off=await E.run({sections:{ethereum:sec('ethereum')},now:NOW,env:{},fetcher:async()=>{throw Error('offline');},rpc:{},registryDoc:{schema:'arcy-radar-project-registry/1',version:'t',projects:[]},limits:{concurrency:1,pace:false}});
 assert.equal(off.networks.ethereum.displayCandidates.length,0);
});

test('V5-14. Robinhood universe never re-lists a factory-verified Pons launch; Pons gets no universe intake',async()=>{
 const PONS_TOKEN=A(0x777);
 F._reset();
 const fetcher=async u=>{u=String(u);const res=b=>({ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify(b)});
  if(/tokens\?type=ERC-20/.test(u))return res({items:[{address_hash:PONS_TOKEN,symbol:'LAUNCH',name:'Launch',type:'ERC-20'}]});return res([]);};
 const {report}=await U.discover({network:'robinhood',fetcher,now:NOW,o:{fetcher},exclude:new Set([PONS_TOKEN]),dexTokens:require('../lib/radar-v2/dexscreener').tokens});
 assert.equal(report.rejected.PONS_LAUNCH_ROUTED,1);
 const p=await U.discover({network:'pons',fetcher,now:NOW,o:{fetcher},dexTokens:async()=>new Map()});
 assert.equal(p.report.explorer,'NOT_APPLICABLE');
});

test('V5-15. extreme 24h moves are not shown on Robinhood or Pons either; monitor rows need corroborated identity, not a logo',()=>{
 const Q=require('../lib/radar-v2/intel/discovery-quality');
 for(const network of ['robinhood','pons']){
  assert.equal(Q.reason({change24hPct:-71},network),'EXTREME_DRAWDOWN_24H',network+' WOOD-like crash');
  assert.equal(Q.reason({change24hPct:238},network),'ALREADY_SPIKED_24H');
  assert.equal(Q.reason({change24hPct:-34},network),'PRICE_NOT_OBSERVED','no market prices means no premium observation');
  assert.equal(Q.reason({change24hPct:-34,priceUsd:1,liquidityUsd:30000,volume24hUsd:12000,discoveryClass:'QUALIFIED'},network),null,'ordinary decline with adequate verified market data is observable');
  assert.equal(Q.reason({change24hPct:1,artwork:null,discoveryClass:'MONITOR_ONLY'},network),'PRICE_NOT_OBSERVED','no market is not a verified observation');
  assert.equal(Q.reason({change24hPct:1,priceUsd:1,liquidityUsd:30000,volume24hUsd:12000,artwork:null,discoveryClass:'MONITOR_ONLY'},network),'PRELIMINARY_WATCH_NOT_MAIN_RANKING','anonymous monitor never enters main ranking');
  assert.equal(Q.reason({change24hPct:1,priceUsd:1,liquidityUsd:30000,volume24hUsd:12000,artwork:null,discoveryClass:'MONITOR_ONLY',v3Verification:{crossCheck:'MATCHED'},poolCreatedAt:iso(40),snapshotNow:NOW},network),'PRELIMINARY_WATCH_NOT_MAIN_RANKING','even corroborated monitor stays outside premium list');
 }
});

test('V5-16. a Robinhood monitor row may not carry the ticker of a different factory-verified Pons launch (same-chain look-alike)',()=>{
 const pons=new Map([['gato',new Set([A(900)])]]);
 const look=early('robinhood',901,{symbol:'GATO',discoveryClass:'MONITOR_ONLY',nearMatch:{passed:[],pending:['POOL_UNDER_24H'],maxDistance:0.3}});
 const same=early('robinhood',900,{symbol:'GATO',discoveryClass:'MONITOR_ONLY',nearMatch:{passed:[],pending:[],maxDistance:0.3}});
 const out=E.selectDisplay([look,early('robinhood',902,{symbol:'DCTY'})],{network:'robinhood',now:NOW,foreignTickers:pons});
 assert.deepEqual(out.map(x=>x.address),[A(902)]);
 assert.equal(out.shortfall.droppedByReason.DUPLICATE_TICKER_CROSS_SECTION,1);
 // The exact factory contract itself is not a look-alike; as a monitor it is WATCH_ONLY (never main), as a qualified row it lists.
 const sm=E.selectDisplay([same],{network:'robinhood',now:NOW,foreignTickers:pons});
 assert.equal(sm.length,0);assert.deepEqual(sm.watch[0].reasons,['MONITOR_ONLY_CLASS']);
 assert.equal(E.selectDisplay([{...same,discoveryClass:'QUALIFIED'}],{network:'robinhood',now:NOW,foreignTickers:pons}).length,1);
});

test('V5-17. a contract named after GameStop is an unverified issuer brand, not a discovery',()=>{
 assert.equal(D.unverifiedIssuerBrand({name:'GameStop',symbol:'GME'}).reason,'ISSUER_AFFILIATION_NOT_VERIFIED');
 assert.equal(D.unverifiedIssuerBrand({name:'Game Stopper Cat',symbol:'GSC'}),null);
 assert.equal(D.unverifiedIssuerBrand({name:'Greatest Meme Ever',symbol:'GME'}).reason,'ISSUER_AFFILIATION_NOT_VERIFIED','stock ticker on the tokenized-equity chain');
});

test('V5-18. registry: exact lowercase contracts, unique, Ethereum only; every listing is categorised as established (never early)',()=>{
 const C=require('../lib/radar-v2/intel/category');
 const list=U.registryFor(1);
 assert.ok(list.length>=20);
 assert.equal(new Set(list.map(e=>e.address)).size,list.length);
 for(const e of list){assert.match(e.address,/^0x[0-9a-f]{40}$/);assert.notEqual(C.classify({chainId:1,address:e.address,symbol:e.symbol},'ethereum').category,'EARLY_STAGE_CANDIDATE',e.symbol);}
 assert.equal(U.registryFor(5042).length,0,'no Arc listing without Arc evidence');assert.equal(U.registryFor(4663).length,0);
 for(const sym of ['USDC','USDT','DAI','WETH','WBTC','PEPE','SHIB'])assert.ok(!list.some(e=>e.symbol===sym),sym+' is not an A-class research candidate');
});

test('V5-19. a listed contract already in the Radar window is enriched with two-indexer identity instead of being re-added',async()=>{
 F._reset();
 const fetcher=providers({explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'101'}},pairs:[pair(AAVE,'AAVE')]});
 const {rows,enrich,report}=await U.discover({network:'ethereum',fetcher,now:NOW,o:{fetcher},existing:new Set([AAVE]),dexTokens:require('../lib/radar-v2/dexscreener').tokens});
 assert.equal(rows.some(r=>r.address===AAVE),false,'never duplicated');
 assert.equal(enrich.get(AAVE).identity.status,'TWO_SOURCE_SYMBOL_MATCH');assert.equal(report.enriched,1);
 assert.equal(QX.tierOf(est('ethereum',5,{sourceEvidence:{crossCheck:null},universe:enrich.get(AAVE)})),'ESTABLISHED');
});

test('V5-20. listed contracts use the complete per-token pool listing (batched lists under-count large tokens); calls stay bounded',async()=>{
 F._reset();require('../lib/radar-v2/http')._resetCooldowns();
 const calls=[];
 // batched endpoint returns only a small pool; the per-token listing returns the deep pools as well
 const small=pair(AAVE,'AAVE',{pairAddress:A(0xa1),liquidity:{usd:50000},volume:{h1:10,h6:60,h24:300}});
 const deep=[pair(AAVE,'AAVE',{pairAddress:A(0xa2)}),pair(AAVE,'AAVE',{pairAddress:A(0xa3),liquidity:{usd:5e6}})];
 const base=providers({calls,explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'100'}},pairs:[small]});
 const fetcher=async u=>{u=String(u);if(/token-pairs\/v1/.test(u)){calls.push(u);return {ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify([small,...deep])};}return base(u);};
 const dex=require('../lib/radar-v2/dexscreener');
 const {rows,report}=await U.discover({network:'ethereum',fetcher,now:NOW,o:{fetcher},dexTokens:dex.tokens,dexTokenPairs:dex.tokenPairs,maxPairLookups:30});
 const aave=rows.find(r=>r.address===AAVE);
 assert.equal(aave.liquidityUsd,50000+2.5e7+5e6,'all base pools of the exact contract are summed');
 assert.equal(aave.poolCount,3);
 assert.ok(report.dexCalls<=U.registryFor(1).length+1,'one per listed contract plus at most one batch');
});

test('V5-21. pools that do not report volume/liquidity are left out of a lower-bound sum (never estimated); oldest known pool dates the market',async()=>{
 F._reset();require('../lib/radar-v2/http')._resetCooldowns();
 const a=pair(AAVE,'AAVE',{pairAddress:A(0xb1),pairCreatedAt:undefined});
 const b=pair(AAVE,'AAVE',{pairAddress:A(0xb2),volume:{h24:null},liquidity:{usd:1e6},pairCreatedAt:NOW-400*DAY});
 const fetcher=providers({explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'100'}},pairs:[a,b]});
 const dex=require('../lib/radar-v2/dexscreener');
 const {rows}=await U.discover({network:'ethereum',fetcher,now:NOW,o:{fetcher},dexTokens:dex.tokens,dexTokenPairs:dex.tokenPairs});
 const r=rows.find(x=>x.address===AAVE);
 assert.equal(r.volume24hUsd,1200000,'only the reporting pool counts');assert.equal(r.liquidityUsd,2.5e7+1e6);
 assert.equal(r.poolCreatedAt,new Date(NOW-400*DAY).toISOString());
 assert.equal(r.universe.poolsReportingVolume,1);
});

test('V5-22. explorer artwork for the exact contract is used only from allow-listed image hosts; never from another contract',async()=>{
 F._reset();require('../lib/radar-v2/http')._resetCooldowns();
 const noImg=pair(AAVE,'AAVE',{info:{}});
 const ok=providers({explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'100',icon_url:'https://assets.coingecko.com/coins/images/12645/small/aave.png'}},pairs:[noImg]});
 const dex=require('../lib/radar-v2/dexscreener');
 let {rows}=await U.discover({network:'ethereum',fetcher:ok,now:NOW,o:{fetcher:ok},dexTokens:dex.tokens,dexTokenPairs:dex.tokenPairs});
 assert.deepEqual(rows.find(r=>r.address===AAVE).logo,{url:'https://assets.coingecko.com/coins/images/12645/small/aave.png',source:'Blockscout token record'});
 F._reset();
 const bad=providers({explorer:{[AAVE]:{symbol:'AAVE',name:'Aave Token',exchange_rate:'100',icon_url:'https://evil.example/aave.png'}},pairs:[noImg]});
 ({rows}=await U.discover({network:'ethereum',fetcher:bad,now:NOW,o:{fetcher:bad},dexTokens:dex.tokens,dexTokenPairs:dex.tokenPairs}));
 assert.equal(rows.find(r=>r.address===AAVE).logo,null,'non-allow-listed host is dropped, row still evaluated');
});

test('V5-23. observed 2026-11-20 Robinhood rows: WANTED (+1280%), RUGPULL (+575%, self-declared), Maxxing (<24h, uncorroborated) never shown',()=>{
 const Q=require('../lib/radar-v2/intel/discovery-quality'),C=require('../lib/radar-v2/intel/category');
 const young=iso(0.2);
 const wanted=early('robinhood',951,{symbol:'WANTED',change24hPct:1280.3,discoveryClass:'MONITOR_ONLY',poolCreatedAt:young,artwork:null,v3Verification:null,sourceEvidence:null});
 const maxx=early('robinhood',952,{symbol:'Maxxing',change24hPct:47.9,discoveryClass:'MONITOR_ONLY',poolCreatedAt:young,artwork:null,v3Verification:null,sourceEvidence:null,universe:null});
 assert.equal(Q.reason(wanted,'robinhood'),'ALREADY_SPIKED_24H');
 assert.equal(Q.reason(maxx,'robinhood'),'PRELIMINARY_WATCH_NOT_MAIN_RANKING');
 assert.equal(Q.reason({...maxx,v3Verification:{crossCheck:'MATCHED'}},'robinhood'),'PRELIMINARY_WATCH_NOT_MAIN_RANKING','even corroborated, no MONITOR_ONLY row can enter the premium shortlist');
 assert.equal(C.classify({chainId:4663,address:A(953),symbol:'RUGPULL',name:"It's a fucking rugpull"},'robinhood').category,'SELF_DECLARED_RUG_OR_SCAM');
 assert.equal(C.classify({chainId:1,address:A(954),symbol:'HPOT',name:'Honey Pot Inu'},'ethereum').category,'SELF_DECLARED_RUG_OR_SCAM');
 assert.equal(C.classify({chainId:1,address:A(955),symbol:'DRUG',name:'Drugstore'},'ethereum').category,'EARLY_STAGE_CANDIDATE','literal words only, no substring matches');
 assert.ok(C.BLOCKED.has('SELF_DECLARED_RUG_OR_SCAM'));
 const out=E.selectDisplay([wanted,maxx],{network:'robinhood',now:NOW});assert.equal(out.length,0);
});
