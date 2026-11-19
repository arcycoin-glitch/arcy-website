'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Q=require('../lib/radar-v2/intel/discovery-quality');
const {selectDisplay}=require('../lib/radar-v2/intel/engine');
const NOW=Date.parse('2026-11-18T18:00:00Z'),A=n=>'0x'+n.toString(16).padStart(40,'0');
const row=(n,props={})=>({key:'5042:'+A(n),network:'arc',chainId:5042,address:A(n),symbol:'Token'+n,
 eligibility:'REVIEW',discoveryClass:'MONITOR_ONLY',reasons:[],marketObserved:true,
 priceUsd:0.0001,liquidityUsd:30000,volume24hUsd:7000,change24hPct:12,trades24h:40,
 poolCreatedAt:new Date(NOW-3*86400000).toISOString(),snapshotNow:NOW,
 artwork:{url:'https://assets.geckoterminal.com/verified-decorative-art'},
 nearMatch:{maxDistance:0.3,pending:['INDEPENDENT_CROSS_CHECK_PENDING'],passed:['PRICE_EVIDENCE']},
 v3Verification:{crossCheck:'MATCHED'},
 opportunity:{score:23,dimensions:{product:0,team:0,adoption:0}},
 evidenceConfidence:{score:20,missing:['IDENTITY','EXIT','SELL']},...props});
test('actual post-rally and zero-liquidity patterns cannot fill Arc watchlist',()=>{
 for(const [symbol,change] of [['SHARK',238.712],['Gamooor',202.725],['Louie',199.526]]){
  const r=row(1,{symbol,change24hPct:change,liquidityUsd:0,artwork:null});
  assert.equal(Q.reason(r,'arc'),'ALREADY_SPIKED_24H',symbol);
  assert.equal(selectDisplay([r],{network:'arc'}).length,0);
 }
 const w=row(2,{network:'ethereum',chainId:1,key:'1:'+A(2),symbol:'WASTED',
 change24hPct:30636.245,liquidityUsd:312226,volume24hUsd:4442184});
 assert.equal(Q.reason(w,'ethereum'),'ALREADY_SPIKED_24H');
 assert.equal(selectDisplay([w],{network:'ethereum'}).length,0);
});
test('positive + post-rally negatives are suppressed, but ordinary market moves remain observable',()=>{
 assert.equal(Q.reason(row(10,{change24hPct:69.9}),'arc'),null);
 assert.equal(Q.reason(row(11,{change24hPct:70}),'arc'),'ALREADY_SPIKED_24H');
 assert.equal(Q.reason(row(12,{change24hPct:-49.9}),'arc'),null);
 assert.equal(Q.reason(row(13,{change24hPct:-50}),'arc'),'EXTREME_DRAWDOWN_24H');
 assert.equal(Q.reason(row(14,{change24hPct:null}),'arc'),'MOMENTUM_NOT_OBSERVED');
});
test('unverified or micro-liquidity cannot be promoted even with a good score and 10-row shortfall',()=>{
 const base=row(20,{discoveryClass:'NEAR_MATCH'});
 const cases=[
  [{liquidityUsd:0},'LIQUIDITY_DEPTH_INSUFFICIENT'],
  [{liquidityUsd:null},'LIQUIDITY_DEPTH_INSUFFICIENT'],
  [{liquidityUsd:9999},'LIQUIDITY_DEPTH_INSUFFICIENT'],
  [{volume24hUsd:1249},'ORGANIC_ACTIVITY_NOT_ESTABLISHED'],
  [{volume24hUsd:180000,liquidityUsd:20000},'HIGH_VOLUME_TO_LIQUIDITY_RATIO'],
  [{trades24h:null},'TRADES_INSUFFICIENT'],
  [{v3Verification:null},'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED'],
  [{priceUsd:null},'PRICE_NOT_OBSERVED']
 ];
 for(const [p,code] of cases)assert.equal(Q.reason({...base,...p},'arc'),code,JSON.stringify(p));
 const eth=row(21,{network:'ethereum',chainId:1,key:'1:'+A(21),liquidityUsd:100000,volume24hUsd:25000});
 assert.equal(Q.reason(eth,'ethereum'),null);
 assert.equal(Q.reason({...eth,liquidityUsd:99999},'ethereum'),'LIQUIDITY_DEPTH_INSUFFICIENT');
 assert.equal(Q.reason({...eth,volume24hUsd:24999},'ethereum'),'ORGANIC_ACTIVITY_NOT_ESTABLISHED');
});
test('monitor-only pool must be established and identity corroborated; a logo is decorative, never evidence (V5)',()=>{
 assert.equal(Q.reason(row(30,{poolCreatedAt:null}),'arc'),'MATURE_POOL_NOT_EVIDENCED');
 assert.equal(Q.reason(row(31,{poolCreatedAt:new Date(NOW-2*3600000).toISOString()}),'arc'),'MATURE_POOL_NOT_EVIDENCED');
 assert.equal(Q.reason(row(32,{v3Verification:null}),'arc'),'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED');
 assert.equal(Q.reason(row(34,{artwork:null}),'arc'),null,'missing artwork alone never disqualifies a corroborated contract');
 const q=row(33,{discoveryClass:'NEAR_MATCH',poolCreatedAt:null});
 assert.equal(Q.reason(q,'arc'),null,'near match has separate V3 pool age verification');
});
test('10 monitored rows only when all ten pass; existing critical holds and collision gates still win',()=>{
 const good=Array.from({length:12},(_,i)=>row(i+200));
 const out=selectDisplay(good,{network:'arc'});
 assert.equal(out.length,10);
 assert.ok(out.every(r=>r.displayTier==='WATCHLIST_NOT_VERIFIED'));
 const mixed=good.map(r=>({...r}));
 mixed[0].liquidityUsd=0;mixed[1].v3Verification=null;mixed[2].change24hPct=200;
 mixed[3].eligibility='EXCLUDE';mixed[3].reasons=['PERSISTENT_LOW_EXIT_LIQUIDITY'];
 mixed[4].discoveryClass='CONFLICT';mixed[5].symbol='COLLIDE';mixed[6].symbol='COLLIDE';
 const filtered=selectDisplay(mixed,{network:'arc'});
 assert.equal(filtered.length,5);
 assert.deepEqual(filtered.shortfall?.droppedByReason?.ALREADY_SPIKED_24H,1);
 assert.deepEqual(filtered.shortfall?.droppedByReason?.LIQUIDITY_DEPTH_INSUFFICIENT,1);
 assert.deepEqual(filtered.shortfall?.droppedByReason?.EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED,1);
 assert.equal(filtered.shortfall.droppedByReason.PERSISTENT_RISK_HOLD,1);
 assert.equal(filtered.shortfall.droppedByReason.SOURCE_CONFLICT_V3,1);
 assert.equal(filtered.shortfall.droppedByReason.DUPLICATE_TICKER_UNRESOLVED,2);
});
test('other networks keep their microcap liquidity/artwork policy; V5 applies only the extreme-move rule there',()=>{
 assert.equal(Q.reason(row(50,{liquidityUsd:0,change24hPct:5,artwork:null,discoveryClass:'QUALIFIED'}),'robinhood'),null);
 assert.equal(selectDisplay([row(51,{liquidityUsd:0,artwork:null,change24hPct:5,discoveryClass:'QUALIFIED'})],{network:'robinhood'}).length,1);
 // V5: the weakest class (MONITOR_ONLY) needs sourced artwork on every network.
 assert.equal(Q.reason(row(53,{change24hPct:5,v3Verification:null}),'robinhood'),'EXACT_CONTRACT_IDENTITY_NOT_CORROBORATED');
 // V5 (#279): an observed +300% day is not shown as a research candidate on any network.
 assert.equal(Q.reason(row(52,{liquidityUsd:0,change24hPct:300,artwork:null}),'robinhood'),'ALREADY_SPIKED_24H');
});

test('source outages cannot carry forward previously exposed +238% zero-liquidity monitored assets',()=>{
 const S=require('../lib/radar-v2/v4-snapshot'),RH=require('../lib/radar-v2/intel/risk-holds');
 const ledger=RH.list(RH.initial(null));
 const oldRow={
  rank:1,network:'arc',chainId:5042,address:A(980),symbol:'SHARK',name:'Shark Coin',
  priceUsd:0.00002388,liquidityUsd:0,volume24hUsd:23646,change24hPct:238.7,
  buys24h:50,sells24h:20,poolCreatedAt:new Date(NOW-5*86400000).toISOString(),
  measuredAt:new Date(NOW-60000).toISOString(),logo:null,
  fields:{},discovery:{version:'arcy-discovery-2',reason:'old risk-unaware ranking'},
  opportunity:{version:S.OPPORTUNITY_VERSION,displayTier:'WATCHLIST_NOT_VERIFIED',
   eligibility:'REVIEW',category:'EARLY_STAGE_CANDIDATE',discoveryClass:'MONITOR_ONLY',notForecast:true}
 };
 const previous={schema:S.SCHEMA,opportunityVersion:S.OPPORTUNITY_VERSION,
  generatedAt:new Date(NOW-60000).toISOString(),riskLedger:ledger,
  sections:{arc:{status:'BUILT',asOf:new Date(NOW-60000).toISOString(),rows:[oldRow],
   counts:{displayed:1,watchOnly:1},display:{shown:1,byClass:{MONITOR_ONLY:1}},presentation:{watchlist:[]}}}};
 assert.equal(S.validate(previous).ok,true,'old row was formally valid under legacy snapshot schema');
 const next={...previous,generatedAt:new Date(NOW).toISOString(),
  sections:{arc:{status:'NOT_BUILT',asOf:null,rows:[]}}};
 const merged=S.merge(previous,next);
 assert.equal(S.validate(merged).ok,true);
 assert.equal(merged.sections.arc.carriedForward,true);
 assert.equal(merged.sections.arc.rows.length,0,'risk-like post-rally filler must not be resurrected');
 assert.equal(merged.sections.arc.qualityRowsRemoved,1);
 assert.equal(merged.sections.arc.display.shortfall.droppedByReason.CARRIED_QUALITY_FILTER_REMOVED,1);
});
