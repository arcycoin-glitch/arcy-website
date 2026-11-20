'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../lib/radar-v2/v4-snapshot');
const RH=require('../lib/radar-v2/intel/risk-holds');
const Q=require('../lib/radar-v2/intel/discovery-quality');
const NOW=Date.parse('2026-11-20T06:45:00.000Z');
const iso=ms=>new Date(NOW-ms).toISOString();
const A=i=>'0x'+i.toString(16).padStart(40,'0');
function row(i,network,cls,changes={}){
 return {
  rank:i,network,chainId:4663,address:A((network==='pons'?100:0)+i),
  symbol:'TEST'+i,name:'Contract observation '+i,
  priceUsd:0.001,volume24hUsd:200000,liquidityUsd:200000,
  change24hPct:5,buys24h:60,sells24h:40,poolCreatedAt:iso(4*86400000),measuredAt:iso(60000),
  logo:{url:'https://assets.geckoterminal.com/example'},
  fields:{},discovery:{version:'arcy-discovery-2',score:48,reason:'fixture'},
  opportunity:{version:S.OPPORTUNITY_VERSION,eligibility:'REVIEW',category:'EARLY_STAGE_CANDIDATE',
   displayTier:'WATCHLIST_NOT_VERIFIED',discoveryClass:cls,notForecast:true},
  ...changes
 };
}
const section=(rows,extra={})=>({status:'BUILT',asOf:iso(60000),
 rows,display:{shown:rows.length,byClass:rows.reduce((o,r)=>{o[r.opportunity.discoveryClass]=(o[r.opportunity.discoveryClass]||0)+1;return o;},{})},
 counts:{displayed:rows.length,watchOnly:rows.length},presentation:{watchlist:[]},...extra});
function previous(){
 return {schema:S.SCHEMA,opportunityVersion:S.OPPORTUNITY_VERSION,generatedAt:iso(60000),
  riskLedger:RH.list(RH.initial(null)),
  sections:{
   robinhood:section([
    row(1,'robinhood','QUALIFIED',{symbol:'CASHCAT'}),
    row(2,'robinhood','MONITOR_ONLY',{symbol:'WANTED',change24hPct:1280.336,logo:null}),
    row(3,'robinhood','MONITOR_ONLY',{symbol:'RUGPULL',change24hPct:575.462,logo:null}),
    row(4,'robinhood','MONITOR_ONLY',{symbol:'Maxxing',logo:null})
   ]),
   pons:section([
    row(1,'pons','QUALIFIED',{symbol:'PONS',liquidityUsd:2e6,volume24hUsd:5e6}),
    row(2,'pons','QUALIFIED',{symbol:'MORI',liquidityUsd:3008.82,volume24hUsd:2607.11}),
    row(3,'pons','MONITOR_ONLY',{symbol:'OURANIA',liquidityUsd:2876,volume24hUsd:116})
   ],{status:'BUILT_FROM_STALE_SOURCE',sourceRadarAsOf:iso(3*3600000)})
  }};
}
test('previous production-like snapshot with pumps and thin launches is valid but NEVER promoted by serving',async()=>{
 const snap=previous();assert.deepEqual(S.validate(snap),{ok:true});
 const fetcher=async()=>({ok:true,status:200,text:async()=>JSON.stringify(snap)});
 const env={RADAR_V4_OPPORTUNITY_ENABLED:'true'};
 S._reset();
 const rh=await S.serve('robinhood',{env,fetcher,now:NOW});
 assert.equal(rh.reason,null);
 assert.equal(rh.data.opportunity.servedList,'V4_OPPORTUNITY');
 assert.deepEqual(rh.data.tokens.map(x=>x.symbol),['CASHCAT']);
 assert.equal(rh.data.opportunity.shown,1);
 assert.deepEqual(rh.data.opportunity.shownByClass,{QUALIFIED:1});
 assert.equal(rh.data.opportunity.qualityVetoReasons.ALREADY_SPIKED_24H,2);
 assert.equal(rh.data.opportunity.qualityVetoReasons.PRELIMINARY_WATCH_NOT_MAIN_RANKING,1);
 assert.equal(rh.data.opportunity.shortfall.shown,1);
 assert.equal(rh.data.opportunity.counts.displayed,1);
 const p=await S.serve('pons',{env,fetcher,now:NOW});
 assert.deepEqual(p.data.tokens.map(x=>x.symbol),['PONS']);
 assert.equal(p.data.opportunity.qualityVetoReasons.PREMIUM_LIQUIDITY_INSUFFICIENT,2);
 assert.equal(p.data.opportunity.status,'STALE','old source observation must not appear FRESH because snapshot was just rebuilt');
 assert.equal(p.data.staleReason,'UPSTREAM_MARKET_SOURCE_STALE');
 assert.ok(p.data.staleAgeSeconds>=3*3600);
 S._reset();
});
test('on snapshot outage V3 fallback cannot restore the same unsafe Robinhood/Pons rows',()=>{
 const snap=previous();
 for(const network of ['robinhood','pons']){
  const out=S.markUnavailable({ok:true,network,chainId:4663,tokens:snap.sections[network].rows});
  assert.deepEqual(out.tokens.map(x=>x.symbol),[network==='pons'?'PONS':'CASHCAT']);
  assert.equal(out.opportunity.status,'UNAVAILABLE');
 }
});
test('Pons factory/QUALIFIED status does not override the independent $25k liquidity presentation floor',()=>{
 assert.equal(Q.reason({discoveryClass:'QUALIFIED',priceUsd:1,liquidityUsd:3008.82,volume24hUsd:2607.11,change24hPct:0},'pons'),'PREMIUM_LIQUIDITY_INSUFFICIENT');
 assert.equal(Q.reason({discoveryClass:'QUALIFIED',priceUsd:1,liquidityUsd:35000,volume24hUsd:12000,change24hPct:0},'pons'),null);
});
test('carried-forward stale Pons launch does not regain premium status during provider outages',()=>{
 const prev=previous();
 const next={...prev,generatedAt:iso(0),sections:{...prev.sections,pons:{status:'NOT_BUILT',rows:[],asOf:null}}};
 const merged=S.merge(prev,next);
 assert.equal(S.validate(merged).ok,true);
 assert.equal(merged.sections.pons.carriedForward,true);
 assert.deepEqual(merged.sections.pons.rows.map(x=>x.symbol),['PONS']);
 assert.equal(merged.sections.pons.qualityRowsRemoved,2);
});
