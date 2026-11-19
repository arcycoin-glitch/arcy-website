'use strict';
// ARCY Radar V5 Quality Ranking (`arcy-quality-rank-1`), issue #279.
// A SEPARATE, versioned, explainable metric. It never changes `arcy-discovery-2` (SCORE column) or the V4 opportunity score,
// and it is never a safety verdict or a forecast. Missing data earns 0 for that part and is listed in `missing` — it is
// never assumed favourable. A high Quality Ranking cannot override a critical risk: rows with one never reach this layer.
//
// Weights (owner's starting proposal; reviewed against real snapshots in docs/audits/radar-v5-quality-279.md):
//   liquidity & exit quality 25 · organic user/trade growth 20 · project identity & active development 20
//   source consistency & evidence quality 15 · early momentum / price divergence 15 · upcoming verifiable events 5
const D=require('../discovery');
const VERSION='arcy-quality-rank-1';
// 2026-11-20 audit (same version id, documented in docs/audits/radar-v5-quality-279.md): organic growth separates participant
// evidence from transaction-count proxies; identity requires corroboration. Weights unchanged.
const WEIGHTS=Object.freeze({liquidity:25,organicGrowth:20,identity:20,sourceConsistency:15,earlyMomentum:15,upcoming:5});
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const clamp=v=>Math.max(0,Math.min(1,v));
const logScale=(v,min,ref)=>finite(v)&&v>min?clamp(Math.log10(v/min)/Math.log10(ref/min)):0;
const DAY=86400000;
function profile(network){return D.PROFILES[network==='pons'?'pons':network]||D.PROFILES.robinhood;}
function liquidity(r,p,missing){
 if(!finite(r.liquidityUsd)||r.liquidityUsd<=0){missing.push('LIQUIDITY_NOT_OBSERVED');return 0;}
 let s=logScale(r.liquidityUsd,p.minLiq*0.5,p.refLiq);
 // Depth across pools: one observed pool is a single point of exit failure.
 if(!(finite(r.pairCount)&&r.pairCount>=2)){s*=0.85;if(!finite(r.pairCount))missing.push('POOL_COUNT_NOT_OBSERVED');}
 // Volume far above liquidity: either churn or thin depth; it never improves exit quality.
 if(finite(r.volume24hUsd)&&r.volume24hUsd>r.liquidityUsd*5)s*=0.5;
 const exit=r.evidenceSummary?.exit?.status;
 if(exit==='EXIT_SIMULATED')s=Math.min(1,s+0.15);else if(exit==='EXIT_FAILED_VERIFIED')s=0;else missing.push('EXIT_NOT_SIMULATED');
 return s;
}
// Organic growth (#279 V5 audit): a transaction COUNT is a proxy, not adoption. Only distinct-participant evidence earns the
// component: reviewed on-chain buyer breadth (full), or provider-reported unique wallets per trade with balanced flow.
// Without either, trades/balance can earn at most 30 % of the component and the row says UNIQUE_PARTICIPANTS_NOT_OBSERVED.
function organicGrowth(r,p,missing,basis){
 const a=r.activity||null,trades=finite(r.trades24h)?r.trades24h:finite(a?.trades?.h24)?a.trades.h24:null;
 const dem=r.evidenceSummary?.demand;
 if(dem&&Number.isFinite(dem.distinctBuyers)&&dem.cluster==='REVIEWED_NO_CONCENTRATION'&&dem.wash==='REVIEWED_NO_SELF_TRADE'){basis.organic='ONCHAIN_DEMAND_REVIEWED';return 1;}
 if(!finite(trades)){missing.push('TRADES_NOT_OBSERVED');basis.organic='NONE';return 0;}
 const tx=logScale(trades,10,p.refTx);
 let balance=0;
 if(finite(r.buys24h)&&finite(r.sells24h)&&r.buys24h+r.sells24h>0){
  const share=r.buys24h/(r.buys24h+r.sells24h);
  balance=share>=0.35&&share<=0.65?1:clamp(1-(Math.abs(share-0.5)-0.15)/0.3);
 }else missing.push('BUY_SELL_BALANCE_NOT_OBSERVED');
 const wallets=finite(a?.buyers?.h24)&&finite(a?.sellers?.h24)?a.buyers.h24+a.sellers.h24:null;
 if(finite(wallets)&&trades>0){
  // Few wallets doing many trades is churn, not adoption.
  const breadth=clamp((wallets/trades)/0.3);
  basis.organic='PROVIDER_UNIQUE_WALLETS';
  return 0.6*breadth*Math.min(1,0.5+tx)+0.4*balance*breadth;
 }
 missing.push('UNIQUE_PARTICIPANTS_NOT_OBSERVED');basis.organic='TRANSACTION_COUNT_PROXY';
 return 0.3*(0.6*tx+0.4*balance);
}
// Identity & development: only VERIFIED information. A maintainer listing counts only together with a two-indexer contract
// match or the V3 independent cross-check; a logo, a name or popularity never counts.
function identity(r,missing){
 let s=0;
 const listed=r.category?.basis==='EXACT_CONTRACT_LIST';
 const twoSource=r.universe?.identity?.status==='TWO_SOURCE_SYMBOL_MATCH'||r.sourceEvidence?.crossCheck==='MATCHED';
 if(listed&&twoSource)s+=0.35;else if(listed)missing.push('LISTED_CONTRACT_NOT_CORROBORATED');
 const ds=r.dossier?.status;
 if(ds==='OWNER_APPROVED')s+=0.5;else if(ds==='PRIMARY_SOURCE_VERIFIED')s+=0.4;else if(ds==='PARTIAL_EVIDENCE')s+=0.15;
 if(r.registered)s+=0.2;
 const d=r.opportunity?.dimensions||{};
 if(finite(d.team)&&d.team>=50)s+=0.15;
 if(finite(d.product)&&d.product>=50)s+=0.15;
 if(s===0)missing.push('OFFICIAL_IDENTITY_NOT_VERIFIED');
 if(!(finite(d.team)||finite(d.product)))missing.push('DEVELOPMENT_ACTIVITY_NOT_VERIFIED');
 return clamp(s);
}
function sourceConsistency(r,missing){
 const se=r.sourceEvidence||{};
 if(se.crossCheck==='CONFLICT'||se.sourcesDisagree)return 0;
 let s=0;
 if(se.crossCheck==='MATCHED')s+=0.6;else missing.push('INDEPENDENT_CROSS_CHECK_MISSING');
 if(finite(se.crossVerifiedFields)&&finite(se.of)&&se.of>0)s+=0.4*clamp(se.crossVerifiedFields/se.of);
 return clamp(s);
}
// Momentum before price: recent volume above its own daily average while price has NOT already moved much.
function earlyMomentum(r,missing){
 const v=r.activity?.volumeUsd;
 if(!finite(v?.h6)||!finite(v?.h24)||v.h24<=0){missing.push('VOLUME_WINDOWS_NOT_OBSERVED');return 0;}
 if(!finite(r.change24hPct)){missing.push('PRICE_CHANGE_NOT_OBSERVED');return 0;}
 const accel=(v.h6*4)/v.h24;
 const ch=r.change24hPct;
 const priceFactor=ch>=30?0:ch>15?clamp((30-ch)/15):ch>=-10?1:0.5;
 return clamp((accel-0.8)/0.7)*priceFactor;
}
function upcoming(r,now){
 const at=Date.parse(r.catalystAt||'');
 return Number.isFinite(at)&&at>now&&at-now<=60*DAY?1:0;
}
function compute(r,network,now=Date.now()){
 const p=profile(network),missing=[],basis={};
 const c={liquidity:liquidity(r,p,missing),organicGrowth:organicGrowth(r,p,missing,basis),identity:identity(r,missing),
  sourceConsistency:sourceConsistency(r,missing),earlyMomentum:earlyMomentum(r,missing),upcoming:upcoming(r,now)};
 const score=Object.entries(WEIGHTS).reduce((a,[k,w])=>a+w*c[k],0);
 return {version:VERSION,score:+score.toFixed(1),components:Object.fromEntries(Object.entries(c).map(([k,v])=>[k,+v.toFixed(3)])),
  weights:WEIGHTS,organicBasis:basis.organic||'NONE',missing:[...new Set(missing)],notForecast:true,notSafetyVerdict:true};
}
const LABEL=Object.freeze({liquidity:'likidite',organicGrowth:'organik işlem',identity:'kimlik/geliştirme',sourceConsistency:'kaynak tutarlılığı',earlyMomentum:'fiyat öncesi momentum',upcoming:'yaklaşan etkinlik'});
// Short Turkish text for the existing Info control (no ';' — the UI splits on it).
function info(q){
 if(!q)return null;
 const top=Object.entries(q.components).filter(([,v])=>v>=0.5).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>LABEL[k]);
 return 'Kalite Sıralaması '+q.score.toFixed(0)+'/100'+(top.length?' (güçlü: '+top.join(', ')+')':'')+', tahmin değildir';
}
module.exports={compute,info,VERSION,WEIGHTS,LABEL};
