'use strict';
// Radar V6 (#279): premium Top 10 — profile completeness (arcy-profile-completeness-1, >= 60), compression intelligence
// (arcy-compression-1), market integrity (arcy-integrity-1) and arcy-research-rank-3. Deterministic and adversarial: every feature is
// tested on its failure path (what must NOT reach the main ranking or the top band), not only on the happy path.
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/radar-v2/intel/engine'),PC=require('../lib/radar-v2/intel/profile-completeness'),CX=require('../lib/radar-v2/intel/compression');
const INT=require('../lib/radar-v2/intel/integrity'),TOP=require('../lib/radar-v2/intel/top10'),OCK=require('../lib/radar-v2/intel/official-check');
const MM=require('../lib/radar-v2/intel/market-memory'),RS=require('../lib/radar-v2/intel/research'),DOS=require('../lib/radar-v2/intel/dossiers');
const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds'),OH=require('../scripts/radar-ohlcv.cjs');
const DAY=86400000,NOW=Date.parse('2026-11-20T10:00:00Z');
const A=n=>'0x'+n.toString(16).padStart(40,'0');
const iso=d=>new Date(NOW-d*DAY).toISOString();
const CID={arc:5042,ethereum:1,robinhood:4663,pons:4663};
const ART={url:'https://assets.geckoterminal.com/v6-fixture',source:'GeckoTerminal'};
const REVIEW=['DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED','PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED','EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED'];
function memory(key,obs){const m=MM.empty();for(const o of obs)MM.observe(m,key,o);return MM.assess(m,key,NOW);}
const steady=key=>memory(key,[{at:NOW-4*DAY,priceUsd:0.2,change24hPct:2,liquidityUsd:400000,volume24hUsd:300000},{at:NOW,priceUsd:0.21,change24hPct:2,liquidityUsd:410000,volume24hUsd:300000}]);
const dossier=(n,o={})=>({id:'p'+n,status:'PRIMARY_SOURCE_VERIFIED',checkedAt:iso(10),siteShowsExactAddress:true,officialSite:'https://project'+n+'.example/',officialDomains:['project'+n+'.example'],
 evidenceUrl:'https://docs.project'+n+'.example/token',evidenceStatic:true,docsUrl:'https://docs.project'+n+'.example/',siteContext:'Lending protocol; token governs parameters.',
 github:{owner:'project'+n,repos:['project'+n+'/core'],linkedFromOfficialSite:true},missing:[],...o});
const spreadOk={liquidityUsd:{min:390000,max:410000,ratio:1.05,providers:2},volume24hUsd:{min:290000,max:300000,ratio:1.03,providers:2}};
// series: 30 daily points; volatile first, quiet last 7 (or as given); volume and liquidity per day
function daily({days=30,quiet=7,amp=0.08,quietAmp=0.008,vol=200000,lastVol=null,liq=400000,ohlc=true,flat=false,last=Math.floor(NOW/DAY)*DAY-DAY,rise=0}={}){
 const pts=[];let p=1;
 for(let i=0;i<days;i++){const t=last-(days-1-i)*DAY,q=i>=days-quiet,a=q?quietAmp:amp;p=flat?1:rise&&i>=days-3?p*(1+rise):p*(1+(i%2?a:-a*0.97));
  const v=lastVol!==null&&i>=days-3?lastVol:vol;
  pts.push(ohlc?[Math.floor(t/1000),p,p*(1+a/2),p*(1-a/2),p,v]:{t,c:p,liq});}
 return ohlc?CX.fromOhlcv(pts):{source:'ONCHAIN_RESERVE_SAMPLES',ohlc:false,points:CX.normalise(pts.map(x=>({...x,o:null,h:null,l:null,v:null})))};
}
// A fully evidenced engine row (what selectDisplay receives); every test removes or corrupts ONE kind of evidence.
const row=(network,n,o={})=>{const key=CID[network]+':'+A(n);return {key,network,chainId:CID[network],address:A(n),symbol:'P'+n,name:'Project '+n,eligibility:'REVIEW',reasons:[...REVIEW],risk:[],
 discoveryClass:'QUALIFIED',marketObserved:true,priceUsd:0.2,liquidityUsd:400000,volume24hUsd:300000,change24hPct:3,trades24h:300,buys24h:160,sells24h:140,pool:A(n+0x5000),
 poolCreatedAt:iso(60),snapshotNow:NOW,radarAsOf:iso(0.01),artwork:ART,category:{category:'EARLY_STAGE_CANDIDATE',basis:'NO_NON_EARLY_SIGNAL'},
 v3Verification:{crossCheck:'MATCHED'},sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:3,of:3},universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},marketSpread:spreadOk,history:steady(key),
 dossier:dossier(n),evidenceSummary:{product:'VERIFIED_ACTIVE',risk:{mint:'MINT_BOUNDED_VERIFIED',admin:'ADMIN_REVIEWED',holders:'NO_SINGLE_EOA_OVER_20PCT',sell:'SELL_ENABLED_VERIFIED'},
  demand:{distinctBuyers:220,cluster:'REVIEWED_NO_CONCENTRATION',wash:'REVIEWED_NO_SELF_TRADE',hours:24},exit:{status:'EXIT_SIMULATED',executableUsd:20000}},
 activity:{source:'GeckoTerminal pool windows',volumeUsd:{h1:12000,h6:70000,h24:300000},trades:{h1:12,h6:80,h24:300},buyers:{h24:150},sellers:{h24:110}},
 nearMatch:{passed:[],maxDistance:0},opportunity:{score:40,dimensions:{product:60,team:60,adoption:50},flags:[]},evidenceConfidence:{score:50,missing:['EXIT']},infoV4:'NİTELİKLİ — tüm sıralama eşiklerini geçti',...o};};
const sel=(rows,network='ethereum',o={})=>E.selectDisplay(rows,{network,now:NOW,...o});
const pc=r=>PC.compute(r,{network:r.network,now:NOW,identity:RS.identityLevel(r,{now:NOW}),researchFloor:RS.RESEARCH_LIQUIDITY[r.network]});

test('V6-1. profile completeness 59 never enters the main Top 10; 60 does (same identity and market evidence)',()=>{
 const base={liquidityUsd:400000,marketSpread:{liquidityUsd:spreadOk.liquidityUsd},evidenceSummary:{risk:{}},history:null,dailySeries:null};
 const nogh=n=>dossier(n,{github:null});
 const r59=row('ethereum',1,{...base,dossier:nogh(1),history:memory('1:'+A(1),[{at:NOW-DAY,priceUsd:1},{at:NOW,priceUsd:1}])});
 const r60=row('ethereum',2,{...base,dossier:nogh(2),evidenceSummary:{risk:{mint:'MINT_NOT_PROVEN'}}});
 assert.equal(pc(r59).score,59);assert.equal(pc(r60).score,60);
 assert.deepEqual(pc(r59).gates,['PROFILE_COMPLETENESS_BELOW_60']);assert.equal(pc(r60).qualifiesMain,true);
 const out=sel([r59,r60]);
 assert.deepEqual(out.map(x=>x.address),[A(2)]);
 assert.ok(out.watch.find(w=>w.address===A(1)).reasons.includes('PROFILE_COMPLETENESS_BELOW_60'));
 // every awarded component carries provenance; the score is labelled as coverage, never safety
 for(const c of Object.values(pc(r60).components))for(const a of c.awarded)assert.ok('source' in a&&'at' in a);
 assert.match(pc(r60).note,/not a safety rating/);
});

test('V6-2. missing official identity: metadata corroboration alone can never reach 60, even with every other component full',()=>{
 const r=row('ethereum',3,{dossier:null,dailySeries:daily()});
 const p=pc(r);
 assert.equal(p.components.identity.score,12);assert.equal(p.components.official.score,0);assert.ok(p.score<60);
 assert.equal(sel([r]).length,0);
 // independent identity gate: an anonymous contract with a huge profile elsewhere still fails on identity
 const anon=row('ethereum',4,{dossier:null,universe:null,v3Verification:null,sourceEvidence:null});
 assert.ok(pc(anon).gates.includes('IDENTITY_EVIDENCE_INSUFFICIENT'));
});

test('V6-3. forged or changed official website: the live re-check voids identity; off-domain evidence is rejected at load',async()=>{
 const r=row('ethereum',5,{officialCheck:{status:'ADDRESS_NOT_FOUND',url:'https://docs.project5.example/token',at:iso(0)}});
 assert.equal(RS.identityLevel(r,{now:NOW}).level,'IDENTITY_SOURCE_CONFLICT');
 const out=sel([r]);assert.equal(out.length,0);
 // the checker: address present / absent on a static page / script-rendered page / off-domain / redirect
 const page=body=>async()=>({ok:true,status:200,text:async()=>body});
 const d=dossier(6);
 assert.equal((await OCK.check(d,A(6),{fetcher:page('<p>Token: '+A(6).toUpperCase().replace('0X','0x')+'</p>'),now:NOW})).status,'ADDRESS_FOUND');
 assert.equal((await OCK.check(d,A(6),{fetcher:page('<p>Token: 0xdeadbeef</p>'),now:NOW})).status,'ADDRESS_NOT_FOUND');
 assert.equal((await OCK.check({...d,evidenceStatic:false},A(6),{fetcher:page('<div id=root></div>'),now:NOW})).status,'NOT_STATICALLY_CHECKABLE','a JS-rendered page never demotes a genuine project');
 assert.equal((await OCK.check({...d,evidenceUrl:'https://project6-docs.evil.example/token'},A(6),{fetcher:page(A(6)),now:NOW})).status,'URL_NOT_ON_OFFICIAL_DOMAIN');
 assert.equal((await OCK.check(d,A(6),{fetcher:async()=>({ok:false,status:301,text:async()=>''}),now:NOW})).status,'UNREACHABLE');
 const bad=DOS.load({dossiers:[{...dossier(7),chainId:1,address:A(7),evidenceUrl:'https://elsewhere.example/p'},{...dossier(8),chainId:1,address:A(8)}]});
 assert.deepEqual(bad.rejected,['p7']);assert.equal(bad.byKey.size,1);
 // an unreachable page keeps the dated review (no false demotion), but an expired review stops counting
 const old=row('ethereum',9,{dossier:dossier(9,{checkedAt:iso(200)})});
 assert.equal(pc(old).components.official.score,0);
});

test('V6-4. artwork: a wrong or missing logo never changes completeness, band or rank; a logo of another contract is never adopted',()=>{
 const a=row('ethereum',10),b=row('ethereum',10,{artwork:null}),c=row('ethereum',10,{artwork:{url:'https://evil.example/uni.png',source:'GeckoTerminal'}});
 assert.equal(pc(a).score,pc(b).score);assert.equal(pc(a).score,pc(c).score);
 const [x]=sel([a]),[y]=sel([b]);
 assert.equal(x.researchRank.researchScore,y.researchRank.researchScore);assert.equal(x.researchRank.researchBand,y.researchRank.researchBand);
 const {candidateArtwork}=require('../lib/radar-v2/artwork-evidence');
 assert.equal(candidateArtwork({network:'ethereum',address:A(10),logo:{url:'https://evil.example/uni.png',source:'GeckoTerminal'}}),null);
});

test('V6-5. wrong chain and duplicate ticker: a dossier binds one chain+contract; an Arc look-alike of a listed ticker is impersonation',()=>{
 const set=DOS.load({dossiers:[{...dossier(11),chainId:1,address:A(11)}]});
 assert.ok(DOS.lookup(set,1,A(11)));assert.equal(DOS.lookup(set,5042,A(11)),null,'the same address on another chain is a different contract');
 const TOLLY='0xbc43ce8dec648ea298c4275559b81d6261c90b67';
 const copy=row('arc',0x7011,{symbol:'TOLLY',chainId:5042,dossier:null,liquidityUsd:5e6});
 assert.equal(RS.identityLevel(copy,{now:NOW}).level,'IMPERSONATION_EVIDENCE');
 const out=sel([copy],'arc');assert.equal(out.length,0);
 assert.ok(RS.canonical(5042,TOLLY,NOW));
});

test('V6-6. a genuine project with missing optional evidence (no X, no security review, no development) still qualifies on coverage',()=>{
 const r=row('ethereum',12,{evidenceSummary:{risk:{}},dossier:dossier(12,{github:null,docsUrl:null}),history:steady('1:'+A(12))});
 const p=pc(r);
 assert.equal(p.components.security.score,0);assert.equal(p.components.development.score,0);
 assert.ok(p.score>=60,String(p.score));
 const [x]=sel([r]);assert.ok(x);assert.notEqual(x.researchRank.researchBand,'TOP_RESEARCH_SIGNAL');
 assert.match(x.infoV4,/güvenlik 0\/15/);assert.match(x.infoV4,/Kontrat riski: analiz yapılmadı/);
 assert.doesNotMatch(x.infoV4,/güvenli(?!k)|\bsafe\b|yükselecek|garanti(?!si değildir)/i);
});

test('V6-7. a verified established project ranks as ESTABLISHED_QUALITY, below a genuine top research signal, above weaker rows',()=>{
 const est=row('ethereum',20,{eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY',...REVIEW],priceUsd:12,liquidityUsd:8e6,volume24hUsd:3e6,
  marketSpread:{liquidityUsd:{min:7.9e6,max:8e6,ratio:1.01,providers:2},volume24hUsd:{min:2.9e6,max:3e6,ratio:1.03,providers:2}},
  pairCount:4,poolCreatedAt:iso(700),trades24h:900,buys24h:470,sells24h:430,category:{category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST'},
  universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'},registry:{project:'Blue',kind:'LENDING_GOVERNANCE'}},evidenceSummary:{product:'VERIFIED_ACTIVE',risk:{}}});
 const gem=row('ethereum',21,{dailySeries:daily()});
 const weak=row('ethereum',22,{dossier:dossier(22,{github:null}),evidenceSummary:{risk:{}},evidenceConfidence:{score:5}});
 const out=sel([weak,est,gem]);
 assert.deepEqual(out.map(x=>x.researchRank.researchBand),['TOP_RESEARCH_SIGNAL','ESTABLISHED_QUALITY','ADDITIONAL_RESEARCH']);
 assert.deepEqual(out.map(x=>x.address),[A(21),A(20),A(22)]);
 assert.equal(out[0].researchRank.version,'arcy-research-rank-3');
});

test('V6-8. compression conditions are separated: no volume evidence, strong volume without contraction, low liquidity, dead series, short history',()=>{
 const onchain=daily({ohlc:false});
 const a=CX.compute({series:onchain,liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(a.status,'COMPRESSION_EMERGING','price compression without volume evidence is never CONFIRMED');assert.equal(a.metrics.volumeEvidence,'NOT_AVAILABLE');assert.equal(a.metrics.atrRatio,null);
 const noComp=CX.compute({series:daily({quiet:0,vol:5e6}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(noComp.status,'NO_COMPRESSION_EVIDENCE','strong volume but no historical contraction');
 const thin=CX.compute({series:daily(),liquidityUsd:15000,floor:200000,now:NOW});
 assert.equal(thin.status,'NO_COMPRESSION_EVIDENCE');assert.deepEqual(thin.reasons,['LIQUIDITY_BELOW_RESEARCH_FLOOR']);
 const dead=CX.compute({series:daily({flat:true}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(dead.status,'NO_COMPRESSION_EVIDENCE');assert.deepEqual(dead.reasons,['INACTIVE_SERIES_UNCHANGED_CLOSES']);
 const novol=CX.compute({series:daily({vol:0}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(novol.status,'NO_COMPRESSION_EVIDENCE');
 const short=CX.compute({series:daily({days:12}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(short.status,'INSUFFICIENT_HISTORY');assert.equal(short.score,0);
 const stale=CX.compute({series:daily({last:NOW-6*DAY}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(stale.status,'INSUFFICIENT_HISTORY');assert.deepEqual(stale.reasons,['SERIES_NOT_RECENT']);
 assert.equal(CX.compute({series:null,now:NOW}).status,'INSUFFICIENT_HISTORY','no candles are ever invented from current price');
 // the current, still-forming UTC day of provider OHLCV is never measured (partial volume would fake a volume collapse)
 const withToday=daily({last:NOW});assert.equal(CX.compute({series:withToday,liquidityUsd:400000,floor:200000,now:NOW}).days,29);
 // draining liquidity is not compression
 const drain={...onchain,points:onchain.points.map((p,i)=>({...p,liq:i<25?900000:300000}))};
 assert.equal(CX.compute({series:drain,liquidityUsd:300000,floor:200000,now:NOW}).reasons[0],'LIQUIDITY_DRAINING');
});

test('V6-9. real compression with held volume is CONFIRMED; volume expansion after consolidation is a BREAKOUT, a pump is not',()=>{
 const c=CX.compute({series:daily(),liquidityUsd:400000,floor:200000,now:NOW});
 assert.equal(c.status,'COMPRESSION_CONFIRMED');assert.ok(c.score>50);assert.ok(c.metrics.volatilityRatio<0.6&&c.metrics.rangeRatio<0.6);
 assert.equal(c.days,30);assert.match(c.from,/^2026-10/);
 const br=CX.compute({series:daily({lastVol:600000,quiet:10,rise:0.04}),liquidityUsd:400000,floor:200000,now:NOW,participation:{recent:300,baseline:180}});
 assert.equal(br.status,'BREAKOUT_ACTIVITY_CONFIRMED');
 const less=CX.compute({series:daily({lastVol:600000,quiet:10,rise:0.04}),liquidityUsd:400000,floor:200000,now:NOW,participation:{recent:100,baseline:180}});
 assert.notEqual(less.status,'BREAKOUT_ACTIVITY_CONFIRMED','volume up while participants fall is not a breakout');
 const pump=CX.compute({series:daily({lastVol:600000,quiet:10,rise:0.25}),liquidityUsd:400000,floor:200000,now:NOW});
 assert.notEqual(pump.status,'BREAKOUT_ACTIVITY_CONFIRMED','a +95% 3-day move is not a consolidation breakout');
 const gem=row('ethereum',30,{dailySeries:daily()});
 const [x]=sel([gem]);
 assert.equal(x.researchRank.researchBand,'TOP_RESEARCH_SIGNAL');assert.ok(x.researchRank.signals.includes('COMPRESSION_COMPRESSION_CONFIRMED'));
 assert.match(x.infoV4,/Sıkışma: doğrulandı \(30 gün/);
 // compression cannot compensate for a failed liquidity floor
 const thin=row('robinhood',31,{dailySeries:daily(),liquidityUsd:12000,marketSpread:null});
 const out=sel([thin],'robinhood');assert.equal(out.length,0);
});

test('V6-10. high volume from a few repeating wallets is SUSPICIOUS (never "fraud"); two independent signals cap the row',()=>{
 const wash=row('ethereum',40,{dailySeries:daily(),trades24h:6000,activity:{buyers:{h24:30},sellers:{h24:25}},
  evidenceSummary:{...row('ethereum',40).evidenceSummary,demand:{distinctBuyers:12,cluster:'CONCENTRATION_SUSPECTED',wash:'WASH_SUSPECTED',hours:24}}});
 const i=INT.assess(wash);
 assert.deepEqual(i.suspicious.sort(),['REPEATED_TRANSACTION_PATTERN','WALLET_CONCENTRATION','WASH_TRADING_PATTERN'].sort());
 assert.equal(i.summary,'MULTIPLE_SUSPICIOUS_SIGNALS');assert.ok(!JSON.stringify(i).match(/FRAUD|SCAM/));
 const [x]=sel([wash]);
 assert.equal(x.researchTier,'RESEARCH_CANDIDATE');assert.ok(x.researchTierReasons.includes('MULTIPLE_SUSPICIOUS_INTEGRITY_SIGNALS'));
 assert.equal(x.researchRank.researchBand,'ADDITIONAL_RESEARCH');assert.match(x.infoV4,/Manipülasyon: şüpheli: /);
 const one=INT.assess(row('ethereum',41,{volume24hUsd:3e6,liquidityUsd:400000}));
 assert.deepEqual(one.suspicious,['THIN_LIQUIDITY_HIGH_VOLUME']);
 const [y]=sel([row('ethereum',41,{volume24hUsd:3e6,dailySeries:daily(),marketSpread:{liquidityUsd:spreadOk.liquidityUsd,volume24hUsd:{min:2.9e6,max:3e6,ratio:1.03,providers:2}}})]);
 assert.notEqual(y.researchRank.researchBand,'TOP_RESEARCH_SIGNAL','one suspicious signal is enough to lose the top band');
 // unavailable checks are reported as unavailable, never as clean
 const u=INT.assess(row('ethereum',42,{evidenceSummary:{risk:{}}}));
 assert.ok(u.findings.some(f=>f.code==='HONEYPOT_OR_FAILED_EXIT'&&f.status==='UNAVAILABLE'));
});

test('V6-11. a historical pump followed by a normal 24h change never regains any band: SHARK, WANTED, RUGPULL, WASTED',()=>{
 const cases=[['SHARK','arc',238.7,50],['WANTED','robinhood',1280.3,51],['RUGPULL','robinhood',575.5,52],['WASTED','ethereum',31765.9,53]];
 for(const [symbol,network,peak,n] of cases){
  const key=CID[network]+':'+A(n);
  const h=memory(key,[{at:NOW-4*DAY,priceUsd:0.01,change24hPct:3},{at:NOW-3*DAY,priceUsd:0.12,change24hPct:peak},{at:NOW,priceUsd:0.1,change24hPct:-2}]);
  const r=row(network,n,{symbol,history:h,change24hPct:-2,dailySeries:daily()});
  const out=sel([r],network);
  assert.equal(out.length,0,symbol);assert.ok(out.watch[0].reasons.includes('HISTORICAL_EXTREME_MOVE'),symbol);
  assert.equal(INT.assess(r).pumpHistory,true,symbol);
  assert.equal(TOP.topSignal({...r,researchTier:'RESEARCH_QUALIFIED',discoveryTier:'EARLY',integrity:INT.assess(r),profileCompleteness:{qualifiesMain:true}}).ok,false,symbol);
 }
 // an established project keeps the history as context but can never be the top band
 const est=row('ethereum',54,{discoveryTier:'ESTABLISHED'});
 assert.equal(TOP.topSignal({...est,researchTier:'RESEARCH_QUALIFIED',integrity:INT.assess(est),profileCompleteness:{qualifiesMain:true}}).why.includes('ESTABLISHED_PROJECT'),true);
});

test('V6-12. AF and every persistent risk hold stay out of the main ranking and the watch list, whatever their profile',()=>{
 const held=new Set(RH.list(RH.initial(null)).filter(x=>x.state==='HELD').map(x=>x.key));
 assert.ok(held.size>=1);assert.ok(held.has('5042:0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e'));
 for(const key of held){
  const [cid,address]=key.split(':'),network=cid==='5042'?'arc':cid==='1'?'ethereum':'robinhood';
  const r={...row(network,1,{dailySeries:daily()}),key,address,symbol:'HELD'};
  const out=sel([r],network,{held});
  assert.equal(out.length,0,key);assert.equal(out.watch.some(w=>w.key===key),false,key);
  assert.ok(INT.assess(r,{held:true}).confirmedCritical.includes('PERSISTENT_RISK_HOLD'));
 }
 // a verified failed exit or honeypot is a confirmed critical finding: excluded even with a perfect profile
 const hp=row('ethereum',60,{evidenceSummary:{...row('ethereum',60).evidenceSummary,exit:{status:'EXIT_FAILED_VERIFIED'}}});
 const out=sel([hp]);assert.equal(out.length,0);assert.ok(out.watch[0].reasons.includes('INTEGRITY_CONFIRMED_CRITICAL'));
});

function snapOf(display,network='ethereum',extra={}){
 const engine={networks:{[network]:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:display,counts:{},display:{shown:display.length,byBand:display.byBand,watch:display.watch},all:display}},riskLedger:null,...extra};
 return S.build(engine,{[network]:{tokens:[],nearMiss:[],excluded:[],asOf:iso(0.01)}},{now:NOW,commit:'test'});
}
test('V6-13. snapshot: rank-3 rows publish completeness, compression, integrity; the validator rejects any V6 gate violation',()=>{
 const est=row('ethereum',70,{eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY',...REVIEW],liquidityUsd:8e6,volume24hUsd:3e6,priceUsd:12,
  marketSpread:{liquidityUsd:{min:7.9e6,max:8e6,ratio:1.01,providers:2},volume24hUsd:{min:2.9e6,max:3e6,ratio:1.03,providers:2}},
  pairCount:4,poolCreatedAt:iso(700),trades24h:900,buys24h:470,sells24h:430,category:{category:'ESTABLISHED_BLUE_CHIP',basis:'EXACT_CONTRACT_LIST'},
  universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'},registry:{project:'Blue',kind:'LENDING_GOVERNANCE'}}});
 const display=sel([row('ethereum',71,{dailySeries:daily()}),est]);
 const snap=snapOf(display);
 assert.deepEqual(S.validate(snap),{ok:true});
 const o=snap.sections.ethereum.rows[0].opportunity;
 assert.equal(o.researchRank.version,'arcy-research-rank-3');assert.equal(o.profileCompleteness.version,'arcy-profile-completeness-1');
 assert.equal(o.compression.version,'arcy-compression-1');assert.equal(o.integrity.version,'arcy-integrity-1');
 assert.ok(o.profileCompleteness.components.identity.awarded[0].url);
 const c=()=>structuredClone(snap);let bad;
 bad=c();bad.sections.ethereum.rows[0].opportunity.profileCompleteness.score=59;assert.equal(S.validate(bad).ok,false,'below 60');
 bad=c();bad.sections.ethereum.rows[0].opportunity.profileCompleteness.gates=['IDENTITY_EVIDENCE_INSUFFICIENT'];assert.equal(S.validate(bad).ok,false);
 bad=c();bad.sections.ethereum.rows[0].opportunity.integrity.confirmedCritical=['HONEYPOT_OR_FAILED_EXIT'];assert.equal(S.validate(bad).ok,false);
 bad=c();bad.sections.ethereum.rows[0].opportunity.integrity.pumpHistory=true;assert.equal(S.validate(bad).ok,false,'top band never carries pump history');
 bad=c();bad.sections.ethereum.rows.reverse();bad.sections.ethereum.rows.forEach((r,i)=>r.rank=i+1);assert.equal(S.validate(bad).ok,false,'band order');
 bad=c();bad.sections.ethereum.rows[0].opportunity.researchTier='WATCH_ONLY';assert.equal(S.validate(bad).ok,false);
 bad=c();bad.sections.ethereum.rows[1].opportunity.researchRank.researchBand='TOP_RESEARCH_SIGNAL';assert.equal(S.validate(bad).ok,false,'established in the top band');
 // older rank-1/2 snapshots remain valid (approved backwards compatibility)
 const v5=E.selectDisplay([row('ethereum',72)],{network:'ethereum',now:NOW,v6:false});
 assert.deepEqual(S.validate(snapOf(v5)),{ok:true});
});

test('V6-14. Pons and Robinhood never share an exact contract in their main rankings; source disagreement is visible and penalised',()=>{
 const pons=sel([row('pons',80,{launch:{status:'ONCHAIN_VERIFIED'},dailySeries:daily()})],'pons');
 const rh=sel([row('robinhood',80,{dailySeries:daily()}),row('robinhood',81)],'robinhood');
 const engine={networks:{pons:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:pons,counts:{},display:{},all:pons},
  robinhood:{source:{status:'OBSERVED',asOf:iso(0.01)},displayCandidates:rh,counts:{},display:{},all:rh}},riskLedger:null};
 const snap=S.build(engine,{pons:{tokens:[],asOf:iso(0.01)},robinhood:{tokens:[],asOf:iso(0.01)}},{now:NOW,commit:'t'});
 assert.deepEqual(snap.sections.robinhood.rows.map(r=>r.address),[A(81)]);
 assert.deepEqual(S.validate(snap),{ok:true});
 const dup=structuredClone(snap);dup.sections.robinhood.rows.unshift({...structuredClone(snap.sections.pons.rows[0]),network:'robinhood'});dup.sections.robinhood.rows.forEach((r,i)=>r.rank=i+1);
 assert.equal(S.validate(dup).ok,false);
 // providers 15x apart: no market-agreement points, integrity flags the discrepancy, never the top band
 const dis=row('robinhood',82,{dailySeries:daily(),marketSpread:{liquidityUsd:{min:93487,max:1418484,ratio:15.17,providers:2},volume24hUsd:{min:53960,max:1153646,ratio:21.38,providers:2}}});
 assert.equal(pc(dis).components.market.score,12);
 assert.ok(INT.assess(dis).suspicious.includes('PROVIDER_DISCREPANCY'));
 const [x]=sel([dis],'robinhood');assert.ok(!x||x.researchRank.researchBand!=='TOP_RESEARCH_SIGNAL');
});

test('V6-15. carry-forward and fault isolation: an Arc outage never blocks Ethereum; old rows are never relabelled fresh',async()=>{
 const display=sel([row('ethereum',90,{dailySeries:daily()})]);
 const prev=snapOf(display);
 const next={...structuredClone(prev),generatedAt:new Date(NOW+3600000).toISOString(),sections:{...structuredClone(prev.sections),arc:{status:'NOT_BUILT',reason:'SOURCE_UNAVAILABLE',asOf:null,rows:[]}}};
 const m=S.merge(prev,next);
 assert.equal(m.sections.ethereum.rows.length,1);assert.equal(m.sections.arc.rows.length,0);
 assert.equal(m.sections.ethereum.rows[0].measuredAt,prev.sections.ethereum.rows[0].measuredAt,'observation time is kept, never relabelled');
 // engine: an OHLCV provider that throws for Arc does not stop Ethereum, and the failure is counted
 const sec=network=>({ok:true,network,chainId:CID[network],asOf:iso(0.01),freshness:'FRESH',tokens:[],excluded:[],nearMiss:[],discovery:{uniqueCandidates:0}});
 E._clearCache();
 const r=await E.run({sections:{arc:sec('arc'),ethereum:sec('ethereum')},now:NOW,env:{},fetcher:async()=>{throw Error('offline');},rpc:{},
  registryDoc:{schema:'arcy-radar-project-registry/1',version:'t',projects:[]},limits:{concurrency:1,pace:false,ohlcv:async n=>{if(n==='arc')throw Object.assign(Error('403'),{code:'HTTP_403'});return null;}}});
 assert.ok(r.networks.ethereum&&r.networks.arc);assert.ok(r.v6);
});

test('V6-16. OHLCV provider: keyless never on the schedule, cached pools are reused, insufficient candles are reported',async()=>{
 const cache=OH.loadCache(null);
 assert.equal(OH.provider({env:{},cache}).fn,null,'keyless tier requires an explicit non-scheduled run');
 assert.match(OH.provider({env:{},cache}).stats.mode,/KEYLESS_NOT_ALLOWED/);
 let calls=0;const fetcher=async u=>{calls++;assert.match(u,/\/networks\/eth\/pools\/0x[0-9a-f]{40}\/ohlcv\/day\?aggregate=1&limit=60/);
  return {ok:true,status:200,json:async()=>({data:{attributes:{ohlcv_list:[[Math.floor((NOW-DAY)/1000),1,1.1,0.9,1,500],[Math.floor(NOW/1000),1,1.05,0.95,1.01,400]]}}})};};
 const p=OH.provider({env:{RADAR_OHLCV_KEYLESS:'1'},cache,fetcher,now:()=>NOW});
 const first=await p.fn('ethereum',{pool:A(0x99)});assert.equal(first.rows.length,2);assert.equal(first.rows[0][0]<first.rows[1][0],true);
 const again=await p.fn('ethereum',{pool:A(0x99)});assert.equal(again.cached,true);assert.equal(calls,1);
 assert.equal(CX.compute({series:CX.fromOhlcv(first.rows),now:NOW}).status,'INSUFFICIENT_HISTORY');
 assert.equal(OH.loadCache({version:'arcy-ohlcv-cache-1',entries:{'bad':{rows:[[1]]},'1:0xab':{fetchedAt:'x',rows:[]}}}).entries['1:0xab'],undefined);
 const demo=OH.provider({env:{COINGECKO_DEMO_API_KEY:'k'},cache:OH.loadCache(null),fetcher:async(u,o)=>{assert.equal(o.headers['x-cg-demo-api-key'],'k');return {ok:false,status:429};},now:()=>NOW});
 assert.equal(await demo.fn('ethereum',{pool:A(0x98)}),null);assert.equal(demo.stats.errors.HTTP_429,1);
});

test('V6-17. Info explains every required element within the existing 12-part popover, ending with the data time',()=>{
 const [x]=sel([row('ethereum',100,{dailySeries:daily()})]);
 const parts=x.infoV4.split(';').map(s=>s.trim()).filter(Boolean);
 assert.ok(parts.length<=12,String(parts.length));assert.ok(x.infoV4.length<=900,'compact for the mobile popover');assert.match(parts.at(-1),/^Veri: 2026-11-20 /);
 for(const re of [/^EN GÜÇLÜ ARAŞTIRMA SİNYALİ \(tahmin değil\)/,/Neden: /,/Ethereum 0x0000…0064/,/Profil %\d+ \(kimlik 20\/20/,/Kimlik: resmi kaynak kontratı yayınlıyor/,
  /site doğrulandı, dokümantasyon doğrulandı/,/Piyasa: likidite \$400K/,/Sıkışma: doğrulandı \(30 gün/,/Geçmiş: 2 gözlem, aşırı hareket yok/,/Manipülasyon: /,/Kontrat riski: mint, yetki, sahipler, çıkış incelendi/,/Sıra #1: puan/])
  assert.match(x.infoV4,re);
 assert.doesNotMatch(x.infoV4,/güvenli(?!k)|\bsafe\b|yükselecek|pump/i);
});

test('V6-18. ten slots are never filled with WATCH_ONLY: twelve sub-60 profiles leave an empty main list',()=>{
 const rows=Array.from({length:12},(_,i)=>row('ethereum',200+i,{dossier:null}));
 const out=sel(rows);assert.equal(out.length,0);assert.equal(out.watch.length,10);
 assert.ok(out.watch.every(w=>w.reasons.includes('PROFILE_COMPLETENESS_BELOW_60')));
 const mixed=sel([...rows,row('ethereum',300)]);assert.deepEqual(mixed.map(x=>x.address),[A(300)]);
 // ranking is deterministic regardless of input order
 const set=[row('ethereum',301,{dailySeries:daily()}),row('ethereum',302),row('ethereum',303,{evidenceSummary:{risk:{}}}),row('ethereum',304,{dossier:dossier(304,{github:null})})];
 const ref=sel(set.map(r=>structuredClone(r))).map(x=>x.address);
 for(let i=0;i<5;i++)assert.deepEqual(sel(set.map(r=>structuredClone(r)).sort(()=>Math.random()-0.5)).map(x=>x.address),ref);
});

test('V6-19. live official-source discovery: only a page on an official domain that publishes the exact contract counts',async()=>{
 const OD=require('../lib/radar-v2/intel/official-discovery');
 const pages={'https://project1.example/':'<meta name="description" content="Lending protocol for agents on Ethereum."><a href="https://github.com/proj1org">GitHub</a><a href="https://docs.project1.example/">Docs</a>',
  'https://docs.project1.example/token':'<p>Token contract: '+A(1)+'</p>','https://docs.project1.example/':'<p>Docs home</p>'};
 const fetcher=async u=>{const b=pages[u];return b===undefined?{ok:false,status:404,headers:new Map(),text:async()=>''}:{ok:true,status:200,headers:new Map(),text:async()=>b};};
 const reg={chainId:1,address:A(1),universe:{registry:{official:{domains:['project1.example'],pages:['https://project1.example/','https://docs.project1.example/token'],github:'proj1org'}}}};
 const r=await OD.inspect(reg,{fetcher,now:NOW});
 assert.equal(r.status,'ADDRESS_PUBLISHED');assert.equal(r.dossier.status,'PRIMARY_SOURCE_VERIFIED');assert.equal(r.dossier.evidenceUrl,'https://docs.project1.example/token');
 assert.deepEqual(r.dossier.github,{owner:'proj1org',repos:[],linkedFromOfficialSite:true});assert.match(r.dossier.siteContext,/^Lending protocol for agents/);
 // creator-submitted website: two-way link is PARTIAL evidence only (identity stays metadata-level)
 const cr=await OD.inspect({chainId:4663,address:A(1),officialLinks:{websites:['https://x.com/proj','https://project1.example/']}},{fetcher:async u=>u==='https://project1.example/'?{ok:true,status:200,headers:new Map(),text:async()=>'<b>'+A(1)+'</b>'}:fetcher(u),now:NOW});
 assert.equal(cr.dossier.status,'PARTIAL_EVIDENCE');
 const id=RS.identityLevel(row('robinhood',1,{dossier:cr.dossier,officialCheck:cr.officialCheck}),{now:NOW});
 assert.notEqual(id.level,'OFFICIAL_CONTRACT_VERIFIED','a creator-submitted site never makes official identity on its own');
 // no address on the page, an off-site redirect, an unsafe host, and social-only links produce no dossier
 assert.equal((await OD.inspect({chainId:1,address:A(2),officialLinks:{websites:['https://project1.example/']}},{fetcher,now:NOW})).status,'ADDRESS_NOT_PUBLISHED');
 const redir=async()=>({ok:false,status:302,headers:new Map([['location','https://evil.example/a']]),text:async()=>''});
 assert.equal((await OD.inspect({chainId:1,address:A(1),officialLinks:{websites:['https://project1.example/']}},{fetcher:redir,now:NOW})).status,'SITE_UNREACHABLE');
 assert.equal(OD.plan({officialLinks:{websites:['https://127.0.0.1/','https://t.me/x','https://localhost/']}}),null);
 assert.equal(OD.safeUrl('http://project1.example/'),null);
 // a registry page outside the official domains is never fetched as evidence
 assert.deepEqual(OD.plan({universe:{registry:{official:{domains:['project1.example'],pages:['https://elsewhere.example/p']}}}}).pages,['https://project1.example/']);
 // budget is enforced
 const b={max:1,used:0};await OD.inspect(reg,{fetcher,now:NOW,budget:b});assert.equal(b.used,1);
});

test('V6-20. a builder-verified official page makes official identity in the engine; the reviewed dossier still wins',async()=>{
 const live={id:'live:1:'+A(400),source:'BUILDER_LIVE_CHECK',status:'PRIMARY_SOURCE_VERIFIED',checkedAt:iso(0),recheckedAt:iso(0),siteShowsExactAddress:true,
  officialSite:'https://project400.example/',officialDomains:['project400.example'],evidenceUrl:'https://docs.project400.example/token',evidenceStatic:true,docsUrl:'https://docs.project400.example/',
  siteContext:'Protocol (self-description on the official page)',github:null,missing:[]};
 const r=row('ethereum',400,{dossier:{...live},officialCheck:{status:'ADDRESS_FOUND',url:live.evidenceUrl,at:iso(0)}});
 assert.equal(RS.identityLevel(r,{now:NOW}).level,'OFFICIAL_CONTRACT_VERIFIED');
 assert.ok(pc(r).score>=60);
});

test('V6-21. a collapse or a liquidity drain seen in the dated daily series is reported; one demand review is counted once',()=>{
 // observed 2026-11-20 preview: a Pons launch fell 43% in three days while pool liquidity drained
 const s=daily({ohlc:false});const pts=s.points.map((p,i,a)=>({...p,c:i>=a.length-3?p.c*0.5:p.c,liq:i>=a.length-5?150000:400000}));
 const r=row('pons',500,{launch:{status:'ONCHAIN_VERIFIED'},dailySeries:{...s,points:pts},liquidityUsd:150000,marketSpread:null});
 const out=sel([r],'pons');
 assert.equal(out.length,0);assert.ok(out.watch[0].reasons.includes('INTEGRITY_PRICE_EVENT_HISTORY'));
 // the same on-chain review behind a demand flag is not two independent suspicious signals
 const one=INT.assess(row('ethereum',501,{opportunity:{flags:['DEMAND_CONCENTRATED_OR_WASH']},evidenceSummary:{...row('ethereum',501).evidenceSummary,demand:{distinctBuyers:40,cluster:'CONCENTRATION_SUSPECTED',wash:'REVIEWED_NO_SELF_TRADE',hours:24}}}));
 assert.deepEqual(one.suspicious,['WALLET_CONCENTRATION']);
});

test('V6-22. official discovery reports a status per contract so unreachable sites and withdrawn addresses are told apart',async()=>{
 const OD=require('../lib/radar-v2/intel/official-discovery');
 const c1={chainId:4663,address:A(601),officialLinks:{websites:['https://p601.example/']}},c2={chainId:4663,address:A(602),officialLinks:{websites:['https://p602.example/']}};
 const fetcher=async u=>u.startsWith('https://p601')?{ok:true,status:200,headers:new Map(),text:async()=>'<p>no contract here</p>'}:(()=>{throw new Error('down');})();
 const {found,statuses}=await OD.discover([c1,c2],{fetcher,now:NOW});
 assert.equal(found.size,0);
 assert.equal(statuses.get('4663:'+A(601)),'ADDRESS_NOT_PUBLISHED','reached, no address: a cached check must be dropped');
 assert.equal(statuses.get('4663:'+A(602)),'SITE_UNREACHABLE','unreachable: a recent cached check may be carried, labelled');
});


test('V7-1. continuous research ranks up to 40 evidence-qualified candidates with compressed A signals first',()=>{
 const rows=Array.from({length:46},(_,i)=>row('ethereum',900+i,i<2?{dailySeries:daily()}:{...{}}));
 const out=sel(rows);
 assert.equal(out.length,40,'only the V6 path expands capacity');
 assert.equal(new Set(out.map(x=>x.address)).size,40);
 assert.deepEqual(out.slice(0,2).map(x=>x.researchRank.researchBand),['TOP_RESEARCH_SIGNAL','TOP_RESEARCH_SIGNAL']);
 assert.ok(out.slice(2).every(x=>x.researchRank.researchBand!=='TOP_RESEARCH_SIGNAL'));
 assert.ok(out.every((x,i)=>x.rank===i+1&&x.profileCompleteness.qualifiesMain));
 const snap=snapOf(out);
 assert.equal(snap.sections.ethereum.rows.length,40);
 assert.deepEqual(S.validate(snap),{ok:true});
 const tooMany=structuredClone(snap);
 tooMany.sections.ethereum.rows.push({...tooMany.sections.ethereum.rows[0],rank:41,address:A(4000)});
 assert.equal(S.validate(tooMany).ok,false,'a 41st result fails validation');
});

test('V7-2. profiles absent, risk-held contracts and conflicting identities never pad the 40',()=>{
 const strong=Array.from({length:20},(_,i)=>row('ethereum',1000+i));
 const anonymous=Array.from({length:30},(_,i)=>row('ethereum',1100+i,{dossier:null}));
 const bad=row('ethereum',1200,{officialCheck:{status:'ADDRESS_NOT_FOUND',url:'https://docs.project1200.example/token',at:iso(0)}});
 const held=new Set(['1:'+A(1210)]);
 const blocked=row('ethereum',1210);
 const out=sel([...strong,...anonymous,bad,blocked],'ethereum',{held});
 assert.equal(out.length,20,'do not lower profile or safety gates to reach 40');
 assert.ok(out.every(x=>x.profileCompleteness.score>=60));
 assert.ok(!out.some(x=>x.address===bad.address||x.address===blocked.address));
});

test('V7-3. legacy V4 and V5 keep ten results for backward-compatible snapshot consumers',()=>{
 const rows=Array.from({length:45},(_,i)=>row('ethereum',1300+i));
 const v5=sel(rows,'ethereum',{v6:false});
 assert.equal(v5.length,10);
 assert.deepEqual(S.validate(snapOf(v5)),{ok:true});
 const v4=sel(rows,'ethereum',{research:false});
 assert.equal(v4.length,10);
 assert.deepEqual(S.validate(snapOf(v4)),{ok:true});
});
