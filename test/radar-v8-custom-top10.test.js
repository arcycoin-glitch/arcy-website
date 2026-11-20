'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const CF=require('../lib/radar-v2/intel/custom-filter');
const E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot');
const NOW=Date.parse('2026-11-20T13:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0');
const r=(n,opts={})=>({
 key:'1:'+A(n),network:'ethereum',chainId:1,address:A(n),symbol:'X'+n,name:'Project '+n,
 category:{category:'EARLY_STAGE_CANDIDATE'},eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],risk:[],
 discoveryClass:'NEAR_MATCH',marketObserved:true,poolCreatedAt:new Date(NOW-70*86400000).toISOString(),
 snapshotNow:NOW,radarAsOf:new Date(NOW-360000).toISOString(),radarFreshness:'FRESH',
 priceUsd:0.1,liquidityUsd:450000,volume24hUsd:250000,change24hPct:-9,trades24h:125,buys24h:72,sells24h:53,
 sourceEvidence:{crossCheck:'MATCHED',crossVerifiedFields:2,of:3},v3Verification:{crossCheck:'MATCHED'},
 history:{version:'arcy-market-memory-1',observations:3,flags:[],drawdownFromPeakPct:-32},
 marketSpread:{liquidityUsd:{min:430000,max:450000,ratio:1.05}},
 evidenceConfidence:{score:0.4,missing:['IDENTITY']},
 opportunity:{score:25,dimensions:{product:0,team:0,adoption:30},flags:[]},
 nearMatch:{maxDistance:0.4,missed:[],pending:[],passed:[]},
 ...opts
});
test('V8: verified critical risks and scams are never passed to the ranking, unknown proofs remain eligible',()=>{
 assert.equal(CF.veto(r(1)),null,'missing official profile is a low confidence flag, not a scam verdict');
 assert.equal(CF.veto(r(2,{risk:['SELL_DISABLED']})),'CONFIRMED_CONTRACT_OR_EXIT_RISK');
 assert.equal(CF.veto(r(3,{reasons:['SOURCE_CONTRADICTION']})),'VERIFIED_RISK_OR_SOURCE_CONFLICT');
 assert.equal(CF.veto(r(4,{category:{category:'IMPERSONATION_SUSPECT'}})),'UNSUPPORTED_OR_IMPERSONATING_CATEGORY');
 assert.equal(CF.veto(r(5,{eligibility:'EXCLUDE',reasons:['EXCLUDE_ALREADY_RAN_8X']})),'VERIFIED_RISK_OR_SOURCE_CONFLICT');
 assert.equal(CF.veto(r(6,{volume24hUsd:0})),'NO_REAL_MARKET_OBSERVATION');
 assert.equal(CF.veto(r(7),{held:true}),'PERSISTENT_RISK_HOLD');
 const established=r(8,{eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY','IDENTITY_NOT_VERIFIED'],category:{category:'ESTABLISHED_BLUE_CHIP'}});
 assert.equal(CF.veto(established),null,'asset maturity alone is not a scam');
 assert.ok(CF.veto({...established,reasons:[...established.reasons,'DANGEROUS_ADMIN_PRIVILEGE']}));
});
test('V8: activity with a negative price move outranks dead and already-spiking markets without claiming a prediction',()=>{
 const positive=r(10,{change24hPct:-14,volume24hUsd:300000,liquidityUsd:400000});
 const noActivity=r(11,{change24hPct:-14,volume24hUsd:4000,liquidityUsd:400000,trades24h:10});
 const alreadyPumped=r(12,{change24hPct:95,volume24hUsd:300000,liquidityUsd:400000});
 assert.ok(CF.compute(positive).score>CF.compute(noActivity).score);
 assert.ok(CF.compute(positive).score>CF.compute(alreadyPumped).score);
 assert.equal(CF.compute(positive).notForecast,true);
 assert.equal(CF.compute(r(13,{change24hPct:-58})).warnings.includes('SHARP_DAILY_FALL'),true);
});
test('V8: select actual Top 10 with weak candidates at the bottom, never invent replacements or promote hard risks',()=>{
 const rows=Array.from({length:17},(_,i)=>r(i+100,{volume24hUsd:230000-i*8000,change24hPct:i<6?-12:9}));
 rows.push(r(201,{risk:['SELL_DISABLED'],volume24hUsd:9e8}));
 rows.push(r(202,{category:{category:'IMPERSONATION_SUSPECT'},volume24hUsd:9e8}));
 rows.push(r(203,{volume24hUsd:0}));
 rows.push(r(204,{evidenceSummary:{risk:{sell:'SELL_DISABLED_VERIFIED'}}})); // integrity sees critical proof even if a pre-gate forgot it
 const out=E.selectDisplay(rows,{network:'ethereum',now:NOW,filterB:false,customFilter:true});
 assert.equal(out.length,10);
 assert.ok(out.every(x=>x.selectionBasis==='ARCY_CUSTOM_FILTER_1'));
 assert.ok(out.every(x=>x.researchRank.version===CF.VERSION));
 assert.ok(out.every(x=>x.displayTier==='WATCHLIST_NOT_VERIFIED'));
 assert.ok(out.every(x=>!['SELL_DISABLED','IMPERSONATION_SUSPECT'].includes(x.risk?.[0]||x.category?.category)));
 assert.equal(new Set(out.map(x=>x.address)).size,10);
 assert.equal(out.some(x=>x.address===A(204)),false,'post-enrichment verified honeypot is excluded');
 assert.ok(out.every(x=>x.researchRank.researchScore>=0&&x.researchRank.researchScore<=100));
 assert.equal(out.shortfall,null);
 const short=E.selectDisplay([r(1),r(2,{risk:['SELL_DISABLED']}),r(3,{priceUsd:null})],{network:'ethereum',now:NOW,filterB:false,customFilter:true});
 assert.equal(short.length,1,'ten slots never means fake data or a verified failed exit');
 assert.equal(short.shortfall.target,10);
});
test('V8: invalid custom rank ordering, critical findings and old V7 behavior have independent snapshot guards',()=>{
 const rows=E.selectDisplay(Array.from({length:12},(_,i)=>r(i+300)),{network:'ethereum',now:NOW,filterB:false,customFilter:true});
 const eng={riskLedger:[],networks:{ethereum:{source:{status:'OBSERVED',asOf:new Date(NOW).toISOString()},displayCandidates:rows,all:rows,display:{target:10}}}};
 const input={ethereum:{asOf:new Date(NOW).toISOString(),tokens:rows.map(x=>({address:x.address,chainId:1,symbol:x.symbol,priceUsd:x.priceUsd,volume24hUsd:x.volume24hUsd,liquidityUsd:x.liquidityUsd,change24hPct:x.change24hPct}))}};
 const s=S.build(eng,input,{now:NOW});
 assert.equal(S.validate(s).ok,true,JSON.stringify(S.validate(s)));
 assert.equal(s.sections.ethereum.rows.length,10);
 assert.equal(s.sections.ethereum.rows[0].opportunity.researchRank.version,CF.VERSION);
 const bad=structuredClone(s);bad.sections.ethereum.rows[0].opportunity.researchRank.researchScore=101;
 assert.equal(S.validate(bad).ok,false);
 const critical=structuredClone(s);critical.sections.ethereum.rows[0].opportunity.integrity.confirmedCritical=['HONEYPOT_OR_FAILED_EXIT'];
 assert.equal(S.validate(critical).ok,false);
 const huge=structuredClone(s);huge.sections.ethereum.rows.push({...huge.sections.ethereum.rows.at(-1),rank:11,address:A(999)});
 assert.equal(S.validate(huge).ok,false);
});
