'use strict';
// Radar V3/V4 near-match classification (issue #279). Adaptive DISCOVERY, never adaptive SAFETY.
//
//   QUALIFIED     passed every V3 ranking gate (ranked list, diversity cap, or only cut by the top-10 capacity) after the
//                 independent cross-check.
//   NEAR_MATCH    passed V3 verification, failed only configurable NON-critical numeric thresholds (24h volume, liquidity
//                 floor, trade count) by at most MAX_DISTANCE of the threshold, with price + liquidity evidence and a
//                 known >=24h pool age. Ranked by distance, then evidence quality, liquidity, activity, freshness.
//   MONITOR_ONLY  interesting but insufficiently evidenced (cross-check pending, young/unknown pool age, unverified field,
//                 or farther from thresholds). Max MONITOR_MAX per section, always last, missing proofs listed.
//   HARD / CONFLICT  never displayed (implausible price, volume/liquidity inconsistency, source disagreement).
// V4's own hard gates (category, critical risk, persistent risk holds, contradictions) are applied separately by the engine
// and always win: a NEAR_MATCH that V4 excludes is never shown.
const D=require('../discovery');
const MAX_DISTANCE=0.5,MONITOR_DISTANCE=0.9,MONITOR_MAX=3,MIN_TRADES=10,DAY=86400000;
const CRITICAL=new Set(['PRICE_IMPLAUSIBLE','VOLUME_LIQUIDITY_INCONSISTENT']);
const EVIDENCE_GATES=new Set(['PRICE_NOT_VERIFIED','VOLUME_NOT_VERIFIED','LIQUIDITY_NOT_VERIFIED','NO_TOKEN_LEVEL_DATA','POOL_AGE_NOT_VERIFIED','POOL_UNDER_24H']);
const QUALIFIED_STAGES=new Set(['RANKED','DIVERSITY_CAP','BELOW_TOP_10']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const okStatus=s=>s==='CROSS_VERIFIED'||s==='SOURCE_REPORTED';
function thresholds(network){const p=D.PROFILES[network]||D.PROFILES.robinhood;return {VOLUME_BELOW_NETWORK_FLOOR:p.minVol,LIQUIDITY_BELOW_NETWORK_FLOOR:p.minLiq,TOO_FEW_TRADES:MIN_TRADES};}
function measured(gate,c){
 if(gate==='VOLUME_BELOW_NETWORK_FLOOR')return c.volume24hUsd;
 if(gate==='LIQUIDITY_BELOW_NETWORK_FLOOR')return c.liquidityUsd;
 if(gate==='TOO_FEW_TRADES')return finite(c.buys24h)&&finite(c.sells24h)?c.buys24h+c.sells24h:null;
 return null;
}
function classify(c,network,now=Date.now()){
 const v3=c.v3||{stage:'UNKNOWN',gates:[]},gates=[...new Set(v3.gates||[])],ver=v3.verification||null;
 const th=thresholds(network);
 const missed=[],pending=[],passed=[];
 if(ver?.sourcesDisagree)return {discoveryClass:'CONFLICT',reason:'INDEPENDENT_SOURCES_DISAGREE',missed,pending,passed,maxDistance:null};
 const critical=gates.filter(g=>CRITICAL.has(g));
 if(critical.length)return {discoveryClass:'HARD',reason:critical.join(','),missed,pending,passed,maxDistance:null};
 if(QUALIFIED_STAGES.has(v3.stage)&&!gates.length)
  return {discoveryClass:'QUALIFIED',reason:'PASSED_ALL_RANKING_GATES',missed,pending,passed:['RANKING_GATES','INDEPENDENT_CROSS_CHECK_STAGE'],maxDistance:0};
 for(const g of gates){
  if(EVIDENCE_GATES.has(g)){pending.push(g);continue;}
  if(Object.hasOwn(th,g)){
   const value=measured(g,c),threshold=th[g];
   const distance=finite(value)&&value>=0?Math.max(0,+(1-value/threshold).toFixed(3)):1;
   missed.push({gate:g,value:finite(value)?value:null,threshold,distance});continue;
  }
  pending.push(g);// any unknown gate counts as missing evidence, never as passed
 }
 // Evidence the claims need: price and liquidity status, and (for NEAR_MATCH) the independent cross-check stage.
 const verifiedStage=v3.stage==='POST_VERIFICATION_GATES';
 if(!verifiedStage)pending.push(v3.stage==='BELOW_SHORTLIST'||v3.stage==='BELOW_FINALISTS'||v3.stage==='POOL_LEVEL_GATES'?'INDEPENDENT_CROSS_CHECK_PENDING':'SOURCE_STAGE_'+v3.stage);
 const priceOk=verifiedStage?okStatus(ver?.fields?.priceUsd):finite(c.priceUsd);
 const liqOk=verifiedStage?okStatus(ver?.fields?.liquidityUsd):finite(c.liquidityUsd);
 if(!priceOk)pending.push('PRICE_CORROBORATION_MISSING');
 if(!liqOk)pending.push('LIQUIDITY_VERIFICATION_PENDING');
 const age=D.ageDays(c,now);
 if(age===null)pending.push('POOL_AGE_UNKNOWN');else if(age<1)pending.push('POOL_UNDER_24H');
 if(!finite(c.buys24h)||!finite(c.sells24h))pending.push('TRANSACTION_HISTORY_INSUFFICIENT');
 if(priceOk)passed.push('PRICE_EVIDENCE');if(liqOk)passed.push('LIQUIDITY_EVIDENCE');if(age!==null&&age>=1)passed.push('POOL_AGE_24H');
 const maxDistance=missed.length?Math.max(...missed.map(m=>m.distance)):0;
 const uniquePending=[...new Set(pending)];
 if(!uniquePending.length&&missed.length&&maxDistance<=MAX_DISTANCE)
  return {discoveryClass:'NEAR_MATCH',reason:'NARROWLY_MISSED_NONCRITICAL_THRESHOLDS',missed,pending:uniquePending,passed,maxDistance};
 if(finite(c.priceUsd)&&finite(c.liquidityUsd)&&maxDistance<=MONITOR_DISTANCE)
  return {discoveryClass:'MONITOR_ONLY',reason:uniquePending.length?'INSUFFICIENT_EVIDENCE':'FAR_FROM_THRESHOLDS',missed,pending:uniquePending,passed,maxDistance};
 return {discoveryClass:'NOT_SHOWN',reason:finite(c.priceUsd)&&finite(c.liquidityUsd)?'TOO_FAR_FROM_THRESHOLDS':'NO_OBSERVED_MARKET',missed,pending:uniquePending,passed,maxDistance};
}
const LABEL=Object.freeze({
 MISSED:{VOLUME_BELOW_NETWORK_FLOOR:'24s hacim',LIQUIDITY_BELOW_NETWORK_FLOOR:'likidite',TOO_FEW_TRADES:'işlem sayısı'},
 PENDING:{INDEPENDENT_CROSS_CHECK_PENDING:'bağımsız kaynak karşılaştırması bekleniyor',PRICE_CORROBORATION_MISSING:'fiyat ikinci kaynakla doğrulanmadı',
  LIQUIDITY_VERIFICATION_PENDING:'likidite doğrulaması bekleniyor',POOL_AGE_UNKNOWN:'havuz yaşı bilinmiyor',POOL_UNDER_24H:'havuz 24 saatten yeni',
  TRANSACTION_HISTORY_INSUFFICIENT:'işlem geçmişi yetersiz',PRICE_NOT_VERIFIED:'fiyat doğrulanmadı',VOLUME_NOT_VERIFIED:'hacim doğrulanmadı',
  LIQUIDITY_NOT_VERIFIED:'likidite doğrulanmadı',NO_TOKEN_LEVEL_DATA:'token düzeyi veri yok',POOL_AGE_NOT_VERIFIED:'havuz yaşı doğrulanmadı'}
});
// Short Turkish prefix for the existing Info control. "Passed checks" never means "safe".
function infoPrefix(k){
 if(!k)return null;
 if(k.discoveryClass==='QUALIFIED')return 'NİTELİKLİ — tüm sıralama eşiklerini geçti';
 const miss=k.missed.map(m=>(LABEL.MISSED[m.gate]||m.gate)+' eşiğin %'+Math.round((1-m.distance)*100)+'’i').join(', ');
 if(k.discoveryClass==='NEAR_MATCH')return 'YAKIN EŞLEŞME — kritik risk kontrollerinden geçti (güvenlik garantisi değildir), '+(miss||'kapasite sınırı')+', momentum izleniyor';
 if(k.discoveryClass==='MONITOR_ONLY'){
  const p=k.pending.slice(0,3).map(x=>LABEL.PENDING[x]||x).join(', ');
  return 'SADECE İZLEME — onaylı veya düşük riskli değildir, eksik: '+(p||miss||'kanıt');
 }
 return null;
}
module.exports={classify,infoPrefix,thresholds,MAX_DISTANCE,MONITOR_DISTANCE,MONITOR_MAX,CRITICAL,QUALIFIED_STAGES};
