'use strict';
// ARCY Radar — owner's custom Top 10 filter (`arcy-custom-filter-3`; -2 added the exact Top 10 rules, -3 the audit corrections). Not an investment prediction.
// Two separate stages:
//   1. ELIGIBILITY (hard, non-negotiable): confirmed scams / honeypots / failed exits / dangerous contract controls, identity
//      impersonation or source conflict, persistent risk holds, no real market observation, and projects WITHOUT A VERIFIABLE
//      PROFILE (exact contract corroborated by an independent project source: explorer-linked listing, two-indexer symbol match,
//      Pons factory record, reviewed or live-checked official page). Nothing else removes a project.
//   2. RANKING (soft): every eligible project competes for the ten places. The ARCY opportunity score orders them; a weak score
//      only moves a project down, it never removes it. #1 = best match to ARCY's criteria, #10 = weakest of the ten.
// Score components (each 0..1, weights sum to 100); a component that could not be MEASURED scores 0 and is reported as unmeasured:
//   organic volume 15 · price weakness with stabilisation 14 · compression / falling volatility 14 · liquidity & exit depth 12 ·
//   buyer participation 10 · project activity & verified identity 12 · manipulation cleanliness 8 · upside asymmetry 15
// Upside asymmetry is a RESEARCH valuation signal (market cap vs FDV / dilution, valuation relative to same-network peers,
// liquidity able to carry the valuation, organic growth, product traction / dated catalyst). It never states a 2x/5x/10x/100x
// return, and a project that is merely cheap or has crashed earns little of it without growth or traction evidence.
const VERSION='arcy-custom-filter-3',SCORE_VERSION='arcy-opportunity-priority-3';
const WEIGHTS=Object.freeze({organicVolume:15,priceStabilization:14,compression:14,liquidityExit:12,buyerParticipation:10,projectIdentity:12,manipulationClean:8,upsideAsymmetry:15});
// descriptive labels only (ordering is by score)
const BANDS=Object.freeze({STRONG_RESEARCH_SIGNAL:0,MARKET_OPPORTUNITY_WATCH:1,LOW_CONFIDENCE_WATCH:2});
const CATEGORIES=new Set(['EARLY_STAGE_CANDIDATE','ESTABLISHED_BLUE_CHIP','ESTABLISHED_LARGE_CAP','MATURE_LEGACY_MARKET','LEGACY_MEME']);
const VERIFIED_VETO=new Set(['SELL_DISABLED','UNLIMITED_MINT','DANGEROUS_ADMIN_PRIVILEGE','LOW_EXIT_LIQUIDITY','PERSISTENT_LOW_EXIT_LIQUIDITY','ABANDONED_PROJECT','INVALID_EXACT_CONTRACT','ISSUER_AFFILIATION_NOT_VERIFIED','CANONICAL_OR_STABLE_ASSET','IDENTITY_CATEGORY_BLOCKED','SOURCE_CONTRADICTION','EXCLUDE_ALREADY_RAN_8X','EXCLUDE_VERIFIED_24H_8X']);
const NONCRITICAL=new Set(['NOT_EARLY_STAGE_CATEGORY','DISCOVERY_SCORE_NOT_VERIFIED','IDENTITY_NOT_VERIFIED','RUNUP_NOT_VERIFIED','PRODUCT_CONTINUITY_NOT_VERIFIED','CATALYST_NOT_VERIFIED','RUMOR_UNVERIFIED','SELL_EXIT_NOT_VERIFIED','MINT_NOT_VERIFIED','ADMIN_NOT_VERIFIED','EXIT_LIQUIDITY_NOT_VERIFIED','ORGANIC_BUYER_BREADTH_NOT_VERIFIED','HISTORY_NOT_VERIFIED','DEMAND_NOT_VERIFIED']);
// "verifiable profile": the exact contract is tied to the project by an independent project-level source (not just observed trading)
const PROFILE_IDENTITY=new Set(['METADATA_CROSS_CORROBORATED','OFFICIAL_CONTRACT_VERIFIED']);
const RESEARCH_FLOOR=Object.freeze({arc:20000,ethereum:200000,robinhood:25000,pons:10000});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=x=>Math.max(0,Math.min(1,x));
const exact=r=>/^\d+:0x[0-9a-f]{40}$/i.test(r?.key||'')&&r.key===r.chainId+':'+String(r.address||'').toLowerCase();
// An EXCLUDE is admitted only if its SOLE exclusion is asset age/category, not a failed exit or security finding.
const categoryOnlyExclusion=r=>r?.eligibility==='EXCLUDE'&&CATEGORIES.has(r.category?.category)&&
 (r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY')&&(r.reasons||[]).every(x=>NONCRITICAL.has(x));
function veto(r,{held=false}={}){
 if(!r||!exact(r))return 'INVALID_CONTRACT_IDENTITY';
 if(held)return 'PERSISTENT_RISK_HOLD';
 if(['STABLECOIN','COMMODITY_BACKED','COMMODITY_TICKER_WITHOUT_IDENTITY'].includes(r.category?.category))return 'PEGGED_OR_STABLE_ASSET';
 if(['WRAPPED_OR_BASE_ASSET','BRIDGED_ESTABLISHED_ASSET','TOKENIZED_EQUITY'].includes(r.category?.category))return 'WRAPPED_OR_REPRESENTATION_ASSET';
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
 // Pons takes priority: a factory-verified launch belongs to the Pons list only
 if(r.network==='robinhood'&&r.launch?.status==='ONCHAIN_VERIFIED')return 'LISTED_IN_PONS';
 if(!String(r.symbol||'').trim()&&!String(r.name||'').trim())return 'NO_VERIFIABLE_PROJECT_PROFILE';
 // identity is assessed after enrichment: the second veto pass sees it (the first pass, before enrichment, cannot)
 if(r.identity&&!PROFILE_IDENTITY.has(r.identity.level))return 'NO_VERIFIABLE_PROJECT_PROFILE';
 // token identity (explorer + DEX symbol agreement, factory record) is not a project profile: a project-level source is required
 if(r.identity&&projectProfile(r).level==='TOKEN_IDENTITY_ONLY')return 'NO_VERIFIABLE_PROJECT_PROFILE';
 return null;
}
// Project profile, separate from token identity:
//   OFFICIAL_PROJECT            official/primary source publishes the exact contract (identity OFFICIAL_CONTRACT_VERIFIED)
//   SELF_PUBLISHED_PROJECT_SITE the project's own reviewed site publishes the exact contract, not re-contradicted by a live check
//   PROJECT_CHANNELS_LISTED     the exact-contract market listing carries creator-provided website/social channels (unverified)
//   TOKEN_IDENTITY_ONLY         only explorer / DEX symbol agreement or a factory record: the token exists, the project is unshown
function projectProfile(r){
 const lvl=r.identity?.level,d=r.dossier||{},oc=r.officialCheck?.status;
 const sites=(r.officialLinks?.websites||[]).filter(Boolean),socials=(r.officialLinks?.socials||[]).filter(x=>x?.url);
 const dev=['VERIFIED_ACTIVE','PUBLIC_REPOSITORY_VERIFIED'].includes(r.evidenceSummary?.product)||(r.developmentEvidence||r.opportunity?.developmentEvidence)?.status==='PUBLIC_REPOSITORY_VERIFIED';
 if(lvl==='OFFICIAL_CONTRACT_VERIFIED')return {level:'OFFICIAL_PROJECT',evidence:['OFFICIAL_SOURCE_PUBLISHES_EXACT_CONTRACT:'+(d.evidenceUrl||d.officialSite||'')],development:dev};
 if(d.status==='PARTIAL_EVIDENCE'&&d.siteShowsExactAddress===true&&oc!=='ADDRESS_NOT_FOUND'&&oc!=='ADDRESS_NOT_PUBLISHED')
  return {level:'SELF_PUBLISHED_PROJECT_SITE',evidence:['PROJECT_SITE_PUBLISHES_EXACT_CONTRACT:'+(d.evidenceUrl||d.officialSite||''),...(oc?['LIVE_CHECK:'+oc]:[])],development:dev};
 if(sites.length||socials.length)return {level:'PROJECT_CHANNELS_LISTED',evidence:[...sites.slice(0,2).map(u=>'LISTED_WEBSITE:'+u),...socials.slice(0,2).map(x=>'LISTED_'+String(x.type||'SOCIAL').toUpperCase()+':'+x.url)],development:dev};
 if(dev)return {level:'PROJECT_CHANNELS_LISTED',evidence:['PUBLIC_REPOSITORY_VERIFIED'],development:true};
 return {level:'TOKEN_IDENTITY_ONLY',evidence:(r.identity?.evidence||[]).slice(0,3),development:false};
}
// ── ranking components ─────────────────────────────────────────────────────────────────────────────────────────────
function series(r){const s=(r.dailySeries?.points?.length||0)>=(r.ohlcvSeries?.points?.length||0)?r.dailySeries:r.ohlcvSeries;return s?.points?.length?s.points:null;}
function compute(r){
 const net=r.network,floor=RESEARCH_FLOOR[net]||25000,h=r.history||{},cm=r.compression?.metrics||{},flags=h.flags||[];
 const measured={},c={};
 const liq=finite(r.liquidityUsd)?r.liquidityUsd:0,vol=finite(r.volume24hUsd)?r.volume24hUsd:0,turnover=liq>0?vol/liq:0;
 const spread=r.marketSpread?.liquidityUsd;
 const liqC=finite(spread?.min)&&!spread.partialCoverage?Math.min(liq,spread.min):liq;
 const buys=r.buys24h,sells=r.sells24h,trades=finite(r.trades24h)?r.trades24h:(finite(buys)&&finite(sells)?buys+sells:null);
 // These are per-side reported wallet counts, NOT a deduplicated union.
 // max(buyers,sellers) is a conservative lower bound; their sum an upper bound.
 const buyerWallets=finite(r.activity?.buyers?.h24)&&r.activity.buyers.h24>=0?r.activity.buyers.h24:null;
 const sellerWallets=finite(r.activity?.sellers?.h24)&&r.activity.sellers.h24>=0?r.activity.sellers.h24:null;
 const walletFloor=buyerWallets!==null&&sellerWallets!==null?Math.max(buyerWallets,sellerWallets):null;
 const walletCeiling=buyerWallets!==null&&sellerWallets!==null?buyerWallets+sellerWallets:null;
 const demand=r.evidenceSummary?.demand;
 const reviewedBreadth=finite(demand?.distinctBuyers)&&demand.distinctBuyers>=3&&
  demand.cluster==='REVIEWED_NO_CONCENTRATION'&&demand.wash==='REVIEWED_NO_SELF_TRADE';
 const reportedBreadth=walletFloor!==null&&walletFloor>=3&&
  (trades===null||trades/walletFloor<=20);
 // A concentration warning requires even the optimistic union bound to have
 // high trade repetition; per-side reported counts alone do not prove wash trading.
 const confirmedConcentration=walletCeiling!==null&&walletCeiling>0&&trades!==null&&trades/walletCeiling>20;
 // 1. organic volume: real activity relative to the network, sane turnover, broad trade count, few trades per wallet
 {// saturates at ~2x the network research floor: 'healthy' volume is a sufficiency test, not a size contest
  const level=clamp(Math.log1p(vol/(floor*0.1))/Math.log1p(20));
  const sane=turnover<=0?0:turnover<0.03?0.3:turnover<=2?1:turnover<=5?0.5:0.1;
  const breadth=trades===null?0.5:clamp(trades/150);
  const perWallet=walletFloor&&trades?trades/walletFloor:null;
  const churn=perWallet===null?(reviewedBreadth?1:0.45):perWallet<=6?1:perWallet<=20?0.6:0.2;
   // volume that is many times the pool depth, or that comes with a fresh spike, is not counted as healthy organic demand
  const depthChurn=turnover>5?0.15:turnover>2?0.6:1,ch24=finite(r.change24hPct)?r.change24hPct:0,spike=ch24>=70?0.4:ch24>=35?0.7:1;
  c.organicVolume=level*(0.55+0.25*sane+0.2*breadth)*churn*depthChurn*spike;
  // Volume is measured, organic demand is not unless participation and
  // concentration were independently reviewed. Unknown never receives full credit.
  if(!reviewedBreadth)c.organicVolume=Math.min(c.organicVolume,0.45);
  measured.organicVolume=vol>0&&reviewedBreadth;}
 // 2. price weakness WITH stabilisation: a discount from the observed peak counts only while the price has stopped falling
 {const pts=series(r);let drawdown=null,move3=finite(cm.move3dPct)?cm.move3dPct:null;
  if(pts&&pts.length>=10){const closes=pts.map(p=>p.c).filter(finite),hi=Math.max(...closes),last=closes.at(-1);drawdown=hi>0?(last/hi-1)*100:null;
   if(move3===null&&closes.length>=4)move3=(last/closes.at(-4)-1)*100;}
  else if(finite(h.drawdownFromPeakPct)&&h.observations>=2)drawdown=h.drawdownFromPeakPct;
  const ch=finite(r.change24hPct)?r.change24hPct:null;
  const weakness=drawdown===null?0:drawdown>-8?0:drawdown>=-70?clamp((-drawdown-8)/42):0.2; // beyond -70%: collapse, not a discount
  const calm24=ch===null?0.4:ch<=-15?0:ch<=-6?0.4:ch<=12?1:ch<=35?0.4:0;
  const calm3=move3===null?0.5:move3<=-15?0:move3<=-5?0.5:move3<=15?1:0.3;
  const quieter=finite(cm.volatilityRatio)?(cm.volatilityRatio<=1?1:cm.volatilityRatio<=1.5?0.6:0.2):0.6;
  const stab=calm24*0.45+calm3*0.35+quieter*0.2;
  c.priceStabilization=weakness>0?weakness*stab:0.25*stab*(drawdown===null?0:1);measured.priceStabilization=drawdown!==null;}
 // 3. compression / decreasing volatility from real dated daily series only
 {const st=r.compression?.status;const base=st==='COMPRESSION_CONFIRMED'?1:st==='BREAKOUT_ACTIVITY_CONFIRMED'?0.9:st==='COMPRESSION_EMERGING'?0.6:0;
  const vr=finite(cm.volatilityRatio)?clamp((1.2-cm.volatilityRatio)/0.8)*0.5:0;
  c.compression=Math.max(base,vr);measured.compression=(r.compression?.days||0)>=21;}
 // 4. liquidity quality and exit depth: depth vs the network research floor, provider agreement, a simulated exit
 {// depth sufficient for meaningful trading saturates at ~2x the research floor (bigger books earn no extra rank)
  const depth=liqC>0?clamp(Math.log10(liqC/(floor*0.1))/Math.log10(20)):0;
  const agree=spread&&finite(spread.ratio)?(spread.ratio<=3?1:0.4):0.6;
  const exit=r.evidenceSummary?.exit?.status==='EXIT_SIMULATED'||r.evidenceSummary?.risk?.sell==='SELL_ENABLED_VERIFIED'?1:0;
  c.liquidityExit=clamp(depth*(0.8+0.2*agree)*0.85+0.15*exit);measured.liquidityExit=liq>0;}
 // 5. buyer participation: buy-side share of trades, reviewed distinct buyers, observed activity growth
 {const share=finite(buys)&&finite(sells)&&buys+sells>0?buys/(buys+sells):null;
  const balance=share===null?0:clamp((share-0.42)/0.18);
  const dm=r.evidenceSummary?.demand;const breadth=dm&&finite(dm.distinctBuyers)?clamp(dm.distinctBuyers/150)*(dm.cluster==='REVIEWED_NO_CONCENTRATION'?1:0.4):0;
  const growth=flags.includes('ACTIVITY_GROWTH_OBSERVED')?1:finite(cm.volumeRatio)&&cm.volumeRatio>1?clamp((cm.volumeRatio-1)/1):0;
  c.buyerParticipation=0.4*balance+0.3*breadth+0.3*growth;
  if(!reviewedBreadth)c.buyerParticipation=Math.min(c.buyerParticipation,reportedBreadth?0.55:0.25);
  measured.buyerParticipation=reviewedBreadth||reportedBreadth&&share!==null;}
 // 6. project activity and verified identity
 {const lvl=r.identity?.level;const id=lvl==='OFFICIAL_CONTRACT_VERIFIED'?1:lvl==='METADATA_CROSS_CORROBORATED'?0.55:0;
  const prof=finite(r.profileCompleteness?.score)?r.profileCompleteness.score/100:0;
  const dev=r.evidenceSummary?.product==='VERIFIED_ACTIVE'?1:0;
  const pp=projectProfile(r),ppS={OFFICIAL_PROJECT:1,SELF_PUBLISHED_PROJECT_SITE:0.6,PROJECT_CHANNELS_LISTED:0.3,TOKEN_IDENTITY_ONLY:0}[pp.level];
  c.projectIdentity=0.3*id+0.25*ppS+0.25*prof+0.2*(dev||pp.development?1:0);measured.projectIdentity=Boolean(lvl);}
 // 7. manipulation cleanliness (indicators reduce it; a missing check is not credited as clean beyond the neutral level)
 const warnings=[],sus=r.integrity?.suspicious||[];
 if(walletFloor===null)warnings.push('UNIQUE_PARTICIPANTS_NOT_OBSERVED');
 if(!reviewedBreadth)warnings.push('ORGANIC_DEMAND_NOT_VERIFIED');
 if(confirmedConcentration)warnings.push('CONCENTRATED_TRADING_ACTIVITY');
 {let m=1;const ch=finite(r.change24hPct)?r.change24hPct:null;
  if(sus.length){m-=Math.min(0.7,0.35*sus.length);warnings.push('SUSPICIOUS_ACTIVITY');}
  if(r.integrity?.pumpHistory){m-=0.4;warnings.push('HISTORICAL_PRICE_EVENT');}
  if(ch!==null&&ch>=70){m-=0.5;warnings.push('ALREADY_SPIKED_24H');}
  if(ch!==null&&ch<=-35){m-=0.4;warnings.push('SHARP_DAILY_FALL');}
  if(turnover>5){m-=0.4;warnings.push('EXCESSIVE_VOLUME_TO_LIQUIDITY');}
  if(r.sourceEvidence?.crossCheck==='CONFLICT'||r.sourceEvidence?.sourcesDisagree){m-=0.3;warnings.push('PROVIDER_DISAGREEMENT');}
  const checked=(r.integrity?.findings||[]).some(f=>f.status!=='UNAVAILABLE');
  c.manipulationClean=clamp(m)*(checked?1:0.8);measured.manipulationClean=checked;}
 // 8. upside asymmetry (research valuation signal, not a return forecast)
 {const mc=finite(r.marketCapUsd)&&r.marketCapUsd>0?r.marketCapUsd:null,fdv=finite(r.fdvUsd)&&r.fdvUsd>0?r.fdvUsd:null;
  const f=r.v3Verification?.fields||{},xv=k=>f[k]==='CROSS_VERIFIED';
  // circulating share of the fully diluted value: low share = large future supply (unlocks / emissions) = dilution risk
  let supply=0;const circ=mc&&fdv?Math.min(1,mc/fdv):null;
  if(circ!==null)supply=(circ>=0.85?1:circ>=0.5?0.4+1.2*(circ-0.5):circ>=0.2?0.1+(circ-0.2):0)*(xv('marketCapUsd')||xv('fdvUsd')?1:0.8);
  if(circ!==null&&circ<0.5)warnings.push('DILUTION_RISK_LOW_CIRCULATING_SHARE');
  if(circ===null&&(mc||fdv))warnings.push('CIRCULATING_SUPPLY_NOT_MEASURED');
  // valuation relative to comparable projects on the same network (valuation per unit of real 24h activity; lower = cheaper)
  const pv=r.peerValuation;const relative=pv&&finite(pv.percentile)&&pv.peers>=5?clamp(1-pv.percentile):0;
  // liquidity able to support the valuation (thin books under a large cap cannot carry meaningful trading)
  const cap=mc||fdv;const support=cap&&liq>0?clamp((liq/cap)/0.05)*(liqC>=floor?1:0.5):0;
  // evidence of organic growth and product traction / dated catalyst
  const share=finite(buys)&&finite(sells)&&buys+sells>0?buys/(buys+sells):null;
  const growth=Math.max(flags.includes('ACTIVITY_GROWTH_OBSERVED')?1:0,finite(cm.volumeRatio)&&cm.volumeRatio>1?clamp(cm.volumeRatio-1):0,share!==null&&share>=0.55&&trades!==null&&trades>=100?0.5:0);
  const catalyst=r.evidenceSummary?.catalyst?.eventAt&&Date.parse(r.evidenceSummary.catalyst.eventAt)>=(finite(r.snapshotNow)?r.snapshotNow:Date.now())-14*864e5?1:0;
  const traction=Math.max(r.evidenceSummary?.product==='VERIFIED_ACTIVE'?1:0,catalyst,(r.profileCompleteness?.score??0)>=60?0.4:0);
  const evidence=Math.max(growth,traction);
  // valuation headroom: a project that is already very large has less room for asymmetric re-rating (ranking only, never excluded)
  const headroom=!cap?0.6:cap>=1e10?0.2:cap>=1e9?0.35:cap>=2.5e8?0.7:cap>=5e7?0.9:1;
  const early=r.category?.category==='EARLY_STAGE_CANDIDATE';
  let u=(0.25*supply+0.25*relative+0.15*support)*headroom+(early?0.2:0.12)*growth+0.15*traction;
  if(headroom<=0.35)warnings.push('LARGE_CAP_LIMITED_ASYMMETRY');
  // merely cheap or crashed: valuation credit is halved without growth or traction evidence
  const ch=finite(r.change24hPct)?r.change24hPct:null,deep=finite(h.drawdownFromPeakPct)&&h.drawdownFromPeakPct<=-70;
  if(evidence<0.4)u*=0.5;
  if(deep||(ch!==null&&ch<=-35)){u*=0.5;warnings.push('CRASH_NOT_UNDERVALUATION');}
  c.upsideAsymmetry=clamp(u);measured.upsideAsymmetry=Boolean(cap)&&(circ!==null||relative>0);
  if(!r.unlockSchedule)warnings.push('UNLOCK_SCHEDULE_NOT_MEASURED');}
 if(liqC<floor)warnings.push('BELOW_RESEARCH_LIQUIDITY_FLOOR');
 if((r.profileCompleteness?.score??0)<60)warnings.push('INCOMPLETE_RESEARCH_PROFILE');
 if(r.identity?.level!=='OFFICIAL_CONTRACT_VERIFIED')warnings.push('ISSUER_NOT_OFFICIALLY_VERIFIED');
 {const pl=projectProfile(r).level;if(pl==='PROJECT_CHANNELS_LISTED')warnings.push('PROJECT_CHANNELS_UNVERIFIED');if(pl==='TOKEN_IDENTITY_ONLY')warnings.push('TOKEN_IDENTITY_ONLY');}
 const components=Object.fromEntries(Object.keys(WEIGHTS).map(k=>[k,+c[k].toFixed(3)]));
 const score=+Object.keys(WEIGHTS).reduce((s,k)=>s+WEIGHTS[k]*c[k],0).toFixed(2);
 const confidence=+(100*Object.keys(WEIGHTS).reduce((s,k)=>s+(measured[k]?WEIGHTS[k]:0),0)/100).toFixed(1);
 const signals=[];
 if(c.priceStabilization>=0.45)signals.push('PRICE_DISCOUNT_STABILISING');
 if(c.compression>=0.9)signals.push('MEASURED_COMPRESSION');
 if(reviewedBreadth&&c.buyerParticipation>=0.6)signals.push('BUYER_PARTICIPATION_RISING');
 if(reviewedBreadth&&c.organicVolume>=0.6&&c.manipulationClean>=0.75)signals.push('HEALTHY_ORGANIC_VOLUME');
 if(c.liquidityExit>=0.75)signals.push('DEEP_LIQUIDITY');
 if(c.upsideAsymmetry>=0.6)signals.push('RESEARCH_UPSIDE_ASYMMETRY');
 const band=score>=60&&confidence>=70&&!warnings.some(w=>['SUSPICIOUS_ACTIVITY','HISTORICAL_PRICE_EVENT','ALREADY_SPIKED_24H','SHARP_DAILY_FALL','EXCESSIVE_VOLUME_TO_LIQUIDITY','PROVIDER_DISAGREEMENT','ORGANIC_DEMAND_NOT_VERIFIED','CONCENTRATED_TRADING_ACTIVITY'].includes(w))?
  'STRONG_RESEARCH_SIGNAL':score>=35?'MARKET_OPPORTUNITY_WATCH':'LOW_CONFIDENCE_WATCH';
 return {version:VERSION,scoreVersion:SCORE_VERSION,score,band,confidence,signals,components,weights:WEIGHTS,
  unmeasured:Object.keys(WEIGHTS).filter(k=>!measured[k]),warnings,
  basis:'Eligibility first (hard safety and verifiable profile), then ARCY opportunity score; a research priority, not a rise probability',notForecast:true};
}
// Same-network peer valuation: valuation (market cap, else FDV) per dollar of real 24h volume, as a percentile among the eligible
// rows of that section that report both (0 = cheapest relative to activity). Needs >= 5 peers; otherwise left unmeasured.
function annotatePeers(rows){
 const v=r=>{const cap=finite(r.marketCapUsd)&&r.marketCapUsd>0?r.marketCapUsd:finite(r.fdvUsd)&&r.fdvUsd>0?r.fdvUsd:null;return cap&&finite(r.volume24hUsd)&&r.volume24hUsd>0?cap/r.volume24hUsd:null;};
 const vals=rows.map(v).filter(x=>x!==null).sort((a,b)=>a-b),n=vals.length;
 return rows.map(r=>{const x=v(r);if(x===null||n<5)return {...r,peerValuation:{percentile:null,peers:n}};
  const below=vals.filter(y=>y<x).length,eq=vals.filter(y=>y===x).length;return {...r,peerValuation:{percentile:+((below+(eq-1)/2)/(n-1)).toFixed(3),peers:n,capToVolume:+x.toFixed(2)}};});
}
// strictly by score (best match first), then data confidence, then exact key (deterministic)
function compare(a,b){
 const x=compute(a),y=compute(b);
 return y.score-x.score||y.confidence-x.confidence||String(a.key).localeCompare(String(b.key));
}
function rank(r,position){
 const x=compute(r);
 return {version:VERSION,scoreVersion:SCORE_VERSION,researchBand:x.band,researchScore:x.score,position,
  signals:x.signals,confidence:x.confidence,warnings:x.warnings,components:x.components,unmeasured:x.unmeasured,projectProfile:projectProfile(r),
  basis:'HARD_ELIGIBILITY_THEN_ARCY_OPPORTUNITY_SCORE_ORDER_NOT_A_PRICE_FORECAST'};
}
const C_TR=Object.freeze({organicVolume:'organik hacim',priceStabilization:'düşüş sonrası dengelenme',compression:'sıkışma',liquidityExit:'likidite/çıkış',
 buyerParticipation:'alıcı katılımı',projectIdentity:'proje/kimlik',manipulationClean:'manipülasyon temizliği',upsideAsymmetry:'yukarı yön asimetrisi'});
const usd=v=>!finite(v)?'yok':v>=1e9?'$'+(v/1e9).toFixed(1)+'B':v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+Math.round(v);
function info(r,network){
 const x=r.researchRank?.version===VERSION?r.researchRank:rank(r,r.rank||0),pc=r.profileCompleteness;
 const top=Object.entries(x.components||{}).map(([k,v])=>[k,v*WEIGHTS[k]]).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>C_TR[k]).join(', ');
 const parts=['ARCY sıralaması #'+(x.position||r.rank||'-')+' — '+x.researchBand,
  'Öncelik puanı '+x.researchScore+'/100 (yükseliş olasılığı değildir), veri kapsamı %'+x.confidence,
  'En güçlü ölçütler: '+(top||'yok'),
  'Hacim '+usd(r.volume24hUsd)+', likidite '+usd(r.liquidityUsd)+', 24s '+(finite(r.change24hPct)?r.change24hPct.toFixed(1)+'%':'doğrulanmadı'),
  'Sıkışma: '+(r.compression?.status||'kanıt yok'),
  'Değerleme: piyasa değeri '+usd(r.marketCapUsd)+', FDV '+usd(r.fdvUsd)+(r.peerValuation?.percentile!=null?', ağ içi göreli değerleme yüzdeliği '+Math.round(r.peerValuation.percentile*100):'')+' (araştırma sinyali, 2x/10x getiri tahmini değildir)',
  'Kimlik: '+(r.identity?.level||'yok')+', proje profili '+projectProfile(r).level+', profil '+(pc?.score??0)+'/100',
  'Uyarılar: '+((x.warnings||[]).slice(0,4).join(', ')||'yapılan kontrollerde yok (risksizlik kanıtı değildir)'),
  'Ölçülemeyen: '+((x.unmeasured||[]).map(k=>C_TR[k]).join(', ')||'yok'),
  'Güvenlik garantisi değildir; kontrat ve çıkış koşulları bağımsız incelenmelidir',
  'Veri '+String(r.radarAsOf||'bilinmiyor').slice(0,16).replace('T',' ')+' UTC'];
 return parts.map(p=>String(p).replace(/;/g,',')).join('; ').slice(0,1100);
}
module.exports={projectProfile,annotatePeers,VERSION,SCORE_VERSION,WEIGHTS,BANDS,NONCRITICAL,VERIFIED_VETO,CATEGORIES,PROFILE_IDENTITY,RESEARCH_FLOOR,categoryOnlyExclusion,veto,compute,compare,rank,info};
