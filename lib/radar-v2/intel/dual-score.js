'use strict';
// ARCY Radar — dual score SHADOW engine (`arcy-dual-score-1`). Research only; NOT served, NOT used for selection or ranking.
// Two independent 0-100 scores for rows that ALREADY passed the production hard vetoes (custom filter):
//   Project Quality   team & development 25 · working product & usage 25 · liquidity & market health 20 ·
//                     community activity & growth 15 · contract security & transparency 15
//   Opportunity       volume compression 30 · volume acceleration vs liquidity 25 · unique user & transaction growth 20 ·
//                     early discovery potential 15 · verifiable upcoming developments 10
// Rules: a sub-criterion earns points only from evidence actually observed on the exact contract; anything without a data
// source scores 0 and is listed as UNMEASURED (never estimated). Security stays a hard veto outside scoring (rows are re-checked
// with the production veto). Established / large projects earn no early-discovery points, so quality alone never puts them on top
// of the opportunity order. Not a price forecast.
const CUSTOM=require('./custom-filter');
const VERSION='arcy-dual-score-2';
const Q_WEIGHTS=Object.freeze({teamDevelopment:25,productUsage:25,liquidityHealth:20,community:15,contractSecurity:15});
const O_WEIGHTS=Object.freeze({volumeCompression:30,volumeAcceleration:25,userTxGrowth:20,earlyDiscovery:15,upcomingDevelopments:10});
const FLOOR=CUSTOM.RESEARCH_FLOOR;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=x=>Math.max(0,Math.min(1,x));
const DAY=86400000;
// one component = sub-parts {points,max,measured,evidence}
function part(){const p={score:0,max:0,measured:0,evidence:[],unmeasured:[]};
 p.add=(max,points,measured,label)=>{p.max+=max;if(measured){p.measured+=max;const v=Math.max(0,Math.min(max,points));p.score+=v;if(label)p.evidence.push(label+(v?':+'+(+v.toFixed(2)):':0'));}
  else if(label)p.unmeasured.push(label);return p;};return p;}
const done=(p,weight)=>({score:+p.score.toFixed(2),max:weight,coverage:+(p.measured/weight).toFixed(2),evidence:p.evidence.slice(0,6),unmeasured:p.unmeasured});

function quality(r,{network=r.network}={}){
 const floor=FLOOR[network]||25000,es=r.evidenceSummary||{},risk=es.risk||{},d=r.dossier||{};
 const pp=CUSTOM.projectProfile(r);
 // 1. team & development (25): officially linked repository activity (15) + public repository record (10); team: no source
 const team=part();
 const dev=r.opportunity?.developmentEvidence?.status||r.developmentEvidence?.status||null;
 const devMeasured=Boolean(es.product||dev||d.github);
 team.add(15,es.product==='VERIFIED_ACTIVE'?15:d.github?.linkedFromOfficialSite?5:0,devMeasured,'OFFICIAL_REPOSITORY_ACTIVITY');
 team.add(10,0,false,'TEAM_IDENTITY_AND_SIZE_NO_SOURCE');
 // 2. working product & usage (25): project-level publication of the exact contract (10), reviewed purpose (5), usage (10)
 const prod=part();
 prod.add(10,{OFFICIAL_PROJECT:10,SELF_PUBLISHED_PROJECT_SITE:6,PROJECT_CHANNELS_LISTED:2,TOKEN_IDENTITY_ONLY:0}[pp.level]||0,true,'PROJECT_'+pp.level);
 prod.add(5,d.siteContext?5:0,Boolean(r.dossier),'REVIEWED_PRODUCT_PURPOSE');
 const dm=es.demand;
 prod.add(10,dm&&finite(dm.distinctBuyers)?10*clamp(dm.distinctBuyers/150)*(dm.cluster==='REVIEWED_NO_CONCENTRATION'?1:0.5):0,Boolean(dm),dm?'ONCHAIN_DISTINCT_USERS':'ONCHAIN_USAGE_NOT_MEASURED');
 // 3. liquidity & market health (20)
 const liqP=part();
 const liq=finite(r.liquidityUsd)?r.liquidityUsd:null,vol=finite(r.volume24hUsd)?r.volume24hUsd:null,ls=r.marketSpread?.liquidityUsd;
 const liqC=finite(ls?.min)&&!ls.partialCoverage&&liq!==null?Math.min(liq,ls.min):liq;
 liqP.add(8,liqC?8*clamp(Math.log10(liqC/(floor*0.1))/Math.log10(20)):0,liq!==null,'DEPTH_VS_NETWORK_FLOOR');
 liqP.add(4,ls&&finite(ls.ratio)&&ls.ratio<=3?4:0,Boolean(ls),'LIQUIDITY_PROVIDERS_AGREE');
 const corr=r.v3Verification?.crossCheck==='MATCHED'||r.sourceEvidence?.crossCheck==='MATCHED';
 liqP.add(4,corr?4:0,true,'PRICE_TWO_PROVIDERS');
 const t=liq&&vol!==null?vol/liq:null;
 liqP.add(4,t===null?0:t>=0.03&&t<=2?4:t<=5?1:0,t!==null,'TURNOVER_HEALTHY');
 // 4. community activity & growth (15): no follower / member / message-count source exists in the pipeline
 const com=part();
 com.add(15,0,false,'COMMUNITY_SIZE_AND_GROWTH_NO_SOURCE');
 // 5. contract security & transparency (15): checks PERFORMED (critical findings are vetoed before scoring)
 const sec=part();
 sec.add(4,risk.mint?4:0,true,'MINT_SURFACE_ANALYSED');
 sec.add(4,risk.admin?4:0,true,'ADMIN_SURFACE_ANALYSED');
 sec.add(4,es.exit?.status==='EXIT_SIMULATED'||risk.sell==='SELL_ENABLED_VERIFIED'?4:0,true,'EXIT_SIMULATED');
 sec.add(3,risk.holders?3:0,true,'HOLDER_CONCENTRATION_ANALYSED');
 const comps={teamDevelopment:done(team,25),productUsage:done(prod,25),liquidityHealth:done(liqP,20),community:done(com,15),contractSecurity:done(sec,15)};
 return summarise(comps,Q_WEIGHTS);
}

function opportunity(r,{network=r.network,now=r.snapshotNow||Date.now()}={}){
 const cx=r.compression||{},cm=cx.metrics||{},act=r.activity||{},h=r.history||{};
 const liq=finite(r.liquidityUsd)?r.liquidityUsd:null,ch=finite(r.change24hPct)?r.change24hPct:null;
 // 1. volume compression (30): only from >= 21 dated daily candles (compression engine)
 const comp=part();
 // volume compression is confirmed only from sufficient history: >= 21 completed daily candles WITH daily volume, spanning no
 // more than 25% missing days, ending within 3 days. A single snapshot or a gappy series is UNMEASURED, never a zero-score signal.
 const hist=historyQuality(cx,now);
 const base=cx.status==='COMPRESSION_CONFIRMED'?30:cx.status==='BREAKOUT_ACTIVITY_CONFIRMED'?24:cx.status==='COMPRESSION_EMERGING'?18:
  finite(cm.volatilityRatio)?10*clamp((1.2-cm.volatilityRatio)/0.8):0;
 comp.add(30,hist.ok?base:0,hist.ok,hist.ok?'COMPRESSION_'+(cx.status||'NONE')+'_'+cx.days+'D':hist.reason);
 // 2. volume acceleration relative to liquidity (25): recent 6h volume rate vs 24h rate, only while turnover stays sane
 const acc=part();
 const v6=act.volumeUsd?.h6,v24=act.volumeUsd?.h24;
 const accel=finite(v6)&&finite(v24)&&v24>0?(v6/6)/(v24/24):null,turn=liq&&finite(v24)?v24/liq:null;
 let a=accel===null?0:clamp((accel-1)/1.5)*25;
 if(turn!==null&&turn>5)a=0;else if(turn!==null&&turn>2)a*=0.5;else if(turn!==null&&turn<0.03)a*=0.3;
 if(ch!==null&&ch>=70)a=0; // acceleration that already produced a spike is not early
 acc.add(25,a,accel!==null&&turn!==null,accel!==null?'VOLUME_RATE_6H_VS_24H_x'+accel.toFixed(2):'INTRADAY_VOLUME_WINDOWS_NOT_AVAILABLE');
 // 3. unique user & transaction growth (20): transactions from intraday windows (10); unique-user growth needs a baseline (10)
 const ug=part();
 const t6=act.trades?.h6,t24=act.trades?.h24;
 const tg=finite(t6)&&finite(t24)&&t24>0?(t6/6)/(t24/24):null;
 ug.add(10,tg===null?0:10*clamp((tg-1)/1.5),tg!==null,tg!==null?'TRADE_RATE_6H_VS_24H_x'+tg.toFixed(2):'TRADE_WINDOWS_NOT_AVAILABLE');
 ug.add(10,0,false,'UNIQUE_WALLET_GROWTH_NO_BASELINE');
 // 4. early discovery potential (15): early-stage category only; young pool, room in valuation, not already run
 const ed=part();
 const early=r.category?.category==='EARLY_STAGE_CANDIDATE';
 const ageD=Date.parse(r.poolCreatedAt||'')?(now-Date.parse(r.poolCreatedAt))/DAY:null;
 const cap=finite(r.marketCapUsd)&&r.marketCapUsd>0?r.marketCapUsd:finite(r.fdvUsd)&&r.fdvUsd>0?r.fdvUsd:null;
 ed.add(5,!early||ageD===null?0:ageD<=30?5:ageD<=180?3:ageD<=365?1:0,ageD!==null||!early,early?'POOL_AGE_DAYS_'+(ageD===null?'?':Math.round(ageD)):'NOT_EARLY_STAGE_CATEGORY');
 ed.add(5,!early||!cap?0:cap<5e7?5:cap<2.5e8?3:cap<1e9?1:0,Boolean(cap)||!early,early?'VALUATION_HEADROOM':'NOT_EARLY_STAGE_CATEGORY');
 const ran=(finite(h.maxRunupMultiple)&&h.maxRunupMultiple>=3)||(ch!==null&&ch>=35)||(h.flags||[]).includes('PRICE_RUNUP_MULTIPLE_OBSERVED');
 // a collapse is not "early": -50% in 24h or -70% from the observed peak earns nothing here (cheap after a crash is not discovery)
 const crashed=(ch!==null&&ch<=-50)||(finite(h.worst24hPct)&&h.worst24hPct<=-50)||(finite(h.drawdownFromPeakPct)&&h.drawdownFromPeakPct<=-70)||
  (h.flags||[]).some(f=>f==='COLLAPSE_FROM_PEAK_OBSERVED'||f==='EXTREME_24H_DROP_OBSERVED');
 ed.add(5,!early||ran||crashed?0:5,true,early?(ran?'ALREADY_RAN':crashed?'COLLAPSED_NOT_EARLY':'NOT_ALREADY_RUN'):'NOT_EARLY_STAGE_CATEGORY');
 // 5. verifiable upcoming developments (10): dated event from an official / primary source in the future
 const up=part();
 const ev=r.evidenceSummary?.catalyst,at=Date.parse(ev?.eventAt||'');
 up.add(10,Number.isFinite(at)&&at>=now?10:0,Boolean(r.registered||r.dossier),Number.isFinite(at)?'DATED_EVENT_'+ev.eventAt.slice(0,10):r.registered||r.dossier?'NO_DATED_UPCOMING_EVENT':'NO_CATALYST_SOURCE_FOR_PROJECT');
 const comps={volumeCompression:done(comp,30),volumeAcceleration:done(acc,25),userTxGrowth:done(ug,20),earlyDiscovery:done(ed,15),upcomingDevelopments:done(up,10)};
 return summarise(comps,O_WEIGHTS);
}
function historyQuality(cx,now){
 const days=cx?.days||0,from=Date.parse(cx?.from||''),to=Date.parse(cx?.to||'');
 if(days<21)return {ok:false,reason:'DAILY_SERIES_UNDER_21_DAYS'};
 if(cx.metrics?.volumeEvidence!=='DAILY_VOLUME')return {ok:false,reason:'NO_DAILY_VOLUME_IN_SERIES'};
 if(!Number.isFinite(from)||!Number.isFinite(to))return {ok:false,reason:'SERIES_DATES_UNKNOWN'};
 const span=Math.round((to-from)/DAY)+1;
 if(days/span<0.75)return {ok:false,reason:'SERIES_HAS_GAPS_'+days+'_OF_'+span+'_DAYS'};
 if(now-to>3*DAY+DAY)return {ok:false,reason:'SERIES_NOT_RECENT'};
 return {ok:true,span};
}
// Evidence state per sub-criterion: MEASURED_STRONG / MEASURED_WEAK (real data, poor result) vs UNMEASURED (no data).
// `measuredScore` = points earned on the evidence that exists (0-100); `score` = points out of the full 100 (missing = 0).
// Confidence: HIGH needs >= 70% coverage, MEDIUM >= 50%, otherwise LOW. A LOW-confidence row is never ranked above a row with
// at least MEDIUM confidence in the shadow order, whatever its score.
const CONF=c=>c>=70?'HIGH':c>=50?'MEDIUM':'LOW';
function summarise(comps,W){
 const score=+Object.values(comps).reduce((s,c)=>s+c.score,0).toFixed(2);
 const coverage=+(Object.keys(W).reduce((s,k)=>s+comps[k].coverage*W[k],0)).toFixed(1);
 for(const [k,c] of Object.entries(comps)){const m=c.coverage*W[k];c.state=m===0?'UNMEASURED':c.score>=0.5*m?'MEASURED_STRONG':'MEASURED_WEAK';}
 const measuredScore=coverage>0?+(100*score/coverage).toFixed(1):null;
 return {score,coverage,measuredScore,confidence:CONF(coverage),components:comps,
  unmeasured:Object.keys(W).filter(k=>comps[k].state==='UNMEASURED'),weak:Object.keys(W).filter(k=>comps[k].state==='MEASURED_WEAK')};
}
const C_TR={teamDevelopment:'ekip/geliştirme',productUsage:'ürün/kullanım',liquidityHealth:'likidite sağlığı',community:'topluluk',contractSecurity:'kontrat güvenliği',
 volumeCompression:'hacim sıkışması',volumeAcceleration:'hacim ivmesi',userTxGrowth:'kullanıcı/işlem büyümesi',earlyDiscovery:'erken keşif',upcomingDevelopments:'yaklaşan gelişmeler'};
// Shadow Info text (Turkish, compact). It is an addition for review; the production Info text is untouched.
function info(q,o){
 const list=ks=>ks.map(k=>C_TR[k]).join(', ')||'yok';
 return ['Fırsat '+o.score+'/100 (kapsam %'+o.coverage+', güven '+o.confidence+', ölçülen veride '+(o.measuredScore??'-')+'/100)',
  'Kalite '+q.score+'/100 (kapsam %'+q.coverage+', güven '+q.confidence+')',
  'Ölçülemeyen: '+list([...o.unmeasured,...q.unmeasured]),
  'Ölçülüp zayıf çıkan: '+list([...o.weak,...q.weak]),
  'Gölge puan: sıralamayı değiştirmez, getiri tahmini değildir'].join('; ').slice(0,700);
}
// Shadow over the production ranked pool (rows that passed every production veto). Production selection is untouched; this
// returns, per network, the production Top 10 next to the dual-score order and the overlap between them.
function shadow(engineResult,{now=Date.now()}={}){
 const out={version:VERSION,generatedAt:new Date(now).toISOString(),servedToUsers:false,basis:'Production hard vetoes first; dual scores computed on the production eligible pool only. Unmeasured criteria score 0.',networks:{}};
 for(const n of ['arc','ethereum','robinhood','pons']){
  const net=engineResult?.networks?.[n],dc=net?.displayCandidates;
  const pool=Array.isArray(dc?.rankedPool)?dc.rankedPool:null;
  if(!pool){out.networks[n]={status:'NO_RANKED_POOL',production:(dc||[]).map(r=>r.symbol)};continue;}
  const safe=pool.filter(r=>!CUSTOM.veto(r)); // defence in depth: same production veto
  const rows=safe.map(r=>{const q=quality(r,{network:n}),o=opportunity(r,{network:n,now:r.snapshotNow||now});
   return {key:r.key,address:r.address,symbol:r.symbol,category:r.category?.category||null,production:{rank:(dc.find(x=>x.key===r.key)||{}).rank||null,score:r.researchRank?.researchScore??CUSTOM.compute(r).score},
    quality:q,opportunity:o,info:info(q,o)};});
  const low=x=>x.opportunity.confidence==='LOW'?1:0;
  const order=[...rows].sort((a,b)=>low(a)-low(b)||b.opportunity.score-a.opportunity.score||b.quality.score-a.quality.score||a.key.localeCompare(b.key));
  const top=order.slice(0,10),prodKeys=dc.map(r=>r.key);
  out.networks[n]={status:'OK',eligiblePool:safe.length,vetoedInShadow:pool.length-safe.length,production:dc.map(r=>({rank:r.rank,symbol:r.symbol,key:r.key})),
   dualTop10:top.map((x,i)=>({rank:i+1,symbol:x.symbol,key:x.key,category:x.category,opportunity:x.opportunity.score,opportunityCoverage:x.opportunity.coverage,opportunityConfidence:x.opportunity.confidence,opportunityMeasured:x.opportunity.measuredScore,quality:x.quality.score,qualityCoverage:x.quality.coverage,qualityConfidence:x.quality.confidence,productionRank:x.production.rank,info:x.info})),
   confidenceCounts:rows.reduce((m,x)=>{m[x.opportunity.confidence]=(m[x.opportunity.confidence]||0)+1;return m;},{}),
   overlapWithProduction:top.filter(x=>prodKeys.includes(x.key)).length,
   meanCoverage:{quality:avg(rows.map(x=>x.quality.coverage)),opportunity:avg(rows.map(x=>x.opportunity.coverage))},
   rows:order.map(x=>({symbol:x.symbol,key:x.key,category:x.category,productionRank:x.production.rank,quality:x.quality,opportunity:x.opportunity,info:x.info}))};
 }
 return out;
}
const avg=a=>a.length?+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(1):null;
const enabled=env=>env?.RADAR_DUAL_SCORE_SHADOW==='true';
module.exports={historyQuality,info,VERSION,Q_WEIGHTS,O_WEIGHTS,quality,opportunity,shadow,enabled};
