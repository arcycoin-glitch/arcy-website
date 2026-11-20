'use strict';
// Radar V5 final (#279): persistent market memory, identity levels, research profile, research tiers (QUALIFIED / CANDIDATE /
// WATCH_ONLY) and the failure conditions around them. Fixtures carry the evidence a real engine row carries; every test below also
// checks the failure path (what must NOT reach the main ranking), not only the happy path.
const test=require('node:test'),assert=require('node:assert/strict');
// V5-level selection semantics (v6:false). The V6 layer (#279: profile completeness >= 60, compression, integrity, rank-3) can only
// move rows from the main list to WATCH_ONLY or reorder them, never add one; its behaviour is tested in test/radar-v6-top10.test.js.
const E0=require('../lib/radar-v2/intel/engine'),E={...E0,selectDisplay:(r,o={})=>E0.selectDisplay(r,{v6:false,...o}),run:(a={})=>E0.run({...a,limits:{v6:false,...(a.limits||{})}})};
const MM=require('../lib/radar-v2/intel/market-memory'),RS=require('../lib/radar-v2/intel/research');
const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds');
const DAY=86400000,H=3600000,NOW=Date.parse('2026-11-20T10:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
const CID={arc:5042,ethereum:1,robinhood:4663,pons:4663};
const ART={url:'https://assets.geckoterminal.com/v5-final-fixture',source:'GeckoTerminal'};
const REVIEW=['DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED','PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED','EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED'];
const act=()=>({source:'GeckoTerminal pool windows',volumeUsd:{h1:50000,h6:300000,h24:1200000},trades:{h1:40,h6:300,h24:900},buyers:{h24:260},sellers:{h24:210}});
const TOLLY='0xbc43ce8dec648ea298c4275559b81d6261c90b67'; // Arc explorer: TOLLY linked to market data (canonical-identity.json)
// Memory built from real-shaped observations (one per builder run), assessed exactly as the engine does.
function history(key,obs){const m=MM.empty();for(const o of obs)MM.observe(m,key,o);return {mem:m,h:MM.assess(m,key,NOW)};}
const steady=key=>history(key,[{at:NOW-2*DAY,priceUsd:0.2,change24hPct:3,liquidityUsd:400000,volume24hUsd:300000},{at:NOW,priceUsd:0.21,change24hPct:2,liquidityUsd:410000,volume24hUsd:300000}]).h;
const row=(network,n,o={})=>{const key=CID[network]+':'+A(n);return {key,network,chainId:CID[network],address:A(n),symbol:'E'+n,eligibility:'REVIEW',reasons:[...REVIEW],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:0.2,liquidityUsd:400000,volume24hUsd:300000,change24hPct:3,trades24h:200,buys24h:100,sells24h:100,
 poolCreatedAt:iso(40),snapshotNow:NOW,artwork:ART,category:{category:'EARLY_STAGE_CANDIDATE',basis:'NO_NON_EARLY_SIGNAL'},
 v3Verification:{crossCheck:'MATCHED'},sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:2,of:3},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},history:steady(key),
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:30,dimensions:{product:0,team:0,adoption:0},flags:[]},evidenceConfidence:{score:30,missing:['EXIT']},infoV4:'x',...o};};
const est=(network,n,o={})=>row(network,n,{symbol:'B'+n,name:'Blue '+n,eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY',...REVIEW],priceUsd:12,liquidityUsd:8e6,volume24hUsd:3e6,
 change24hPct:2.5,trades24h:900,buys24h:470,sells24h:430,pairCount:4,poolCreatedAt:iso(700),activity:act(),category:{category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST',detail:'fixture'},
 sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:3,of:3,sourcesDisagree:false},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'},registry:{project:'Blue',kind:'LENDING_GOVERNANCE'}},
 opportunity:{score:10,dimensions:{product:null,team:null,adoption:null},flags:[]},evidenceConfidence:{score:10,missing:[]},evidenceSummary:{risk:{}},...o});
// A pump observed in an earlier run, followed by an ordinary-looking 24h change today (the 24h window has reset).
const pumped=(key,peak,{at=NOW-3*DAY,price=[0.01,0.12,0.1]}={})=>history(key,[
 {at:at-DAY,priceUsd:price[0],change24hPct:4,liquidityUsd:90000,volume24hUsd:50000},
 {at,priceUsd:price[1],change24hPct:peak,liquidityUsd:120000,volume24hUsd:900000},
 {at:NOW,priceUsd:price[2],change24hPct:-3,liquidityUsd:110000,volume24hUsd:80000}]).h;

test('F-1. WANTED (+1,280%) and RUGPULL (+575%) stay WATCH_ONLY after their 24h window resets to an ordinary change',()=>{
 for(const [symbol,peak,n] of [['WANTED',1280.3,951],['RUGPULL',575.2,953]]){
  const key=CID.robinhood+':'+A(n),h=pumped(key,peak);
  assert.ok(h.flags.includes('EXTREME_24H_RISE_OBSERVED'),symbol);assert.equal(h.peak24hRisePct,peak);
  const r=row('robinhood',n,{symbol,change24hPct:-3,liquidityUsd:110000,volume24hUsd:80000,history:h});
  const out=E.selectDisplay([r],{network:'robinhood',now:NOW});
  assert.equal(out.length,0,symbol+' must not re-enter the main list once today\'s 24h change looks normal');
  assert.ok(out.watch[0].reasons.includes('HISTORICAL_EXTREME_MOVE'),symbol);
  // control: the same row without the remembered pump would be listed — the memory alone is what keeps it out
  assert.equal(E.selectDisplay([{...r,history:steady(key)}],{network:'robinhood',now:NOW}).length,1);
 }
});

test('F-2. SHARK, Gamooor and Louie (+199..+239% observed on Arc) are remembered after the reset; WASTED run-up multiple is caught without a 24h spike',()=>{
 for(const [symbol,peak,n] of [['SHARK',238.712,11],['Gamooor',202.725,12],['Louie',199.526,13]]){
  const h=pumped(CID.arc+':'+A(n),peak);
  const out=E.selectDisplay([row('arc',n,{symbol,liquidityUsd:60000,volume24hUsd:20000,history:h})],{network:'arc',now:NOW});
  assert.equal(out.length,0,symbol);assert.ok(out.watch[0].reasons.includes('HISTORICAL_EXTREME_MOVE'),symbol);
 }
 // WASTED: no single 24h reading above +70% in memory, but the observed price went 0.001 -> 0.3 (300x) across runs.
 const key=CID.ethereum+':'+A(14);
 const {h}=history(key,[0,1,2,3,4].map(i=>({at:NOW-(4-i)*DAY,priceUsd:[0.001,0.01,0.05,0.2,0.3][i],change24hPct:[5,60,55,65,8][i],liquidityUsd:300000,volume24hUsd:200000})));
 assert.equal(h.flags.includes('EXTREME_24H_RISE_OBSERVED'),false);assert.ok(h.flags.includes('PRICE_RUNUP_MULTIPLE_OBSERVED'));assert.equal(h.maxRunupMultiple,300);
 const out=E.selectDisplay([row('ethereum',14,{symbol:'WASTED',change24hPct:8,history:h})],{network:'ethereum',now:NOW});
 assert.equal(out.length,0);assert.ok(out.watch[0].reasons.includes('HISTORICAL_EXTREME_MOVE'));
 // a collapse from peak is remembered too
 const c=history(CID.arc+':'+A(15),[{at:NOW-3*DAY,priceUsd:1,change24hPct:5},{at:NOW,priceUsd:0.3,change24hPct:-20}]).h;
 assert.ok(c.flags.includes('COLLAPSE_FROM_PEAK_OBSERVED'));
});

test('F-3. an ESTABLISHED project keeps a remembered extreme move as context only; Info states it without a forecast',()=>{
 const h=pumped(CID.ethereum+':'+A(50),85,{price:[10,14,13]});
 const out=E.selectDisplay([est('ethereum',50,{history:h})],{network:'ethereum',now:NOW});
 assert.equal(out.length,1);assert.equal(out[0].discoveryTier,'ESTABLISHED');
 assert.match(out[0].infoV4,/Geçmiş: 3 gözlem/);assert.match(out[0].infoV4,/en yüksek 24s değişim \+85/);
 assert.doesNotMatch(out[0].infoV4,/güvenli(?!k)|\bsafe\b|garanti(?!si değildir)|yükselecek/i);
});

test('F-4. market memory persistence: corrupt input resets, observations are deduplicated, bounded, pruned and backfilled — never fabricated',()=>{
 for(const bad of [null,{},{version:'x',entries:{}},{version:MM.VERSION,entries:'nope'}])assert.deepEqual(MM.load(bad).entries,{});
 const partial=MM.load({version:MM.VERSION,entries:{'bad-key':{o:[[1,1,1,1,1]]},['1:'+A(1)]:{s:'X',o:[[NOW,'1',0,0,0],[NOW,1,2,3,4]]}}});
 assert.deepEqual(Object.keys(partial.entries),['1:'+A(1)]);assert.equal(partial.entries['1:'+A(1)].o.length,1,'malformed tuples dropped');
 const m=MM.empty(),k='1:'+A(2);
 assert.equal(MM.observe(m,k,{at:NOW,priceUsd:1}),true);
 assert.equal(MM.observe(m,k,{at:NOW+10*60000,priceUsd:1}),false,'two runs inside 30 min are one observation');
 assert.equal(MM.observe(m,k,{at:NOW+H}),false,'no market fact, no observation');
 assert.equal(MM.observe(m,'1:0xNOTHEX',{at:NOW,priceUsd:1}),false);
 for(let i=1;i<=200;i++)MM.observe(m,k,{at:NOW+i*H,priceUsd:1});
 assert.ok(m.entries[k].o.length<=MM.T.MAX_OBS);
 MM.prune(m,NOW+60*DAY);assert.equal(m.entries[k],undefined,'older than retention is removed');
 assert.deepEqual(MM.validate(m),{ok:true});
 assert.equal(MM.validate({version:MM.VERSION,entries:{x:{o:[]}}}).ok,false);
 // single observation: no 7d/30d claim, no run-up, no growth
 const one=history('1:'+A(3),[{at:NOW,priceUsd:1,change24hPct:2}]).h;
 assert.equal(one.coverage,'SINGLE_OBSERVATION');assert.equal(one.maxRunupMultiple,null);assert.equal(one.growth,null);
 // backfill reads published rows and the published watchlist with their own timestamps
 const snap={sections:{robinhood:{asOf:iso(3),rows:[{address:A(951),symbol:'WANTED',priceUsd:0.1,change24hPct:1280,measuredAt:iso(3)}],
  presentation:{watchlist:[{address:A(953),symbol:'RUGPULL',priceUsd:0.2,change24hPct:575}]}}}};
 const b=MM.empty();assert.equal(MM.backfill(b,[snap,snap]),2,'same snapshot twice adds nothing new');
 assert.ok(MM.assess(b,'4663:'+A(951),NOW).flags.includes('EXTREME_24H_RISE_OBSERVED'));
 assert.ok(MM.assess(b,'4663:'+A(953),NOW).flags.includes('EXTREME_24H_RISE_OBSERVED'));
 // an event older than the 14-day history window no longer flags
 assert.deepEqual(MM.assess(b,'4663:'+A(951),NOW+20*DAY).flags,[]);
});

test('F-5. growth means observed increasing activity across >=72h, not pool age',()=>{
 const k='5042:'+A(20);
 const g=history(k,[{at:NOW-96*H,priceUsd:1,change24hPct:1,liquidityUsd:100000,volume24hUsd:20000},{at:NOW,priceUsd:1.1,change24hPct:2,liquidityUsd:140000,volume24hUsd:30000}]).h;
 assert.ok(g.flags.includes('ACTIVITY_GROWTH_OBSERVED'));assert.equal(g.growth.liquidityPct,40);
 const short=history(k,[{at:NOW-48*H,priceUsd:1,liquidityUsd:100000,volume24hUsd:20000},{at:NOW,priceUsd:1,liquidityUsd:300000,volume24hUsd:90000}]).h;
 assert.equal(short.flags.includes('ACTIVITY_GROWTH_OBSERVED'),false,'two days is not enough span');
 const fall=history(k,[{at:NOW-96*H,priceUsd:1,liquidityUsd:100000,volume24hUsd:20000},{at:NOW,priceUsd:1,liquidityUsd:70000,volume24hUsd:60000}]).h;
 assert.equal(fall.flags.includes('ACTIVITY_GROWTH_OBSERVED'),false,'volume up while liquidity drains is not growth');
 assert.equal(RS.layer({poolCreatedAt:iso(400)},{history:steady(k),now:NOW}),'MATURE');
 assert.equal(RS.layer({poolCreatedAt:iso(400)},{history:g,now:NOW}),'GROWTH');
 assert.equal(RS.layer({poolCreatedAt:iso(10)},{history:g,now:NOW}),'EARLY');
});

test('F-6. identity levels: canonical listing, ticker impersonation, fake branding, conflict, official dossier, wrong chain, expiry',()=>{
 const base={chainId:5042,network:'arc',symbol:'TOLLY',reasons:[],category:{category:'EARLY_STAGE_CANDIDATE'}};
 assert.equal(RS.identityLevel({...base,address:TOLLY},{now:NOW}).level,'METADATA_CROSS_CORROBORATED');
 const copy=RS.identityLevel({...base,address:A(0x7011),v3Verification:{crossCheck:'MATCHED'}},{now:NOW});
 assert.equal(copy.level,'IMPERSONATION_EVIDENCE','a second TOLLY contract is a look-alike even if indexers observe it');
 assert.match(copy.evidence[0],new RegExp(TOLLY));
 // a ticker with several listed contracts (USDC on Arc) gives no one ownership and no canonical corroboration
 const usdc=RS.identityLevel({chainId:5042,network:'arc',symbol:'USDC',address:'0x3600000000000000000000000000000000000000',reasons:[]},{now:NOW});
 assert.notEqual(usdc.level,'IMPERSONATION_EVIDENCE');assert.notEqual(usdc.level,'METADATA_CROSS_CORROBORATED');
 assert.equal(RS.identityLevel({...base,symbol:'GME',address:A(1),reasons:['ISSUER_AFFILIATION_NOT_VERIFIED']},{now:NOW}).level,'IMPERSONATION_EVIDENCE');
 assert.equal(RS.identityLevel({...base,symbol:'RUGPULL',address:A(2),category:{category:'SELF_DECLARED_RUG_OR_SCAM'}},{now:NOW}).level,'IMPERSONATION_EVIDENCE');
 assert.equal(RS.identityLevel({...base,symbol:'ZZ',address:A(3),sourceEvidence:{crossCheck:'CONFLICT'},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}}},{now:NOW}).level,'IDENTITY_SOURCE_CONFLICT');
 assert.equal(RS.identityLevel({...base,symbol:'ZZ',address:A(4),dossier:{status:'PRIMARY_SOURCE_VERIFIED',siteShowsExactAddress:true,officialSite:'https://zz.example'}},{now:NOW}).level,'OFFICIAL_CONTRACT_VERIFIED');
 assert.notEqual(RS.identityLevel({...base,symbol:'ZZ',address:A(5),dossier:{status:'PRIMARY_SOURCE_VERIFIED',siteShowsExactAddress:false}},{now:NOW}).level,'OFFICIAL_CONTRACT_VERIFIED','an official site without the exact address is not official contract identity');
 // the same address on another chain is not the Arc listing (wrong-chain official contract)
 assert.equal(RS.identityLevel({...base,chainId:1,network:'ethereum',address:TOLLY,symbol:'TOLLY'},{now:NOW}).level,'OFFICIAL_IDENTITY_UNESTABLISHED');
 assert.equal(RS.identityLevel({...base,symbol:'ZZ',address:A(6),v3Verification:{crossCheck:'MATCHED'}},{now:NOW}).level,'EXACT_CONTRACT_OBSERVED');
 assert.equal(RS.identityLevel({...base,symbol:'ZZ',address:A(7)},{now:NOW}).level,'OFFICIAL_IDENTITY_UNESTABLISHED');
 // the captured explorer index expires; it is never treated as permanent truth
 assert.equal(RS.canonical(5042,TOLLY,Date.parse('2027-02-01T00:00:00Z')),null);
 // a symbol agreement or registry entry never reaches OFFICIAL
 assert.equal(RS.identityLevel({...base,symbol:'ZZ',address:A(8),universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'},registry:{project:'Z',kind:'DEX_GOVERNANCE'}}},{now:NOW}).level,'METADATA_CROSS_CORROBORATED');
});

test('F-7. impersonation and unestablished identity never reach the main ranking, whatever their market quality',()=>{
 const copy=row('arc',0x7011,{symbol:'TOLLY',liquidityUsd:5e6,volume24hUsd:1e6});
 const anon=row('arc',0x7012,{symbol:'ANON',universe:null,v3Verification:null,sourceEvidence:null});
 const out=E.selectDisplay([copy,anon],{network:'arc',now:NOW});
 assert.equal(out.length,0);
 assert.deepEqual(out.watch.map(w=>w.identity).sort(),['IMPERSONATION_EVIDENCE','OFFICIAL_IDENTITY_UNESTABLISHED']);
});

test('F-8. research profile: completeness is evidence coverage, never security; no X account is ever inferred; PARTIAL without X/docs is possible',()=>{
 const r=est('ethereum',30);const identity=RS.identityLevel(r,{now:NOW});
 const p=RS.profile(r,{network:'ethereum',now:NOW,identity,history:r.history});
 assert.equal(p.sections.officialX.status,'NOT_AVAILABLE');assert.equal(p.sections.documentation.status,'NOT_AVAILABLE');
 assert.ok(p.missing.includes('officialX')&&p.missing.includes('documentation'));
 assert.ok(['PARTIAL','COMPLETE'].includes(p.level));assert.match(p.note,/not a security assessment/);
 const bare=row('arc',31,{universe:null,v3Verification:null,sourceEvidence:null,history:null,liquidityUsd:null});
 const bp=RS.profile(bare,{network:'arc',now:NOW,identity:RS.identityLevel(bare,{now:NOW}),history:null});
 assert.equal(bp.level,'MINIMAL');
 // a minimal profile is WATCH_ONLY even with corroborated identity and good liquidity
 const thin=row('arc',32,{history:null,liquidityUsd:500000,volume24hUsd:null});
 const out=E.selectDisplay([thin],{network:'arc',now:NOW});
 assert.equal(out.length,0);assert.ok(out.watch[0].reasons.includes('RESEARCH_PROFILE_MINIMAL'));
});

test('F-9. Pons: factory verification is not market depth — a thin-liquidity verified launch is WATCH_ONLY',()=>{
 const launch={status:'ONCHAIN_VERIFIED',factory:'fixture'};
 const thin=row('pons',40,{symbol:'MORI',liquidityUsd:3000,volume24hUsd:900,launch,universe:null});
 assert.equal(RS.identityLevel(thin,{now:NOW}).level,'METADATA_CROSS_CORROBORATED');
 const out=E.selectDisplay([thin],{network:'pons',now:NOW});
 assert.equal(out.length,0);assert.ok(out.watch[0].reasons.includes('LIQUIDITY_BELOW_RESEARCH_FLOOR'));
 assert.equal(E.selectDisplay([{...thin,liquidityUsd:RS.RESEARCH_LIQUIDITY.pons,volume24hUsd:12000}],{network:'pons',now:NOW}).length,1,'P0 requires sufficient volume as well as liquidity');
 for(const n of ['ethereum','arc','robinhood','pons'])assert.ok(RS.RESEARCH_LIQUIDITY[n]>0);
});

test('F-10. ten slots are never filled with WATCH_ONLY: 12 monitor rows give an empty main list and a bounded watch list',()=>{
 const rows=Array.from({length:12},(_,i)=>row('arc',100+i,{discoveryClass:'MONITOR_ONLY',nearMatch:{passed:[],pending:['POOL_AGE_UNKNOWN'],maxDistance:0.4}}));
 const out=E.selectDisplay(rows,{network:'arc',now:NOW});
 assert.equal(out.length,0);assert.equal(out.watch.length,10);
 assert.ok(out.watch.every(w=>w.reasons.includes('MONITOR_ONLY_CLASS')));
 assert.ok(Object.keys(out.shortfall.droppedByReason).some(k=>k.startsWith('WATCH_ONLY_')));
 const mixed=E.selectDisplay([...rows,row('arc',200)],{network:'arc',now:NOW});
 assert.deepEqual(mixed.map(x=>x.address),[A(200)],'one research row lists; the monitors stay out');
});

test('F-11. research ranking is stable: input order never changes the result; QUALIFIED precedes CANDIDATE',()=>{
 const rows=[est('ethereum',60),row('ethereum',61),row('ethereum',62,{liquidityUsd:250000}),est('ethereum',63,{liquidityUsd:3e6}),row('ethereum',64,{eligibility:'ELIGIBLE',reasons:[]})];
 const ref=E.selectDisplay(rows.map(r=>structuredClone(r)),{network:'ethereum',now:NOW}).map(x=>x.address);
 for(let i=0;i<6;i++){const sh=rows.map(r=>structuredClone(r)).sort(()=>Math.random()-0.5);assert.deepEqual(E.selectDisplay(sh,{network:'ethereum',now:NOW}).map(x=>x.address),ref);}
 const out=E.selectDisplay(rows,{network:'ethereum',now:NOW});
 const order={RESEARCH_QUALIFIED:0,RESEARCH_CANDIDATE:1};
 for(let i=1;i<out.length;i++)assert.ok(order[out[i-1].researchTier]<=order[out[i].researchTier]);
 out.forEach((x,i)=>assert.equal(x.researchRank.position,i+1));
});

test('F-12. snapshot publishes research fields; carried-forward rows with a remembered pump are removed on the next run',()=>{
 const display=E.selectDisplay([est('ethereum',70),row('ethereum',71)],{network:'ethereum',now:NOW});
 const engine={networks:{ethereum:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{},display:{shown:2,byClass:display.byClass,byTier:display.byTier},all:[]}},riskLedger:null};
 const snap=S.build(engine,{ethereum:{tokens:[],nearMiss:[],excluded:[],asOf:iso(0.01)}},{now:NOW,commit:'t'});
 assert.deepEqual(S.validate(snap),{ok:true});
 for(const r of snap.sections.ethereum.rows){
  const o=r.opportunity;assert.ok(['RESEARCH_QUALIFIED','RESEARCH_CANDIDATE'].includes(o.researchTier));
  assert.ok(['METADATA_CROSS_CORROBORATED','OFFICIAL_CONTRACT_VERIFIED'].includes(o.identityLevel));
  assert.ok(o.researchProfile&&o.researchProfile.level!=='MINIMAL');assert.ok(o.marketHistory);
 }
 // next run: Ethereum source failed (carry-forward) and memory now shows the Filter-A row pumped; the established row stays
 const prev=structuredClone(snap);prev.sections.ethereum.carriedForward=true;
 const {mem}=history('1:'+A(71),[{at:NOW-DAY,priceUsd:0.1,change24hPct:400},{at:NOW,priceUsd:0.2,change24hPct:2}]);
 MM.observe(mem,'1:'+A(70),{at:NOW-DAY,priceUsd:10,change24hPct:120});
 S.applyMemory(prev,mem,NOW);
 assert.deepEqual(prev.sections.ethereum.rows.map(r=>r.address),[A(70)]);
 assert.equal(prev.sections.ethereum.rows[0].rank,1);assert.deepEqual(S.validate(prev),{ok:true});
});

test('F-13. logos: canonical explorer icon only for the exact listed contract; a look-alike never borrows it; a logo never changes tier or rank',()=>{
 const C=RS.canonical(5042,TOLLY,NOW);assert.ok(C&&C.icon);
 const {candidateArtwork}=require('../lib/radar-v2/artwork-evidence');
 assert.equal(candidateArtwork({network:'arc',address:A(0x7011),logo:{url:'https://evil.example/tolly.png',source:'GeckoTerminal'}}),null);
 const withLogo=E.selectDisplay([row('arc',80)],{network:'arc',now:NOW}),noLogo=E.selectDisplay([row('arc',80,{artwork:null})],{network:'arc',now:NOW});
 assert.equal(withLogo[0].researchTier,noLogo[0].researchTier);assert.equal(withLogo[0].researchRank.quality,noLogo[0].researchRank.quality);
 assert.equal(RS.identityLevel(row('arc',81,{artwork:ART,universe:null,v3Verification:null,sourceEvidence:null}),{now:NOW}).level,'OFFICIAL_IDENTITY_UNESTABLISHED','a logo is not identity');
});

test('F-14. stale source data (Arc explorer 403 / provider outage / rate limit carry-forward) is WATCH_ONLY in a fresh ranking',()=>{
 const stale=row('arc',90,{radarFreshness:'STALE'});
 const out=E.selectDisplay([stale,row('arc',91,{radarFreshness:'FRESH'})],{network:'arc',now:NOW});
 assert.deepEqual(out.map(x=>x.address),[A(91)]);assert.ok(out.watch[0].reasons.includes('SOURCE_NOT_FRESH'));
 // a section that could not be built publishes no invented rows
 const next=S.merge(null,{schema:S.SCHEMA,opportunityVersion:S.OPPORTUNITY_VERSION,generatedAt:new Date(NOW).toISOString(),riskLedger:[],sections:{arc:{status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]}}});
 assert.equal((next?.sections?.arc?.rows||[]).length,0);
});

test('F-15. persistent risk holds (AF) stay out of both the main ranking and the published watch list',()=>{
 const AF='0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e',key='5042:'+AF;
 const held=new Set(RH.list(RH.initial(null)).filter(x=>x.state==='HELD').map(x=>x.key));assert.ok(held.has(key));
 const r={...row('arc',1),key,address:AF,symbol:'AF',liquidityUsd:5e7,volume24hUsd:5e6};
 const out=E.selectDisplay([r],{network:'arc',held,now:NOW});
 assert.equal(out.length,0);assert.equal(out.watch.some(w=>w.address===AF),false);
});

test('F-16. market sources that disagree (>3x on liquidity or volume) never yield RESEARCH_QUALIFIED; the lower depth decides the floor',()=>{
 // observed 2026-11-20 (Robinhood AI): GeckoTerminal token liquidity $1.42M vs DEX Screener $93k; volume $1.15M vs $54k
 const spread={liquidityUsd:{min:93487,max:1418484,ratio:15.17,providers:2,scope:'TOKEN'},volume24hUsd:{min:53960,max:1153646,ratio:21.38,providers:2,scope:'TOKEN'}};
 const ok=est('robinhood',300,{liquidityUsd:1418484,volume24hUsd:1153646});
 const base=E.selectDisplay([ok],{network:'robinhood',now:NOW});assert.equal(base[0].researchTier,'RESEARCH_QUALIFIED');
 const d=E.selectDisplay([{...ok,marketSpread:spread}],{network:'robinhood',now:NOW});
 assert.equal(d[0].researchTier,'RESEARCH_CANDIDATE');assert.deepEqual(d[0].researchTierReasons,['MARKET_SOURCES_DISAGREE_LIQUIDITY','MARKET_SOURCES_DISAGREE_VOLUME']);
 assert.match(d[0].infoV4,/piyasa kaynakları uyuşmuyor/);
 // when the lower provider value is below the research floor, the row is WATCH_ONLY even if the higher value clears it
 const thin=E.selectDisplay([{...ok,liquidityUsd:400000,marketSpread:{liquidityUsd:{min:9000,max:400000,ratio:44.4,providers:2}}}],{network:'robinhood',now:NOW});
 assert.equal(thin.length,0);assert.ok(thin.watch[0].reasons.includes('LIQUIDITY_BELOW_RESEARCH_FLOOR'));
 // observed 2026-11-20 (Ethereum AAVE): the second provider indexes only part of the pools (V3: PARTIAL_COVERAGE) — a lower bound,
 // not a contradiction: the floor uses the reported depth, but the spread still blocks QUALIFIED
 const part=E.selectDisplay([{...ok,marketSpread:{liquidityUsd:{min:9000,max:1418484,ratio:157.6,providers:2,partialCoverage:true}}}],{network:'robinhood',now:NOW});
 assert.equal(part[0].researchTier,'RESEARCH_CANDIDATE');assert.deepEqual(part[0].researchTierReasons,['MARKET_SOURCES_DISAGREE_LIQUIDITY']);
 // providers that agree change nothing
 const agree=E.selectDisplay([{...ok,marketSpread:{liquidityUsd:{min:1.3e6,max:1.42e6,ratio:1.09,providers:2}}}],{network:'robinhood',now:NOW});
 assert.equal(agree[0].researchTier,'RESEARCH_QUALIFIED');
});

test('F-17. Info fits the existing UI: at most 12 parts, the data time is always the last part shown (no frontend change)',()=>{
 const rows=[est('ethereum',400),row('ethereum',401,{eligibility:'ELIGIBLE',reasons:[],infoV4:'NİTELİKLİ — tüm sıralama eşiklerini geçti; a; b; c; d'}),
  row('ethereum',402,{marketSpread:{liquidityUsd:{min:210000,max:900000,ratio:4.29,providers:2}},history:pumped('1:'+A(402),20)})];
 for(const r of E.selectDisplay(rows,{network:'ethereum',now:NOW})){
  const parts=r.infoV4.split(';').map(x=>x.trim()).filter(Boolean);
  assert.ok(parts.length<=12,r.symbol+' '+parts.length);assert.match(parts.at(-1),/^Veri: /);
 }
});
