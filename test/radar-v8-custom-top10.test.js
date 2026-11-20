'use strict';
// ARCY Radar — exact Top 10 ranking engine (`arcy-custom-filter-2`) regression tests.
const test=require('node:test'),assert=require('node:assert/strict');
const CF=require('../lib/radar-v2/intel/custom-filter');
const E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot');
const NOW=Date.parse('2026-11-20T13:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0');
// independently corroborated exact contract (explorer + DEX symbol match) = verifiable project profile
// + creator-provided project channels on the exact-contract listing (project profile beyond token identity)
const PROFILE={universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},officialLinks:{websites:['https://project.example'],socials:[]}};
const r=(n,opts={})=>({
 key:'1:'+A(n),network:'ethereum',chainId:1,address:A(n),symbol:'X'+n,name:'Project '+n,
 category:{category:'EARLY_STAGE_CANDIDATE'},eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],risk:[],
 discoveryClass:'NEAR_MATCH',marketObserved:true,poolCreatedAt:new Date(NOW-70*86400000).toISOString(),
 snapshotNow:NOW,radarAsOf:new Date(NOW-360000).toISOString(),radarFreshness:'FRESH',
 priceUsd:0.1,liquidityUsd:450000,volume24hUsd:250000,change24hPct:-9,trades24h:125,buys24h:72,sells24h:53,
 marketCapUsd:9e6,fdvUsd:1e7,
 sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:2,of:3},v3Verification:{crossCheck:'MATCHED'},
 history:{version:'arcy-market-memory-1',observations:3,flags:[],drawdownFromPeakPct:-32},
 marketSpread:{liquidityUsd:{min:430000,max:450000,ratio:1.05}},
 evidenceConfidence:{score:0.4,missing:['IDENTITY']},
 opportunity:{score:25,dimensions:{product:0,team:0,adoption:30},flags:[]},
 nearMatch:{maxDistance:0.4,missed:[],pending:[],passed:[]},
 ...PROFILE,...opts
});
const sel=(rows,o={})=>E.selectDisplay(rows,{network:'ethereum',now:NOW,filterB:false,customFilter:true,...o});
const id=lvl=>({identity:{level:lvl,evidence:[]}});

test('ETR-1: hard eligibility — scams, honeypots, dangerous contracts, impersonators, unverifiable profiles are excluded',()=>{
 assert.equal(CF.veto(r(1)),null,'before enrichment the identity is not yet assessed');
 assert.equal(CF.veto(r(1,id('METADATA_CROSS_CORROBORATED'))),null);
 assert.equal(CF.veto(r(1,id('OFFICIAL_CONTRACT_VERIFIED'))),null);
 assert.equal(CF.veto(r(1,id('EXACT_CONTRACT_OBSERVED'))),'NO_VERIFIABLE_PROJECT_PROFILE');
 assert.equal(CF.veto(r(1,id('OFFICIAL_IDENTITY_UNESTABLISHED'))),'NO_VERIFIABLE_PROJECT_PROFILE');
 assert.equal(CF.veto(r(1,id('IMPERSONATION_EVIDENCE'))),'CONTRACT_IDENTITY_CONFLICT');
 assert.equal(CF.veto(r(1,id('IDENTITY_SOURCE_CONFLICT'))),'CONTRACT_IDENTITY_CONFLICT');
 assert.equal(CF.veto(r(1,{symbol:'',name:''})),'NO_VERIFIABLE_PROJECT_PROFILE');
 assert.equal(CF.veto(r(2,{risk:['SELL_DISABLED']})),'CONFIRMED_CONTRACT_OR_EXIT_RISK');
 assert.equal(CF.veto(r(2,{risk:['UNLIMITED_MINT']})),'CONFIRMED_CONTRACT_OR_EXIT_RISK');
 assert.equal(CF.veto(r(3,{reasons:['DANGEROUS_ADMIN_PRIVILEGE']})),'VERIFIED_RISK_OR_SOURCE_CONFLICT');
 assert.equal(CF.veto(r(4,{category:{category:'IMPERSONATION_SUSPECT'}})),'UNSUPPORTED_OR_IMPERSONATING_CATEGORY');
 assert.equal(CF.veto(r(5,{integrity:{confirmedCritical:['HONEYPOT_OR_FAILED_EXIT']}})),'CONFIRMED_MARKET_INTEGRITY_CRITICAL');
 assert.equal(CF.veto(r(6,{volume24hUsd:0})),'NO_REAL_MARKET_OBSERVATION');
 assert.equal(CF.veto(r(7),{held:true}),'PERSISTENT_RISK_HOLD');
 const established=r(8,{eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY','IDENTITY_NOT_VERIFIED'],category:{category:'ESTABLISHED_BLUE_CHIP'}});
 assert.equal(CF.veto(established),null,'asset maturity alone is not a scam');
 assert.ok(CF.veto({...established,reasons:[...established.reasons,'DANGEROUS_ADMIN_PRIVILEGE']}));
 // honeypot found only AFTER enrichment (integrity) never reaches the list
 const out=sel([...Array.from({length:10},(_,i)=>r(400+i)),r(450,{evidenceSummary:{risk:{sell:'SELL_DISABLED_VERIFIED'}},volume24hUsd:9e8})]);
 assert.equal(out.some(x=>x.address===A(450)),false);
 // no verifiable profile (no corroborating source) is dropped after enrichment
 const out2=sel([...Array.from({length:10},(_,i)=>r(500+i)),r(560,{universe:null,volume24hUsd:9e8}),r(561,{officialLinks:null,volume24hUsd:9e8})]);
 assert.equal(out2.some(x=>x.address===A(560)),false);
 assert.equal(out2.some(x=>x.address===A(561)),false,'explorer + DEX symbol agreement alone is token identity, not a project profile');
 assert.equal(out2.length,10);
});

test('ETR-2: exactly 10 when 10+ eligible; weak scores never remove an eligible project',()=>{
 const strong=Array.from({length:6},(_,i)=>r(100+i,{volume24hUsd:300000-i*5000}));
 // weak but eligible: pumped, thin, dead volume, deep crash, wash-like turnover — all must stay eligible and simply rank lower
 const weak=[r(201,{change24hPct:140}),r(202,{liquidityUsd:3000,marketSpread:null,volume24hUsd:2000}),r(203,{volume24hUsd:300,trades24h:2,buys24h:1,sells24h:1}),
  r(204,{change24hPct:-62}),r(205,{volume24hUsd:5e6,liquidityUsd:200000,marketSpread:null})];
 const out=sel([...strong,...weak]);
 assert.equal(out.length,10,'6 strong + 5 weak eligible → exactly 10');
 assert.equal(out.shortfall,null);
 assert.ok(out.every(x=>x.selectionBasis==='ARCY_CUSTOM_FILTER_2'&&x.researchRank.version===CF.VERSION));
 assert.ok(out.slice(0,6).every(x=>strong.some(s=>s.address===x.address)),'strong candidates occupy the top');
 assert.equal(new Set(out.map(x=>x.address)).size,10);
 // exactly 10 eligible, all weak → all 10 shown
 const allWeak=sel(Array.from({length:10},(_,i)=>r(700+i,{volume24hUsd:400+i,trades24h:2,buys24h:1,sells24h:1,change24hPct:120})));
 assert.equal(allWeak.length,10,'a weak opportunity score never removes an eligible project');
 // fewer only when eligible candidates are genuinely missing; shortfall is reported, nothing is invented
 const short=sel([r(1),r(2,{risk:['SELL_DISABLED']}),r(3,{priceUsd:null}),r(4,{universe:null})]);
 assert.equal(short.length,1);
 assert.equal(short.shortfall.target,10);
});

test('ETR-3: pure score order — #1 is the best ARCY match, #10 the weakest of the ten',()=>{
 const rows=[r(10,{change24hPct:150,volume24hUsd:4000}),r(11),r(12,{volume24hUsd:900000,liquidityUsd:900000,marketSpread:{liquidityUsd:{min:880000,max:900000,ratio:1.02}},
  history:{observations:5,flags:['ACTIVITY_GROWTH_OBSERVED'],drawdownFromPeakPct:-35},buys24h:130,sells24h:70,trades24h:200}),
  ...Array.from({length:9},(_,i)=>r(20+i,{volume24hUsd:100000+i*1000}))];
 const out=sel(rows);
 assert.equal(out.length,10);
 const scores=out.map(x=>x.researchRank.researchScore);
 for(let i=1;i<scores.length;i++)assert.ok(scores[i]<=scores[i-1],'non-increasing at '+i);
 assert.equal(out[0].address,A(12),'growing, deep, stabilising project ranks #1');
 out.forEach((x,i)=>{assert.equal(x.rank,i+1);assert.equal(x.researchRank.position,i+1);});
 // band is a label only: a lower band may sit above a higher one if its score is higher; order never depends on band
 const c=CF.compute(out[0]);assert.equal(Object.keys(c.components).length,8);
 assert.equal(c.notForecast,true);
});

test('ETR-4: upside asymmetry (15/100) — undervalued + growing beats merely cheap or crashed; never a return forecast',()=>{
 assert.equal(CF.WEIGHTS.upsideAsymmetry,15);
 assert.equal(Object.values(CF.WEIGHTS).reduce((a,b)=>a+b,0),100);
 const peers=CF.annotatePeers([
  r(30,{marketCapUsd:2e6,fdvUsd:2.1e6,volume24hUsd:300000,history:{observations:5,flags:['ACTIVITY_GROWTH_OBSERVED'],drawdownFromPeakPct:-30}}), // cheap vs activity, growing, low dilution
  r(31,{marketCapUsd:2e6,fdvUsd:2.1e6,volume24hUsd:300000,change24hPct:-50,history:{observations:5,flags:[],drawdownFromPeakPct:-85}}), // cheap because it crashed
  r(32,{marketCapUsd:1e6,fdvUsd:2e7,volume24hUsd:300000}), // 5% circulating: heavy dilution ahead
  r(33,{marketCapUsd:9e7,fdvUsd:1e8}),r(34,{marketCapUsd:5e7,fdvUsd:6e7}),r(35,{marketCapUsd:3e7,fdvUsd:3e7})]);
 const u=k=>CF.compute(peers.find(x=>x.address===A(k))).components.upsideAsymmetry;
 assert.ok(u(30)>u(31),'growing undervalued > crashed');
 assert.ok(u(30)>u(32),'low dilution > heavy future dilution');
 assert.ok(CF.compute(peers.find(x=>x.address===A(31))).warnings.includes('CRASH_NOT_UNDERVALUATION'));
 assert.ok(CF.compute(peers.find(x=>x.address===A(32))).warnings.includes('DILUTION_RISK_LOW_CIRCULATING_SHARE'));
 assert.ok(CF.compute(peers[0]).warnings.includes('UNLOCK_SCHEDULE_NOT_MEASURED'),'unlocks without data are flagged, not assumed');
 // missing valuation data is unmeasured (0 credit), never estimated
 const none=CF.compute(r(36,{marketCapUsd:null,fdvUsd:null}));
 assert.equal(none.components.upsideAsymmetry<0.5,true);
 assert.ok(none.unmeasured.includes('upsideAsymmetry'));
 const info=CF.info({...peers[0],researchRank:CF.rank(peers[0],1)},'ethereum');
 assert.match(info,/getiri tahmini değildir/);
 assert.doesNotMatch(info,/garanti(li)? (2|5|10|100)x/i);
 // ranking only: upside asymmetry never removes an eligible row
 assert.equal(CF.veto(peers.find(x=>x.address===A(32))),null);
});

test('ETR-5: Pons priority — a contract listed under Pons never appears in Robinhood; Robinhood refills before selection',async()=>{
 const ADDR=n=>A(n);
 const rh=(n,o={})=>({address:ADDR(n),chainId:4663,symbol:'R'+n,name:'R'+n,priceUsd:0.2,liquidityUsd:90000,volume24hUsd:60000,change24hPct:-4,officialLinks:{websites:['https://r'+n+'.example'],socials:[]},...o});
 const pons={ok:true,network:'pons',chainId:4663,asOf:new Date(NOW).toISOString(),freshness:'FRESH',
  tokens:[{...rh(1),symbol:'P1',launch:{status:'ONCHAIN_VERIFIED'}},{...rh(2),symbol:'P2'}]};
 const robin={ok:true,network:'robinhood',chainId:4663,asOf:new Date(NOW).toISOString(),freshness:'FRESH',
  tokens:[rh(1),rh(2),rh(3),rh(4),rh(5)]};
 const calls=[];
 const result=await E.run({sections:{robinhood:robin,pons},now:NOW,env:{},fetcher:async()=>{throw new Error('NO_NETWORK');},
  limits:{customFilter:true,exit:false,pace:false,crossCheck:false,universe:false,
   ponsMembership:async a=>{calls.push(a);return new Map([[ADDR(2),{factory:'0xf'}],[ADDR(4),{factory:'0xf'}]]);}}});
 const rAll=result.networks.robinhood.all.map(x=>x.address),pAll=result.networks.pons.all.map(x=>x.address);
 for(const a of pAll)assert.equal(rAll.includes(a),false,'Pons contract also in Robinhood intake: '+a);
 assert.deepEqual(rAll.sort(),[ADDR(3),ADDR(5)].sort());
 assert.ok(pAll.includes(ADDR(4)),'factory-confirmed Robinhood contract moved to Pons (expansion)');
 const p4=result.networks.pons.all.find(x=>x.address===ADDR(4));
 assert.equal(p4.launch.status,'ONCHAIN_VERIFIED');
 assert.equal(p4.volume24hUsd,60000,'moved row keeps its observed market data — nothing invented');
 assert.equal(result.ponsExpansion.moved,1);
 assert.equal(result.ponsExpansion.confirmedExisting,1);
 assert.ok(calls[0].length<=40);
 // the moved row is published with its observed Robinhood-intake market data and validates as a Pons row
 const snap=S.build(result,{robinhood:robin,pons},{now:NOW});
 assert.equal(S.validate(snap).ok,true,JSON.stringify(S.validate(snap)));
 const pub=snap.sections.pons.rows.find(x=>x.address===ADDR(4));
 assert.ok(pub,'moved launch published');assert.equal(pub.priceUsd,0.2);assert.equal(pub.launch.status,'ONCHAIN_VERIFIED');
 assert.equal(snap.sections.robinhood.rows.some(x=>pAll.includes(x.address)),false);
 // membership failure: no guessing; Pons-listed contracts still leave Robinhood
 const r2=await E.run({sections:{robinhood:robin,pons},now:NOW,env:{},fetcher:async()=>{throw new Error('NO_NETWORK');},
  limits:{customFilter:true,exit:false,pace:false,crossCheck:false,universe:false,ponsMembership:async()=>{const e=new Error('x');e.code='RADAR_PONS_MEMBERSHIP_UNAVAILABLE';throw e;}}});
 assert.equal(r2.ponsExpansion.error,'RADAR_PONS_MEMBERSHIP_UNAVAILABLE');
 assert.equal(r2.networks.robinhood.all.some(x=>[ADDR(1),ADDR(2)].includes(x.address)),false);
 assert.equal(r2.networks.pons.all.some(x=>x.address===ADDR(4)),false);
 // veto: a factory-verified launch is never a Robinhood row
 assert.equal(CF.veto({...r(9),key:'4663:'+A(9),chainId:4663,network:'robinhood',launch:{status:'ONCHAIN_VERIFIED'}}),'LISTED_IN_PONS');
});

test('ETR-6: snapshot — serve keeps custom-ranked Robinhood/Pons rows (P0 market rules are ranking penalties), still dedupes Pons',async()=>{
 const mk=(network,chainId,base,o={})=>Array.from({length:10},(_,i)=>r(base+i,{network,chainId,key:chainId+':'+A(base+i),...o}));
 const pRows=sel(mk('pons',4663,800,{liquidityUsd:6000,marketSpread:null,volume24hUsd:3000,launch:{status:'ONCHAIN_VERIFIED'}}),{network:'pons'});
 const hRows=sel(mk('robinhood',4663,900,{change24hPct:85}),{network:'robinhood'});
 assert.equal(pRows.length,10);assert.equal(hRows.length,10);
 const at=new Date(NOW).toISOString();
 const eng={riskLedger:[],networks:{pons:{source:{status:'OBSERVED',asOf:at},displayCandidates:pRows,all:pRows,display:{target:10}},
  robinhood:{source:{status:'OBSERVED',asOf:at},displayCandidates:hRows,all:hRows,display:{target:10}}}};
 const tok=rows=>rows.map(x=>({address:x.address,chainId:4663,symbol:x.symbol,priceUsd:x.priceUsd,volume24hUsd:x.volume24hUsd,liquidityUsd:x.liquidityUsd,change24hPct:x.change24hPct}));
 const s=S.build(eng,{pons:{asOf:at,tokens:tok(pRows)},robinhood:{asOf:at,tokens:tok(hRows)}},{now:NOW});
 assert.equal(S.validate(s).ok,true,JSON.stringify(S.validate(s)));
 const fetcher=async()=>({ok:true,status:200,text:async()=>JSON.stringify(s)}),env={RADAR_V4_OPPORTUNITY_ENABLED:'true'};
 S._reset();
 const p=await S.serve('pons',{env,fetcher,now:NOW}),h=await S.serve('robinhood',{env,fetcher,now:NOW});
 assert.equal(p.data.tokens.length,10,'thin Pons markets ranked low, not removed');
 assert.equal(h.data.tokens.length,10,'pumped Robinhood rows ranked low, not removed');
 // a Pons contract slipped into the Robinhood rows is still removed at serve time
 const dupServe=structuredClone(s);dupServe.sections.robinhood.rows[0].launch={status:'ONCHAIN_VERIFIED'};
 S._reset();
 const h2=await S.serve('robinhood',{env,fetcher:async()=>({ok:true,status:200,text:async()=>JSON.stringify(dupServe)}),now:NOW});
 assert.ok(!h2.data||h2.data.tokens.length<=9);
 S._reset();
 const dup=structuredClone(s);dup.sections.robinhood.rows[0].address=dup.sections.pons.rows[0].address;
 assert.equal(S.validate(dup).ok,false,'Pons/Robinhood duplicate rejected');
});

test('ETR-7: snapshot guards — order, score range, critical findings, identity, 11 rows',()=>{
 const rows=sel(Array.from({length:12},(_,i)=>r(300+i,{volume24hUsd:120000+i*9000})));
 const eng={riskLedger:[],networks:{ethereum:{source:{status:'OBSERVED',asOf:new Date(NOW).toISOString()},displayCandidates:rows,all:rows,display:{target:10}}}};
 const input={ethereum:{asOf:new Date(NOW).toISOString(),tokens:rows.map(x=>({address:x.address,chainId:1,symbol:x.symbol,priceUsd:x.priceUsd,volume24hUsd:x.volume24hUsd,liquidityUsd:x.liquidityUsd,change24hPct:x.change24hPct}))}};
 const s=S.build(eng,input,{now:NOW});
 assert.equal(S.validate(s).ok,true,JSON.stringify(S.validate(s)));
 assert.equal(s.sections.ethereum.rows.length,10);
 const rr=s.sections.ethereum.rows[0].opportunity.researchRank;
 assert.equal(rr.version,CF.VERSION);assert.ok('upsideAsymmetry' in rr.components);
 const mut=f=>{const b=structuredClone(s);f(b.sections.ethereum.rows);return S.validate(b).ok;};
 assert.equal(mut(x=>{x[0].opportunity.researchRank.researchScore=101;}),false);
 assert.equal(mut(x=>{x[9].opportunity.researchRank.researchScore=x[0].opportunity.researchRank.researchScore+5;}),false,'order must follow score');
 assert.equal(mut(x=>{x[0].opportunity.integrity.confirmedCritical=['HONEYPOT_OR_FAILED_EXIT'];}),false);
 assert.equal(mut(x=>{x[0].opportunity.identityLevel='EXACT_CONTRACT_OBSERVED';}),false,'unverifiable profile rejected');
 assert.equal(mut(x=>{x.push({...x.at(-1),rank:11,address:A(999)});}),false);
 // #302 (`arcy-custom-filter-1`) data-branch snapshots remain readable, so the builder does not refuse the previous risk ledger
 assert.equal(mut(x=>{for(const y of x){y.opportunity.researchRank.version='arcy-custom-filter-1';y.opportunity.researchRank.researchBand='MARKET_OPPORTUNITY_WATCH';}}),true);
});

test('ETR-8: pegged / stable assets need a declared peg AND a price at that peg; a $1 project is not a stablecoin',()=>{
 const CAT=require('../lib/radar-v2/intel/category');
 const c=o=>CAT.classify({chainId:4663,address:A(77),...o},'robinhood',NOW).category;
 assert.equal(c({symbol:'U',name:'United Stables',priceUsd:0.9992}),'STABLECOIN','Robinhood U');
 assert.equal(c({symbol:'GBPA',name:'Agant GBP',priceUsd:1.31,change24hPct:-0.08}),'STABLECOIN','Arc GBPA (GBP peg band)');
 assert.equal(c({symbol:'KAIRO',name:'Kairo',priceUsd:1.0,change24hPct:0.1}),'EARLY_STAGE_CANDIDATE','price near $1 alone is not a peg');
 assert.equal(c({symbol:'GBPA',name:'Agant GBP',priceUsd:0.42}),'EARLY_STAGE_CANDIDATE','declared but off-peg is not classified stable');
 assert.equal(c({symbol:'USDX',name:'USDX',priceUsd:1.0,change24hPct:9}),'EARLY_STAGE_CANDIDATE','a volatile 24h move contradicts a peg');
 assert.equal(c({symbol:'STABLE',name:'Stable Protocol',priceUsd:0.31}),'EARLY_STAGE_CANDIDATE');
 assert.equal(CF.veto(r(78,{category:{category:'STABLECOIN'}})),'PEGGED_OR_STABLE_ASSET');
 assert.equal(CF.veto(r(79,{category:{category:'WRAPPED_OR_BASE_ASSET'}})),'WRAPPED_OR_REPRESENTATION_ASSET');
});

test('ETR-9: project profile is separate from token identity and ranked by strength',()=>{
 const t=o=>CF.projectProfile(r(80,{identity:{level:'METADATA_CROSS_CORROBORATED',evidence:['EXPLORER_AND_DEX_SYMBOL_MATCH']},...o})).level;
 assert.equal(t({officialLinks:null}),'TOKEN_IDENTITY_ONLY');
 assert.equal(t({}),'PROJECT_CHANNELS_LISTED');
 assert.equal(t({officialLinks:null,dossier:{status:'PARTIAL_EVIDENCE',siteShowsExactAddress:true},officialCheck:{status:'ADDRESS_FOUND'}}),'SELF_PUBLISHED_PROJECT_SITE');
 assert.equal(t({officialLinks:null,dossier:{status:'PARTIAL_EVIDENCE',siteShowsExactAddress:true},officialCheck:{status:'ADDRESS_NOT_FOUND'}}),'TOKEN_IDENTITY_ONLY');
 assert.equal(CF.projectProfile(r(81,{identity:{level:'OFFICIAL_CONTRACT_VERIFIED'}})).level,'OFFICIAL_PROJECT');
 const pi=o=>CF.compute(r(82,o)).components.projectIdentity;
 assert.ok(pi({identity:{level:'OFFICIAL_CONTRACT_VERIFIED'}})>pi({identity:{level:'METADATA_CROSS_CORROBORATED'},dossier:{status:'PARTIAL_EVIDENCE',siteShowsExactAddress:true}}));
 assert.ok(pi({identity:{level:'METADATA_CROSS_CORROBORATED'},dossier:{status:'PARTIAL_EVIDENCE',siteShowsExactAddress:true}})>pi({identity:{level:'METADATA_CROSS_CORROBORATED'}}));
 assert.ok(CF.compute(r(83,{identity:{level:'METADATA_CROSS_CORROBORATED'}})).warnings.includes('PROJECT_CHANNELS_UNVERIFIED'));
});

test('ETR-10: extreme volume/liquidity and fresh spikes are ranking penalties, not exclusions; large caps have limited asymmetry',()=>{
 const clean=r(90,{volume24hUsd:250000,liquidityUsd:450000});
 const churn=r(91,{volume24hUsd:1336571,liquidityUsd:9509,marketSpread:null}); // CATMARIO-like: 140x turnover
 const spiked=r(92,{change24hPct:529,volume24hUsd:67948,liquidityUsd:6277,marketSpread:null}); // ANSEMWIF-like
 const cc=CF.compute(clean),ch=CF.compute(churn),sp=CF.compute(spiked);
 assert.ok(ch.components.organicVolume<0.2,'churn is not organic volume: '+ch.components.organicVolume);
 assert.ok(sp.components.organicVolume<0.3);
 assert.ok(cc.score>ch.score&&cc.score>sp.score);
 assert.ok(ch.warnings.includes('EXCESSIVE_VOLUME_TO_LIQUIDITY'));
 assert.ok(sp.warnings.includes('ALREADY_SPIKED_24H'));
 assert.equal(CF.veto(churn),null);assert.equal(CF.veto(spiked),null,'penalties never become security exclusions');
 const out=sel([churn,spiked,...Array.from({length:8},(_,i)=>r(600+i))]);
 assert.equal(out.length,10);assert.deepEqual(out.slice(-2).map(x=>x.address).sort(),[A(91),A(92)].sort(),'weakest two rank #9/#10');
 // established large cap vs early growing project with the same market quality
 const blue=r(93,{category:{category:'ESTABLISHED_BLUE_CHIP'},eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY'],marketCapUsd:5e9,fdvUsd:5.2e9});
 const early=r(94,{marketCapUsd:2e7,fdvUsd:2.2e7,history:{observations:5,flags:['ACTIVITY_GROWTH_OBSERVED'],drawdownFromPeakPct:-32}});
 assert.ok(CF.compute(early).components.upsideAsymmetry>CF.compute(blue).components.upsideAsymmetry);
 assert.ok(CF.compute(blue).warnings.includes('LARGE_CAP_LIMITED_ASYMMETRY'));
 assert.equal(CF.veto(blue),null,'established projects are not excluded');
});
