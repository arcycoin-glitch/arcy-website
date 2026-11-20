'use strict';
// ARCY Radar V8 — owner's custom opportunity filter. Not an investment prediction.
// Hard vetoes are separated from incomplete evidence. The latter reduce confidence and order, never manufacture a safety verdict.
const VERSION='arcy-custom-filter-1',SCORE_VERSION='arcy-opportunity-priority-1';
const BANDS=Object.freeze({STRONG_RESEARCH_SIGNAL:0,MARKET_OPPORTUNITY_WATCH:1,LOW_CONFIDENCE_WATCH:2});
const CATEGORIES=new Set(['EARLY_STAGE_CANDIDATE','ESTABLISHED_BLUE_CHIP','ESTABLISHED_LARGE_CAP','MATURE_LEGACY_MARKET','LEGACY_MEME']);
const VERIFIED_VETO=new Set(['SELL_DISABLED','UNLIMITED_MINT','DANGEROUS_ADMIN_PRIVILEGE','LOW_EXIT_LIQUIDITY','PERSISTENT_LOW_EXIT_LIQUIDITY','ABANDONED_PROJECT','INVALID_EXACT_CONTRACT','ISSUER_AFFILIATION_NOT_VERIFIED','CANONICAL_OR_STABLE_ASSET','IDENTITY_CATEGORY_BLOCKED','EXCLUDE_ALREADY_RAN_8X','EXCLUDE_VERIFIED_24H_8X','SOURCE_CONTRADICTION']);
const NONCRITICAL=new Set(['NOT_EARLY_STAGE_CATEGORY','DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED','PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','RUMOR_UNVERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED','EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED','HOLDER_CONCENTRATION_RISK','RADAR_SNAPSHOT_STALE_OR_UNVERIFIED']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=x=>Math.max(0,Math.min(1,x));
const val=(x,d=0)=>finite(x)?x:d;
const exact=r=>/^\d+:0x[0-9a-f]{40}$/i.test(r?.key||'')&&r.key===r.chainId+':'+String(r.address||'').toLowerCase();
// An EXCLUDE is admitted only if its SOLE exclusion is asset age/category, not a failed exit or security finding.
const categoryOnlyExclusion=r=>r?.eligibility==='EXCLUDE'&&CATEGORIES.has(r.category?.category)&&
 (r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY')&&(r.reasons||[]).every(x=>NONCRITICAL.has(x));
function veto(r,{held=false}={}){
 if(!r||!exact(r))return 'INVALID_CONTRACT_IDENTITY';
 if(held)return 'PERSISTENT_RISK_HOLD';
 if(!CATEGORIES.has(r.category?.category))return 'UNSUPPORTED_OR_IMPERSONATING_CATEGORY';
 if((r.risk||[]).length)return 'CONFIRMED_CONTRACT_OR_EXIT_RISK';
 if((r.reasons||[]).some(x=>VERIFIED_VETO.has(x)||String(x).startsWith('ENGINE_ERROR_')))return 'VERIFIED_RISK_OR_SOURCE_CONFLICT';
 if(r.integrity?.confirmedCritical?.length)return 'CONFIRMED_MARKET_INTEGRITY_CRITICAL';
 if(r.identity?.level==='IMPERSONATION_EVIDENCE'||r.identity?.level==='IDENTITY_SOURCE_CONFLICT')return 'CONTRACT_IDENTITY_CONFLICT';
 if(r.discoveryClass==='HARD'||r.discoveryClass==='CONFLICT')return 'PROVIDER_CRITICAL_CONFLICT';
 if(r.eligibility==='EXCLUDE'&&!categoryOnlyExclusion(r))return 'UNREVIEWED_EXCLUSION';
 if(!['ELIGIBLE','REVIEW','EXCLUDE','QUALITY_EXPANSION_REVIEW'].includes(r.eligibility))return 'UNKNOWN_ELIGIBILITY';
 if(!finite(r.priceUsd)||r.priceUsd<=0||!finite(r.liquidityUsd)||r.liquidityUsd<=0||
    !finite(r.volume24hUsd)||r.volume24hUsd<=0)return 'NO_REAL_MARKET_OBSERVATION';
 if(r.network==='pons'&&r.launch?.status!=='ONCHAIN_VERIFIED'&&r.v3Stage!=='RANKED')return 'PONS_LAUNCH_NOT_PROVEN';
 return null;
}
function compute(r){
 const h=r.history||{},m=r.compression?.metrics||{},q=r.qualityRank||{},p=r.profileCompleteness||{};
 const liq=val(r.liquidityUsd),vol=val(r.volume24hUsd),turnover=liq>0?vol/liq:0;
 const change=finite(r.change24hPct)?r.change24hPct:null;
 const drop=finite(h.drawdownFromPeakPct)?h.drawdownFromPeakPct:null;
 const spread=r.marketSpread?.liquidityUsd;
 const minLiq=finite(spread?.min)&&!spread.partialCoverage?Math.min(liq,spread.min):liq;
 const localFloor={arc:20000,ethereum:200000,robinhood:25000,pons:25000}[r.network]||25000;
 const flags=h.flags||[],sus=r.integrity?.suspicious||[];
 // Recent negative price action and past drawdown have value only when accompanied by actual liquidity and volume.
 const pricePressure=change===null?0:change>=0?0:change>=-30?clamp((-change-2)/25):0.25;
 const historicalDiscount=drop!==null&&h.observations>=2&&drop< -10&&drop> -65?clamp((-drop-10)/40):0;
 const activity=clamp(Math.log1p(vol/Math.max(1000,localFloor*0.2))/Math.log(16));
 const velocity=turnover<0.03?0:turnover<=2?clamp(turnover/0.5):turnover<=5?Math.max(0.3,1-(turnover-2)/5):0;
 const trades=finite(r.trades24h)?clamp(r.trades24h/60):0;
 const volumeStrength=0.6*activity+0.25*velocity+0.15*trades;
 const comp=r.compression?.status;
 const consolidation=comp==='COMPRESSION_CONFIRMED'?1:comp==='BREAKOUT_ACTIVITY_CONFIRMED'?0.9:comp==='COMPRESSION_EMERGING'?0.55:0;
 const observedGrowth=flags.includes('ACTIVITY_GROWTH_OBSERVED')?1:0;
 const volumeGrowth=finite(m.volumeRatio)&&m.volumeRatio>1?clamp((m.volumeRatio-1)/1.5):0;
 const acceleration=Math.max(observedGrowth,volumeGrowth);
 const depth=clamp(minLiq/localFloor),confidence=clamp((val(p.score)/100)*0.55+(r.sourceEvidence?.crossCheck==='MATCHED'?0.25:0)+(h.observations>=2?0.1:0)+(r.compression?.days>=21?0.1:0));
 const project=clamp(val(p.score)/100);
 const corroboration=r.sourceEvidence?.crossCheck==='MATCHED'?1:r.identity?.level==='OFFICIAL_CONTRACT_VERIFIED'?0.8:0.2;
 const components={
  pricePressure:+pricePressure.toFixed(3),historicalDiscount:+historicalDiscount.toFixed(3),
  volumeStrength:+volumeStrength.toFixed(3),consolidation,acceleration:+acceleration.toFixed(3),
  liquidityDepth:+depth.toFixed(3),projectEvidence:+project.toFixed(3),corroboration
 };
 const raw=18*pricePressure+12*historicalDiscount+20*volumeStrength+
   16*consolidation+12*acceleration+10*depth+7*project+5*corroboration;
 const warnings=[];
 if(change!==null&&change<=-35)warnings.push('SHARP_DAILY_FALL');
 if(drop!==null&&drop<=-60)warnings.push('DEEP_DRAWDOWN_POSSIBLE_COLLAPSE');
 if(turnover>5)warnings.push('EXCESSIVE_VOLUME_TO_LIQUIDITY');
 if(sus.length)warnings.push('SUSPICIOUS_ACTIVITY');
 if(r.integrity?.pumpHistory)warnings.push('HISTORICAL_PRICE_EVENT');
 if(p.score<60)warnings.push('INCOMPLETE_RESEARCH_PROFILE');
 if(r.researchTierReasons?.length)warnings.push('MISSING_VERIFICATION');
 if(r.identity?.level==='EXACT_CONTRACT_OBSERVED'||r.identity?.level==='OFFICIAL_IDENTITY_UNESTABLISHED')warnings.push('PROJECT_IDENTITY_UNVERIFIED');
 if(r.sourceEvidence?.crossCheck==='CONFLICT'||r.sourceEvidence?.sourcesDisagree)warnings.push('PROVIDER_DISAGREEMENT');
 let penalty=0;
 if(warnings.includes('SHARP_DAILY_FALL'))penalty+=15;
 if(warnings.includes('DEEP_DRAWDOWN_POSSIBLE_COLLAPSE'))penalty+=18;
 if(warnings.includes('EXCESSIVE_VOLUME_TO_LIQUIDITY'))penalty+=18;
 if(warnings.includes('SUSPICIOUS_ACTIVITY'))penalty+=Math.min(28,sus.length*12);
 if(warnings.includes('HISTORICAL_PRICE_EVENT'))penalty+=12;
 if(warnings.includes('PROVIDER_DISAGREEMENT'))penalty+=25;
 const score=+Math.max(0,raw-penalty).toFixed(2);
 const signals=[];
 if(pricePressure>=0.35&&volumeStrength>=0.4)signals.push('PRICE_DOWN_WITH_ACTIVE_VOLUME');
 if(historicalDiscount>=0.4&&depth>=0.8)signals.push('DRAWDOWN_WITH_LIQUIDITY');
 if(consolidation>=0.9)signals.push('MEASURED_CONSOLIDATION');
 if(acceleration>=0.6)signals.push('MEASURED_ACTIVITY_ACCELERATION');
 if(depth>=1)signals.push('RESEARCH_LIQUIDITY_FLOOR_MET');
 const reliable=confidence>=0.65&&!warnings.some(x=>['SHARP_DAILY_FALL','DEEP_DRAWDOWN_POSSIBLE_COLLAPSE','EXCESSIVE_VOLUME_TO_LIQUIDITY','SUSPICIOUS_ACTIVITY','PROVIDER_DISAGREEMENT'].includes(x));
 const band=reliable&&score>=65&&signals.some(x=>x==='PRICE_DOWN_WITH_ACTIVE_VOLUME'||x==='MEASURED_CONSOLIDATION'||x==='MEASURED_ACTIVITY_ACCELERATION')?
  'STRONG_RESEARCH_SIGNAL':score>=35&&confidence>=0.35?'MARKET_OPPORTUNITY_WATCH':'LOW_CONFIDENCE_WATCH';
 return {version:VERSION,scoreVersion:SCORE_VERSION,score,band,confidence:+(confidence*100).toFixed(1),signals,components,warnings,
  basis:'Observed volume + price pressure + historic drawdown + compression + liquidity + verification; not a rise probability',notForecast:true};
}
function compare(a,b){
 const x=compute(a),y=compute(b);
 return BANDS[x.band]-BANDS[y.band]||y.score-x.score||y.confidence-x.confidence||String(a.key).localeCompare(String(b.key));
}
function rank(r,position){
 const x=compute(r);
 return {version:VERSION,scoreVersion:SCORE_VERSION,researchBand:x.band,researchScore:x.score,position,
  signals:x.signals,confidence:x.confidence,warnings:x.warnings,components:x.components,
  basis:'HARD_RISK_VETO_THEN_ARCY_CUSTOM_MARKET_OPPORTUNITY_SCORE_NOT_A_PRICE_FORECAST'};
}
function info(r,network){
 const x=r.researchRank||rank(r,r.rank||0),pc=r.profileCompleteness;
 const notices=(x.warnings||[]).slice(0,4).join(', ')||'Belirgin sinyal yok (riskin olmadigi kanitlanmaz)';
 const parts=['ARCY özel araştırma filtresi — '+x.researchBand,
  'Öncelik '+x.researchScore+'/100 (yükseliş olasılığı değildir)',
  'Hacim $'+Math.round(r.volume24hUsd||0)+', likidite $'+Math.round(r.liquidityUsd||0),
  '24s fiyat '+(finite(r.change24hPct)?r.change24hPct+'%':'doğrulanmadı'),
  'Sıkışma '+(r.compression?.status||'kanıt yok'),
  'Profil '+(pc?.score??0)+'/100, veri güveni '+(x.confidence??0)+'/100',
  'İşaretler '+(x.signals||[]).join(', '),
  'Uyarılar '+notices,
  'Güvenlik garantisi değildir, kontrat ve çıkış koşulları bağımsız incelenmelidir',
  'Veri '+String(r.radarAsOf||'bilinmiyor').slice(0,16).replace('T',' ')+' UTC'];
 return parts.join('; ').slice(0,1300);
}
module.exports={VERSION,SCORE_VERSION,BANDS,NONCRITICAL,VERIFIED_VETO,CATEGORIES,categoryOnlyExclusion,veto,compute,compare,rank,info};
