'use strict';
// ARCY Radar V5 — FILTER B: QUALITY EXPANSION (issue #279).
// Runs ONLY when Filter A (the unchanged V3/V4 early-discovery selection) leaves empty slots. It reconsiders contracts that V4
// removed for one reason only — NOT_EARLY_STAGE_CATEGORY — and that belong to an established-project category with real
// activity. They are labelled as what they are (Established / Growing / Emerging Momentum), never as early-stage discoveries.
//
// Never reconsidered: stablecoins, wrapped/base assets, bridged representations, commodity-backed tokens, tokenized equities,
// legacy memes without a product, identity-blocked contracts (impersonation, major ticker without identity, unverified issuer),
// any critical risk, persistent risk holds, source contradictions or conflicts, engine errors, unresolved look-alike tickers.
// "Adaptive discovery is permitted. Adaptive safety is not."
const D=require('../discovery');
const QR=require('./quality-rank');
const ALLOWED=new Set(['ESTABLISHED_BLUE_CHIP','ESTABLISHED_LARGE_CAP','MATURE_LEGACY_MARKET']);
const SEGMENTS=new Set(['ESTABLISHED_PROJECT','GROWING_PROJECT','EMERGING_MOMENTUM']);
const CRITICAL=new Set(['SELL_DISABLED','UNLIMITED_MINT','DANGEROUS_ADMIN_PRIVILEGE','LOW_EXIT_LIQUIDITY','PERSISTENT_LOW_EXIT_LIQUIDITY','ABANDONED_PROJECT',
 'EXCLUDE_ALREADY_RAN_8X','EXCLUDE_VERIFIED_24H_8X','ISSUER_AFFILIATION_NOT_VERIFIED','CANONICAL_OR_STABLE_ASSET','INVALID_EXACT_CONTRACT',
 'IDENTITY_CATEGORY_BLOCKED','SOURCE_CONTRADICTION']);
// Larger assets: a 24h move this large is event-driven volatility, not a quality signal (stricter than Filter A's +70/-50).
const MAX_RISE=40,MAX_DROP=-30,MAX_TURNOVER=5,MIN_TRADES=10,MIN_POOL_DAYS=30,MIN_QUALITY=40;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const NETWORKS=new Set(['arc','ethereum','robinhood']); // Pons Launch is a launchpad subset: no established-project expansion.
// Hard gate for one engine row. Returns null when the row may be considered, otherwise a reason code.
function gate(r,network,{tickers,held,now=Date.now()}={}){
 if(!NETWORKS.has(network))return 'B_NETWORK_NOT_IN_SCOPE';
 const reasons=Array.isArray(r?.reasons)?r.reasons:[];
 if(r?.eligibility!=='EXCLUDE'||!reasons.includes('NOT_EARLY_STAGE_CATEGORY'))return 'B_NOT_A_CATEGORY_EXCLUSION';
 if(held?.has(r.key))return 'B_PERSISTENT_RISK_HOLD';
 if(reasons.some(x=>CRITICAL.has(x)||String(x).startsWith('ENGINE_ERROR_'))||(Array.isArray(r.risk)&&r.risk.length))return 'B_CRITICAL_RISK';
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
 // Measured-size categories (FDV / pool age) must be independently corroborated: a low-float token can show a huge FDV.
 if(!exact&&r.sourceEvidence?.crossCheck!=='MATCHED')return 'B_INDEPENDENT_CROSS_CHECK_MISSING';
 // Exact listed contracts carry identity by contract; any other look-alike ticker in the window stays unresolved.
 if(!exact&&(tickers?.get(String(r.symbol||'').trim().toLowerCase())?.size||0)>1)return 'B_DUPLICATE_TICKER_UNRESOLVED';
 if(!r.artwork?.url)return 'B_TOKEN_ARTWORK_NOT_SOURCED';
 return null;
}
function segmentOf(r,q,now){
 const age=D.ageDays(r,now);
 if(q.components.earlyMomentum>=0.6&&q.components.organicGrowth>=0.5)return 'EMERGING_MOMENTUM';
 if(r.category?.category!=='MATURE_LEGACY_MARKET'&&r.category?.basis!=='EXACT_CONTRACT_LIST'&&age!==null&&age<365)return 'GROWING_PROJECT';
 return 'ESTABLISHED_PROJECT';
}
const SEGMENT_TR=Object.freeze({ESTABLISHED_PROJECT:'YERLEŞİK PROJE',GROWING_PROJECT:'BÜYÜYEN PROJE',EMERGING_MOMENTUM:'YÜKSELEN İLGİ'});
const CAT_TR=Object.freeze({ESTABLISHED_BLUE_CHIP:'yerleşik büyük proje',ESTABLISHED_LARGE_CAP:'ölçülen piyasa değeri ≥ 1 milyar $',MATURE_LEGACY_MARKET:'1 yılı aşkın havuz, ≥ 1 milyon $ likidite'});
function infoText(r,q,segment){
 const pend=[];
 if(!r.evidenceSummary?.exit)pend.push('çıkış simülasyonu yok');
 if(!r.evidenceSummary?.risk||!Object.keys(r.evidenceSummary.risk).length)pend.push('mint/pause/admin okunmadı');
 if(!r.dossier||!['OWNER_APPROVED','PRIMARY_SOURCE_VERIFIED'].includes(r.dossier.status))pend.push('resmi kimlik dosyası yok');
 return ['KALİTE GENİŞLEMESİ (Filtre B) — '+SEGMENT_TR[segment]+', erken aşama keşfi DEĞİLDİR',
  'Neden: '+CAT_TR[r.category.category]+', likidite/işlem eşikleri geçildi, kritik risk kaydı yok (güvenlik garantisi değildir)',
  QR.info(q),'Eksik kanıt: '+(pend.join(', ')||'yok'),'Doğrulanmış yaklaşan etkinlik '+(r.catalystAt?r.catalystAt.slice(0,10):'yok')]
  .map(x=>String(x).replace(/;/g,',')).join('; ').slice(0,400);
}
// rows: every engine result of one network. aKeys: contracts Filter A already shows. slots: free rows (max 10 total).
function expand(rows,network,{aKeys=new Set(),slots=0,held=new Set(),now=Date.now()}={}){
 const dropped={},take=[];
 if(slots<=0)return {rows:[],dropped,considered:0,ran:false};
 const list=Array.isArray(rows)?rows:[];
 const tickers=new Map();for(const r of list){const t=String(r?.symbol||'').trim().toLowerCase();if(t){if(!tickers.has(t))tickers.set(t,new Set());tickers.get(t).add(String(r.address||'').toLowerCase());}}
 let considered=0;
 const seen=new Set();
 for(const r of list){
  if(!r||typeof r.key!=='string'||aKeys.has(r.key)||seen.has(r.key))continue;
  if(r.eligibility!=='EXCLUDE'||!(r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY'))continue; // not a Filter B source row
  considered++;seen.add(r.key);
  const why=gate(r,network,{tickers,held,now});
  if(why){dropped[why]=(dropped[why]||0)+1;continue;}
  const q=QR.compute(r,network,now);
  if(q.score<MIN_QUALITY){dropped.B_QUALITY_BELOW_MIN=(dropped.B_QUALITY_BELOW_MIN||0)+1;continue;}
  take.push({r,q});
 }
 take.sort((a,b)=>b.q.score-a.q.score||(b.r.liquidityUsd??0)-(a.r.liquidityUsd??0)||a.r.key.localeCompare(b.r.key));
 const out=take.slice(0,slots).map(({r,q})=>{
  const segment=segmentOf(r,q,now);
  return {...r,discoveryFilter:'B_QUALITY_EXPANSION',qualityRank:q,
   // The V4 early-stage decision is kept verbatim under earlyStage; the published eligibility says what this row is.
   eligibility:'QUALITY_EXPANSION_REVIEW',earlyStage:{decision:'EXCLUDE',reason:'NOT_EARLY_STAGE_CATEGORY',category:r.category.category,basis:r.category.basis},
   expansion:{segment,category:r.category.category,basis:r.category.basis,policy:'FILLS_EMPTY_SLOTS_ONLY; NEVER_DISPLACES_FILTER_A; HARD_GATES_UNCHANGED'},
   infoV4:infoText(r,q,segment)};
 });
 if(take.length>slots)dropped.B_NO_FREE_SLOT=take.length-slots;
 return {rows:out,dropped,considered,ran:true};
}
// Carry-forward re-check on a PUBLISHED row (its own original measurements), mirroring the hard gates that can be re-read.
function publishedReason(row,network){
 const p=D.PROFILES[network];if(!p)return 'B_NETWORK_NOT_IN_SCOPE';
 const o=row?.opportunity||{};
 if(!ALLOWED.has(o.category)||!SEGMENTS.has(o.expansion?.segment))return 'B_CATEGORY_NOT_ELIGIBLE';
 if(!finite(row.liquidityUsd)||row.liquidityUsd<p.minLiq)return 'B_LIQUIDITY_BELOW_NETWORK_FLOOR';
 if(!finite(row.change24hPct)||row.change24hPct>=MAX_RISE||row.change24hPct<=MAX_DROP)return 'B_PRICE_MOVE_OUT_OF_RANGE';
 if(!finite(o.qualityRank?.score)||o.qualityRank.score<MIN_QUALITY)return 'B_QUALITY_BELOW_MIN';
 return null;
}
module.exports={expand,gate,publishedReason,segmentOf,ALLOWED,SEGMENTS,CRITICAL,MAX_RISE,MAX_DROP,MIN_POOL_DAYS,MIN_QUALITY,NETWORKS};
