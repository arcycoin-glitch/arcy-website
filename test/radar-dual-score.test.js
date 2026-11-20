'use strict';
// Dual-score SHADOW (`arcy-dual-score-1`): isolation from the production Radar, no estimates for missing data, vetoes first.
const test=require('node:test'),assert=require('node:assert/strict');
const DS=require('../lib/radar-v2/intel/dual-score');
const CF=require('../lib/radar-v2/intel/custom-filter');
const E=require('../lib/radar-v2/intel/engine');
const S=require('../lib/radar-v2/v4-snapshot');
const NOW=Date.parse('2026-11-20T13:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0');
const PROFILE={universe:{identity:{status:'TWO_SOURCE_SYMBOL_MATCH'}},officialLinks:{websites:['https://project.example'],socials:[]}};
const r=(n,net='ethereum',cid=1,o={})=>({key:cid+':'+A(n),network:net,chainId:cid,address:A(n),symbol:'X'+n,name:'Project '+n,
 category:{category:'EARLY_STAGE_CANDIDATE'},eligibility:'REVIEW',reasons:['IDENTITY_NOT_VERIFIED'],risk:[],discoveryClass:'NEAR_MATCH',marketObserved:true,
 poolCreatedAt:new Date(NOW-70*86400000).toISOString(),snapshotNow:NOW,radarAsOf:new Date(NOW-360000).toISOString(),radarFreshness:'FRESH',
 priceUsd:0.1,liquidityUsd:450000,volume24hUsd:250000,change24hPct:-9,trades24h:125,buys24h:72,sells24h:53,marketCapUsd:9e6,fdvUsd:1e7,
 sourceEvidence:{crossCheck:'MATCHED'},v3Verification:{crossCheck:'MATCHED'},history:{observations:3,flags:[],drawdownFromPeakPct:-32},
 marketSpread:{liquidityUsd:{min:430000,max:450000,ratio:1.05}},evidenceConfidence:{score:0.4,missing:[]},opportunity:{score:25,dimensions:{},flags:[]},
 nearMatch:{maxDistance:0.4,missed:[],pending:[],passed:[]},...PROFILE,...(net==='pons'?{launch:{status:'ONCHAIN_VERIFIED'}}:{}),...o});
const sel=(rows,o={})=>E.selectDisplay(rows,{network:'ethereum',now:NOW,filterB:false,customFilter:true,...o});
const fixture=()=>[...Array.from({length:14},(_,i)=>r(100+i,'ethereum',1,{volume24hUsd:120000+i*15000,change24hPct:i%3?-8:4})),
 r(200,'ethereum',1,{risk:['SELL_DISABLED']}),r(201,'ethereum',1,{category:{category:'STABLECOIN'}}),r(202,'ethereum',1,{officialLinks:null})];

test('DS-1: feature flag is OFF by default and only the exact string "true" enables the shadow',()=>{
 assert.equal(DS.enabled({}),false);assert.equal(DS.enabled({RADAR_DUAL_SCORE_SHADOW:'1'}),false);assert.equal(DS.enabled(undefined),false);
 assert.equal(DS.enabled({RADAR_DUAL_SCORE_SHADOW:'true'}),true);
 assert.equal(Object.values(DS.Q_WEIGHTS).reduce((a,b)=>a+b),100);assert.equal(Object.values(DS.O_WEIGHTS).reduce((a,b)=>a+b),100);
});

test('DS-2: production output is byte-identical with the shadow hand-off; the pool is not serialised or spreadable',()=>{
 const a=sel(fixture()),b=sel(fixture());
 assert.equal(JSON.stringify(a),JSON.stringify(b));
 assert.equal(Object.keys(a).includes('rankedPool'),false,'non-enumerable');
 assert.equal(JSON.stringify(a).includes('rankedPool'),false);
 assert.ok(Array.isArray(a.rankedPool)&&a.rankedPool.length>=10);
 // running the shadow must not mutate production rows
 const before=JSON.stringify(a);DS.shadow({networks:{ethereum:{displayCandidates:a}}},{now:NOW});assert.equal(JSON.stringify(a),before);
 // production snapshot + publication gate unchanged
 const at=new Date(NOW).toISOString(),nets={},input={};let base=1000;
 for(const [n,cid] of Object.entries({arc:5042,ethereum:1,robinhood:4663,pons:4663})){
  const rows=sel(Array.from({length:10},(_,i)=>r(base+i,n,cid)),{network:n});base+=100;
  nets[n]={source:{status:'OBSERVED',asOf:at},displayCandidates:rows,all:rows,display:{target:10,shortfall:null}};
  input[n]={asOf:at,tokens:rows.map(x=>({address:x.address,chainId:cid,symbol:x.symbol,priceUsd:x.priceUsd,volume24hUsd:x.volume24hUsd,liquidityUsd:x.liquidityUsd,change24hPct:x.change24hPct}))};}
 const snap=S.build({riskLedger:[],networks:nets},input,{now:NOW,commit:'c'});
 const json=JSON.stringify(snap);
 DS.shadow({networks:nets},{now:NOW});
 assert.equal(JSON.stringify(snap),json);
 assert.equal(json.includes('dual-score'),false);assert.equal(json.includes('rankedPool'),false);
 assert.equal(S.publishable(snap,{commit:'c'}).ok,true);
});

test('DS-3: vetoes first — scam, stablecoin and unverifiable profiles never reach the dual scores, even if injected',()=>{
 const out=sel(fixture());
 const injected=[...out.rankedPool,r(300,'ethereum',1,{risk:['SELL_DISABLED'],volume24hUsd:9e8}),r(301,'ethereum',1,{category:{category:'STABLECOIN'}})];
 const dc=Object.assign([...out],{});Object.defineProperty(dc,'rankedPool',{value:injected,enumerable:false});
 const sh=DS.shadow({networks:{ethereum:{displayCandidates:dc}}},{now:NOW});
 const keys=sh.networks.ethereum.rows.map(x=>x.key);
 for(const bad of [A(200),A(201),A(202),A(300),A(301)])assert.equal(keys.includes('1:'+bad),false,bad);
 assert.equal(sh.networks.ethereum.vetoedInShadow,2);
 assert.equal(sh.servedToUsers,false);
});

test('DS-4: missing data is UNMEASURED and scores 0 — never estimated',()=>{
 const bare=r(400,'ethereum',1,{activity:null,compression:null,evidenceSummary:null,dossier:null,marketSpread:null});
 const q=DS.quality(bare),o=DS.opportunity(bare);
 assert.equal(q.components.community.score,0);assert.equal(q.components.community.coverage,0);
 assert.ok(q.components.teamDevelopment.unmeasured.includes('TEAM_IDENTITY_AND_SIZE_NO_SOURCE'));
 assert.equal(o.components.volumeCompression.score,0);assert.equal(o.components.volumeCompression.coverage,0);
 assert.equal(o.components.volumeAcceleration.score,0);assert.ok(o.components.volumeAcceleration.unmeasured.includes('INTRADAY_VOLUME_WINDOWS_NOT_AVAILABLE'));
 assert.ok(o.components.userTxGrowth.unmeasured.includes('UNIQUE_WALLET_GROWTH_NO_BASELINE'));
 assert.ok(q.coverage<100&&o.coverage<100);
 for(const c of [...Object.values(q.components),...Object.values(o.components)])assert.ok(c.score>=0&&c.score<=c.max);
});

test('DS-5: acceleration is real only with sane turnover; churn, spikes and low liquidity are not opportunity',()=>{
 const act=(v6,v24,t6=60,t24=120)=>({volumeUsd:{h1:null,h6:v6,h24:v24},trades:{h1:null,h6:t6,h24:t24},buyers:{h24:80},sellers:{h24:40}});
 const good=DS.opportunity(r(500,'ethereum',1,{activity:act(150000,250000)}));
 const flat=DS.opportunity(r(501,'ethereum',1,{activity:act(62500,250000,30,120)}));
 const churn=DS.opportunity(r(502,'ethereum',1,{liquidityUsd:9500,marketSpread:null,activity:act(900000,1336571)}));
 const spike=DS.opportunity(r(503,'ethereum',1,{change24hPct:529,activity:act(50000,67948)}));
 assert.ok(good.components.volumeAcceleration.score>15);
 assert.equal(flat.components.volumeAcceleration.score,0);
 assert.equal(churn.components.volumeAcceleration.score,0);
 assert.equal(spike.components.volumeAcceleration.score,0);assert.equal(spike.components.earlyDiscovery.evidence.some(e=>e.startsWith('ALREADY_RAN')),true);
 const thin=DS.quality(r(504,'ethereum',1,{liquidityUsd:15000,marketSpread:null}));
 assert.ok(thin.components.liquidityHealth.score<DS.quality(r(505)).components.liquidityHealth.score);
});

test('DS-6: established quality projects never take the early-discovery points; a young growing project outranks them',()=>{
 const act={volumeUsd:{h1:null,h6:120000,h24:250000},trades:{h1:null,h6:70,h24:140},buyers:{h24:90},sellers:{h24:50}};
 const blue=r(600,'ethereum',1,{category:{category:'ESTABLISHED_BLUE_CHIP'},eligibility:'EXCLUDE',reasons:['NOT_EARLY_STAGE_CATEGORY'],identity:{level:'OFFICIAL_CONTRACT_VERIFIED'},
  marketCapUsd:5e9,fdvUsd:5.2e9,poolCreatedAt:new Date(NOW-900*86400000).toISOString(),liquidityUsd:2.5e7,volume24hUsd:5e6,activity:{...act,volumeUsd:{h1:null,h6:1250000,h24:5e6}},
  evidenceSummary:{product:'VERIFIED_ACTIVE',risk:{mint:'X',admin:'Y',holders:'Z'},exit:{status:'EXIT_SIMULATED'}}});
 const young=r(601,'ethereum',1,{poolCreatedAt:new Date(NOW-12*86400000).toISOString(),marketCapUsd:4e6,fdvUsd:4.2e6,activity:act});
 assert.equal(DS.opportunity(blue).components.earlyDiscovery.score,0);
 assert.ok(DS.quality(blue).score>DS.quality(young).score,'quality is a separate axis');
 assert.ok(DS.opportunity(young).score>DS.opportunity(blue).score);
 // in the shadow order the young project ranks above the blue chip even though the blue chip has higher quality
 const out=sel([blue,young,...Array.from({length:9},(_,i)=>r(610+i))]);
 const sh=DS.shadow({networks:{ethereum:{displayCandidates:out}}},{now:NOW});
 const ord=sh.networks.ethereum.rows.map(x=>x.key);
 assert.ok(ord.indexOf('1:'+A(601))<ord.indexOf('1:'+A(600)));
});

test('DS-7: four networks independently; Pons/Robinhood duplicates impossible in shadow (production pools only)',()=>{
 const nets={};let base=2000;
 for(const [n,cid] of Object.entries({arc:5042,ethereum:1,robinhood:4663,pons:4663})){nets[n]={displayCandidates:sel(Array.from({length:12},(_,i)=>r(base+i,n,cid)),{network:n})};base+=100;}
 nets.robinhood.displayCandidates=sel(Array.from({length:12},(_,i)=>r(2500+i,'robinhood',4663,i===0?{launch:{status:'ONCHAIN_VERIFIED'}}:{})),{network:'robinhood'});
 const sh=DS.shadow({networks:nets},{now:NOW});
 for(const n of ['arc','ethereum','robinhood','pons']){assert.equal(sh.networks[n].status,'OK');assert.equal(sh.networks[n].dualTop10.length,10);}
 const p=new Set(sh.networks.pons.rows.map(x=>x.key));
 assert.equal(sh.networks.robinhood.rows.filter(x=>p.has(x.key)).length,0);
 assert.equal(sh.networks.robinhood.rows.some(x=>x.key==='4663:'+A(2500)),false,'Pons launch never a Robinhood row');
 // API error / missing network: reported, nothing invented
 const partial=DS.shadow({networks:{arc:nets.arc}},{now:NOW});
 assert.equal(partial.networks.pons.status,'NO_RANKED_POOL');
});
