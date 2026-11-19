'use strict';
// ARCY Radar V5 — QUALITY EXPANSION (Growth / Established Quality "A-class"), issue #279.
// Reconsiders contracts that V4 removed ONLY because they are not early-stage (NOT_EARLY_STAGE_CATEGORY) — from the V3 window
// or from the separate established/growth universe intake (intel/universe.js) — under hard gates that are never relaxed.
//
// Tiers (labels, not forecasts or safety verdicts):
//   ESTABLISHED (A-class)  maintainer-listed exact contract (EXACT_CONTRACT_LIST) whose identity is corroborated in this run
//                          (two indexers agree on the symbol for the exact contract, or V3's independent cross-check matched).
//   GROWTH                 measured-size established categories without a listing (large cap / mature market), cross-checked,
//                          pool >= 30 days, unique ticker in the window.
// Never: stablecoins, wrapped/base, bridged, commodity, tokenized equity, legacy memes, identity-blocked contracts, Pons Launch,
// any critical risk, persistent risk hold, contradiction/conflict, engine error, or ANY exclusion reason not reviewed below.
// Decorative artwork is NOT a gate (it is shown when sourced, otherwise the existing placeholder is used).
// "Adaptive discovery is permitted. Adaptive safety is not."
const D=require('../discovery');
const QR=require('./quality-rank');
const ALLOWED=new Set(['ESTABLISHED_BLUE_CHIP','ESTABLISHED_LARGE_CAP','MATURE_LEGACY_MARKET']);
const TIERS=new Set(['ESTABLISHED','GROWTH']);
const SEGMENTS=new Set(['ESTABLISHED_PROJECT','GROWING_PROJECT','EMERGING_MOMENTUM']);
// Every reason V4 may attach to such a row must be on this reviewed list; anything else (including codes added later) blocks.
// These are "evidence not yet verified" findings — they are shown as missing verification, never hidden.
const REVIEWED_NON_BLOCKING=new Set(['NOT_EARLY_STAGE_CATEGORY','DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED',
 'PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','RUMOR_UNVERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED',
 'EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED']);
const CRITICAL=new Set(['SELL_DISABLED','UNLIMITED_MINT','DANGEROUS_ADMIN_PRIVILEGE','LOW_EXIT_LIQUIDITY','PERSISTENT_LOW_EXIT_LIQUIDITY','ABANDONED_PROJECT',
 'EXCLUDE_ALREADY_RAN_8X','EXCLUDE_VERIFIED_24H_8X','ISSUER_AFFILIATION_NOT_VERIFIED','CANONICAL_OR_STABLE_ASSET','INVALID_EXACT_CONTRACT',
 'IDENTITY_CATEGORY_BLOCKED','SOURCE_CONTRADICTION','HOLDER_CONCENTRATION_RISK','RADAR_SNAPSHOT_STALE_OR_UNVERIFIED','PONS_FACTORY_NOT_VERIFIED']);
// Larger assets: a 24h move this large is event-driven volatility, not a quality signal (stricter than Filter A's +70/-50).
const MAX_RISE=40,MAX_DROP=-30,MAX_TURNOVER=5,MIN_TRADES=10,MIN_POOL_DAYS=30,MIN_QUALITY=40;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const NETWORKS=new Set(['arc','ethereum','robinhood']); // Pons Launch is a factory-verified launch subset: no expansion.
const listedAndCorroborated=r=>r.category?.basis==='EXACT_CONTRACT_LIST'&&
 (r.universe?.identity?.status==='TWO_SOURCE_SYMBOL_MATCH'||r.sourceEvidence?.crossCheck==='MATCHED');
// Hard gate for one engine row. Returns null when the row may be considered, otherwise a reason code.
function gate(r,network,{tickers,held,now=Date.now()}={}){
 if(!NETWORKS.has(network))return 'B_NETWORK_NOT_IN_SCOPE';
 const reasons=Array.isArray(r?.reasons)?r.reasons:[];
 if(r?.eligibility!=='EXCLUDE'||!reasons.includes('NOT_EARLY_STAGE_CATEGORY'))return 'B_NOT_A_CATEGORY_EXCLUSION';
 if(held?.has(r.key))return 'B_PERSISTENT_RISK_HOLD';
 if(reasons.some(x=>CRITICAL.has(x)||String(x).startsWith('ENGINE_ERROR_'))||(Array.isArray(r.risk)&&r.risk.length))return 'B_CRITICAL_RISK';
 if(reasons.some(x=>!REVIEWED_NON_BLOCKING.has(x)))return 'B_UNREVIEWED_EXCLUSION_REASON';
 const cat=r.category?.category;
 if(!ALLOWED.has(cat))return 'B_CATEGORY_NOT_ELIGIBLE_'+(cat||'UNKNOWN');
 if(r.discoveryClass==='CONFLICT')return 'B_SOURCE_CONFLICT';
 if(r.discoveryClass==='HARD')return 'B_CRITICAL_V3_GATE';
 if(!['QUALIFIED','NEAR_MATCH'].includes(r.discoveryClass||'QUALIFIED'))return 'B_V3_GATES_NOT_MET';
 const p=D.PROFILES[network];
 if(!finite(r.priceUsd)||r.priceUsd<=0)return 'B_PRICE_NOT_OBSERVED';
 if(!finite(r.liquidityUsd)||r.liquidityUsd<p.minLiq)return 'B_LIQUIDITY_BELOW_NETWORK_FLOOR';
 if(!finite(r.volume24hUsd)||r.volume24hUsd<p.minVol*0.5)return 'B_ACTIVITY_BELOW_FLOOR';
 if(r.volume24hUsd>r.liquidityUsd*MAX_TURNOVER)return 'B_HIGH_VOLUME_TO_LIQUIDITY_RATIO';
 if(!finite(r.trades24h)||r.trades24h<MIN_TRADES)return 'B_TRADES_INSUFFICIENT';
 if(!finite(r.change24hPct))return 'B_MOMENTUM_NOT_OBSERVED';
 if(r.change24hPct>=MAX_RISE)return 'B_ALREADY_SPIKED_24H';
 if(r.change24hPct<=MAX_DROP)return 'B_EXTREME_DRAWDOWN_24H';
 const exact=r.category?.basis==='EXACT_CONTRACT_LIST';
 const age=D.ageDays(r,now);
 if(age===null)return 'B_POOL_AGE_NOT_VERIFIED';
 if(!exact&&age<MIN_POOL_DAYS)return 'B_POOL_YOUNGER_THAN_30D';
 if(r.sourceEvidence?.crossCheck==='CONFLICT'||r.sourceEvidence?.sourcesDisagree)return 'B_SOURCE_CONFLICT';
 // Listed contracts need identity corroborated in THIS run; measured-size rows need the independent cross-check
 // (a low-float token can show a huge FDV).
 if(exact&&!listedAndCorroborated(r))return 'B_LISTED_IDENTITY_NOT_CORROBORATED';
 if(!exact&&r.sourceEvidence?.crossCheck!=='MATCHED')return 'B_INDEPENDENT_CROSS_CHECK_MISSING';
 if(!exact&&(tickers?.get(String(r.symbol||'').trim().toLowerCase())?.size||0)>1)return 'B_DUPLICATE_TICKER_UNRESOLVED';
 return null;
}
function tierOf(r){return listedAndCorroborated(r)?'ESTABLISHED':'GROWTH';}
function segmentOf(r,q,now){
 const age=D.ageDays(r,now);
 if(q.components.earlyMomentum>=0.6&&q.components.organicGrowth>=0.5)return 'EMERGING_MOMENTUM';
 if(r.category?.category!=='MATURE_LEGACY_MARKET'&&r.category?.basis!=='EXACT_CONTRACT_LIST'&&age!==null&&age<365)return 'GROWING_PROJECT';
 return 'ESTABLISHED_PROJECT';
}
// rows: every engine result of one network. Returns ALL rows passing the gates (the caller ranks them with Filter A rows).
function expand(rows,network,{aKeys=new Set(),held=new Set(),now=Date.now()}={}){
 const dropped={},take=[];
 const list=Array.isArray(rows)?rows:[];
 const tickers=new Map();for(const r of list){const t=String(r?.symbol||'').trim().toLowerCase();if(t){if(!tickers.has(t))tickers.set(t,new Set());tickers.get(t).add(String(r.address||'').toLowerCase());}}
 let considered=0;const seen=new Set();
 for(const r of list){
  if(!r||typeof r.key!=='string'||aKeys.has(r.key)||seen.has(r.key))continue;
  if(r.eligibility!=='EXCLUDE'||!(r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY'))continue; // not an expansion source row
  considered++;seen.add(r.key);
  const why=gate(r,network,{tickers,held,now});
  if(why){dropped[why]=(dropped[why]||0)+1;continue;}
  const q=QR.compute(r,network,now);
  if(q.score<MIN_QUALITY){dropped.B_QUALITY_BELOW_MIN=(dropped.B_QUALITY_BELOW_MIN||0)+1;continue;}
  const segment=segmentOf(r,q,now),tier=tierOf(r);
  take.push({...r,discoveryFilter:'B_QUALITY_EXPANSION',discoveryTier:tier,qualityRank:q,
   eligibility:'QUALITY_EXPANSION_REVIEW',earlyStage:{decision:'EXCLUDE',reason:'NOT_EARLY_STAGE_CATEGORY',category:r.category.category,basis:r.category.basis},
   expansion:{tier,segment,category:r.category.category,basis:r.category.basis,source:r.universe?.source||'RADAR_WINDOW',
    reviewedReasons:(r.reasons||[]).filter(x=>x!=='NOT_EARLY_STAGE_CATEGORY'),
    policy:'HARD_GATES_UNCHANGED; REVIEWED_REASONS_ONLY; ARTWORK_IS_NOT_EVIDENCE'}});
 }
 return {rows:take,dropped,considered,ran:true};
}
// Carry-forward re-check on a PUBLISHED row (its own original measurements): mirrors every gate that the published row carries.
function publishedReason(row,network,{now=Date.now()}={}){
 const p=D.PROFILES[network];if(!p||!NETWORKS.has(network))return 'B_NETWORK_NOT_IN_SCOPE';
 const o=row?.opportunity||{},x=o.expansion||{};
 if(!ALLOWED.has(o.category)||!SEGMENTS.has(x.segment)||!TIERS.has(o.discoveryTier))return 'B_CATEGORY_NOT_ELIGIBLE';
 if(o.earlyStage?.reason!=='NOT_EARLY_STAGE_CATEGORY'||o.earlyStage?.decision!=='EXCLUDE')return 'B_NOT_A_CATEGORY_EXCLUSION';
 if(!Array.isArray(x.reviewedReasons)||x.reviewedReasons.some(r=>!REVIEWED_NON_BLOCKING.has(r)))return 'B_UNREVIEWED_EXCLUSION_REASON';
 if(!['QUALIFIED','NEAR_MATCH'].includes(o.discoveryClass||'QUALIFIED'))return 'B_V3_GATES_NOT_MET';
 if(!finite(row.priceUsd)||row.priceUsd<=0)return 'B_PRICE_NOT_OBSERVED';
 if(!finite(row.liquidityUsd)||row.liquidityUsd<p.minLiq)return 'B_LIQUIDITY_BELOW_NETWORK_FLOOR';
 if(!finite(row.volume24hUsd)||row.volume24hUsd<p.minVol*0.5)return 'B_ACTIVITY_BELOW_FLOOR';
 if(row.volume24hUsd>row.liquidityUsd*MAX_TURNOVER)return 'B_HIGH_VOLUME_TO_LIQUIDITY_RATIO';
 if(!(finite(row.buys24h)&&finite(row.sells24h)&&row.buys24h+row.sells24h>=MIN_TRADES))return 'B_TRADES_INSUFFICIENT';
 if(!finite(row.change24hPct)||row.change24hPct>=MAX_RISE||row.change24hPct<=MAX_DROP)return 'B_PRICE_MOVE_OUT_OF_RANGE';
 const age=D.ageDays(row,Number.isFinite(Date.parse(row.measuredAt))?Date.parse(row.measuredAt):now);
 if(age===null)return 'B_POOL_AGE_NOT_VERIFIED';
 if(x.basis!=='EXACT_CONTRACT_LIST'&&age<MIN_POOL_DAYS)return 'B_POOL_YOUNGER_THAN_30D';
 const ev=o.sourceEvidence||{};
 if(ev.crossCheck==='CONFLICT'||ev.sourcesDisagree)return 'B_SOURCE_CONFLICT';
 if(o.discoveryTier==='ESTABLISHED'&&!(x.basis==='EXACT_CONTRACT_LIST'&&(ev.crossCheck==='MATCHED'||ev.identity==='TWO_SOURCE_SYMBOL_MATCH')))return 'B_LISTED_IDENTITY_NOT_CORROBORATED';
 if(o.discoveryTier==='GROWTH'&&ev.crossCheck!=='MATCHED')return 'B_INDEPENDENT_CROSS_CHECK_MISSING';
 if(!finite(o.qualityRank?.score)||o.qualityRank.score<MIN_QUALITY)return 'B_QUALITY_BELOW_MIN';
 return null;
}
module.exports={expand,gate,tierOf,publishedReason,segmentOf,ALLOWED,TIERS,SEGMENTS,CRITICAL,REVIEWED_NON_BLOCKING,MAX_RISE,MAX_DROP,MIN_POOL_DAYS,MIN_QUALITY,NETWORKS};
