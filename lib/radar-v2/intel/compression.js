'use strict';
// ARCY Radar V6 — Compression Intelligence `arcy-compression-1` (issue #279).
// Measures whether price volatility has CONTRACTED while liquidity stayed healthy and participation held or grew, from REAL dated
// daily series only:
//   ONCHAIN_RESERVE_SAMPLES  daily close + historical pool liquidity sampled at UTC-day boundary blocks (ARCY RPC, existing)
//   GECKOTERMINAL_OHLCV      provider daily OHLCV for the exact pool (documented API, bounded, builder only)
// It never builds candles from the current price or 24h metrics. Low volume is NOT an opportunity: illiquid or inactive series are
// NO_COMPRESSION_EVIDENCE. A status is a market-condition description, never a forecast.
const VERSION='arcy-compression-1';
const STATUS=Object.freeze(['COMPRESSION_CONFIRMED','COMPRESSION_EMERGING','BREAKOUT_ACTIVITY_CONFIRMED','INSUFFICIENT_HISTORY','NO_COMPRESSION_EVIDENCE']);
const T=Object.freeze({
 MIN_DAYS:21,          // at least three weeks of daily points
 RECENT:7,             // recent window (days)
 BB:20,                // Bollinger window
 VOL_CONFIRMED:0.6,    // recent realized volatility <= 60% of the prior window
 VOL_EMERGING:0.75,
 RANGE_CONFIRMED:0.6,  // recent normalised range <= 60% of the prior window's (same length)
 RANGE_EMERGING:0.8,
 BBW_PCTL_CONFIRMED:25,// latest Bollinger bandwidth in the lowest quartile of its own history
 LIQ_STABLE:0.8,       // latest liquidity >= 80% of the window median
 FLAT_SHARE_DEAD:0.4,  // >= 40% unchanged closes = no trading, not compression
 VOL_HOLD:0.7,         // recent volume >= 70% of baseline (participation not collapsing)
 BREAKOUT_VOL:2,       // last 3 days volume >= 2x the consolidation baseline
 BREAKOUT_MAX_MOVE:35, // ... with a 3-day price move in (0, +35%]: expansion, not a pump
 MAX_POINTS:90,
 MIN_COVERAGE:0.8     // completed days present / calendar days spanned
});
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const median=a=>{const s=a.filter(finite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const sd=a=>{const x=a.filter(finite);if(x.length<2)return null;const m=x.reduce((s,v)=>s+v,0)/x.length;return Math.sqrt(x.reduce((s,v)=>s+(v-m)**2,0)/(x.length-1));};
const r2=v=>finite(v)?+v.toFixed(3):null;
// Normalise one daily series: [{t(ms),o,h,l,c,v,liq}] sorted, one point per UTC day, positive closes only.
function normalise(points){
 const byDay=new Map();
 for(const p of Array.isArray(points)?points:[]){
  if(!p||!finite(p.t)||!finite(p.c)||p.c<=0)continue;
  byDay.set(Math.floor(p.t/86400000),p);
 }
 return [...byDay.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).slice(-T.MAX_POINTS);
}
function fromOnchain(series){
 // OC.history pool: candles [sec,p,p,p,p,null] + historicalLiquidity [{timestamp,liquidityUsd}]
 if(!series?.candles?.length)return null;
 const liq=new Map((series.historicalLiquidity||[]).map(w=>[w.timestamp,w.liquidityUsd]));
 return {source:'ONCHAIN_RESERVE_SAMPLES',ohlc:false,url:series.sourceUrl||null,
  points:normalise(series.candles.map(c=>({t:c[0]*1000,o:null,h:null,l:null,c:c[4],v:null,liq:finite(liq.get(c[0]))?liq.get(c[0]):null})))};
}
function fromOhlcv(rows,url=null){
 // provider OHLCV rows [sec,o,h,l,c,v]
 if(!Array.isArray(rows)||!rows.length)return null;
 return {source:'GECKOTERMINAL_OHLCV',ohlc:true,url,
  points:normalise(rows.map(x=>Array.isArray(x)?{t:Number(x[0])*1000,o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5]),liq:null}:null).filter(Boolean))};
}
function bbWidth(closes,i){
 const w=closes.slice(i-T.BB+1,i+1);if(w.length<T.BB)return null;
 const m=w.reduce((s,v)=>s+v,0)/w.length,s=sd(w);return m>0&&finite(s)?(4*s)/m:null;
}
// liquidityUsd/floor: today's corroborated depth and the network research floor. participation: optional {recent,baseline} buyers.
function compute({series=null,liquidityUsd=null,floor=null,participation=null,now=Date.now()}={}){
 const base={version:VERSION,status:'INSUFFICIENT_HISTORY',score:0,source:series?.source||null,url:series?.url||null,days:0,from:null,to:null,metrics:{},reasons:[]};
 // provider OHLCV includes the current, still-forming UTC day (partial volume and range): only completed days are measured
 const today=Math.floor(now/86400000);
 const pts=(series?.points||[]).filter(p=>!(series.ohlc&&Math.floor(p.t/86400000)>=today));
 if(pts.length)Object.assign(base,{days:pts.length,from:new Date(pts[0].t).toISOString(),to:new Date(pts.at(-1).t).toISOString()});
 if(pts.length<T.MIN_DAYS){base.reasons.push('FEWER_THAN_'+T.MIN_DAYS+'_DAILY_POINTS');return base;}
 if(now-pts.at(-1).t>3*86400000){base.reasons.push('SERIES_NOT_RECENT');return base;}
 // V7 hardening: providers omit candles for days without trades. A sparse series spread over many weeks is not a continuous daily
 // history (its "recent 7 points" may span a month) and must not read as compression: >= 80% daily coverage is required.
 {const span=Math.round((pts.at(-1).t-pts[0].t)/86400000)+1;base.metrics.dailyCoverage=+(pts.length/span).toFixed(3);
  if(pts.length/span<T.MIN_COVERAGE){base.reasons.push('SERIES_HAS_GAPS');return base;}}
 const closes=pts.map(p=>p.c),n=closes.length;
 const ret=closes.slice(1).map((c,i)=>Math.log(c/closes[i]));
 const flat=ret.filter(x=>Math.abs(x)<1e-9).length/ret.length;
 const vols=pts.map(p=>p.v),hasVol=vols.filter(finite).length>=Math.min(n,T.MIN_DAYS);
 const liqs=pts.map(p=>p.liq),hasLiq=liqs.filter(finite).length>=T.MIN_DAYS*0.7;
 // recent window vs the preceding window of the remaining history
 const rv=sd(ret.slice(-T.RECENT)),pv=sd(ret.slice(0,-T.RECENT));
 const volRatio=finite(rv)&&finite(pv)&&pv>0?rv/pv:null;
 const rng=a=>{const lo=Math.min(...a),hi=Math.max(...a),m=(lo+hi)/2;return m>0?(hi-lo)/m:null;};
 const hasOhlc=series.ohlc&&pts.slice(-T.RECENT).every(p=>finite(p.h)&&finite(p.l));
 const recentRange=hasOhlc?rng(pts.slice(-T.RECENT).flatMap(p=>[p.h,p.l])):rng(closes.slice(-T.RECENT));
 const priorSlice=pts.slice(-2*T.RECENT,-T.RECENT);
 const priorRange=hasOhlc&&priorSlice.every(p=>finite(p.h)&&finite(p.l))?rng(priorSlice.flatMap(p=>[p.h,p.l])):rng(closes.slice(-2*T.RECENT,-T.RECENT));
 const rangeRatio=finite(recentRange)&&finite(priorRange)&&priorRange>0?recentRange/priorRange:null;
 // ATR% only with real high/low
 let atrRatio=null;
 if(hasOhlc&&pts.every(p=>finite(p.h)&&finite(p.l))){
  const tr=pts.map((p,i)=>i?Math.max(p.h-p.l,Math.abs(p.h-pts[i-1].c),Math.abs(p.l-pts[i-1].c))/p.c:(p.h-p.l)/p.c);
  const ra=tr.slice(-T.RECENT).reduce((s,v)=>s+v,0)/T.RECENT,pa=tr.slice(0,-T.RECENT).reduce((s,v)=>s+v,0)/Math.max(1,n-T.RECENT);
  atrRatio=pa>0?ra/pa:null;
 }
 const bbw=[];for(let i=T.BB-1;i<n;i++){const w=bbWidth(closes,i);if(finite(w))bbw.push(w);}
 const bbPct=bbw.length>=5?Math.round(100*bbw.filter(x=>x<=bbw.at(-1)).length/bbw.length):null;
 const volBase=hasVol?median(vols.slice(0,-3)):null,volRecent=hasVol?median(vols.slice(-3)):null;
 const volumeRatio=finite(volBase)&&volBase>0&&finite(volRecent)?volRecent/volBase:null;
 const liqMed=hasLiq?median(liqs):null,liqLast=hasLiq?[...liqs].reverse().find(finite):null;
 const liqStable=finite(liqMed)&&liqMed>0&&finite(liqLast)?liqLast/liqMed>=T.LIQ_STABLE:null;
 const move3=closes.length>=4?(closes.at(-1)/closes.at(-4)-1)*100:null;
 const partRatio=finite(participation?.recent)&&finite(participation?.baseline)&&participation.baseline>0?participation.recent/participation.baseline:null;
 base.metrics={dailyCoverage:base.metrics.dailyCoverage,volatilityRatio:r2(volRatio),rangeRatio:r2(rangeRatio),atrRatio:r2(atrRatio),bandwidthPercentile:bbPct,volumeRatio:r2(volumeRatio),
  liquidityStable:liqStable,flatShare:r2(flat),move3dPct:finite(move3)?+move3.toFixed(1):null,participationRatio:r2(partRatio),
  volumeEvidence:hasVol?'DAILY_VOLUME':'NOT_AVAILABLE',liquidityEvidence:hasLiq?'DAILY_LIQUIDITY':'CURRENT_ONLY'};
 // dead / illiquid series are never "compression"
 if(flat>=T.FLAT_SHARE_DEAD){base.status='NO_COMPRESSION_EVIDENCE';base.reasons.push('INACTIVE_SERIES_UNCHANGED_CLOSES');return base;}
 if(finite(floor)&&(!finite(liquidityUsd)||liquidityUsd<floor)){base.status='NO_COMPRESSION_EVIDENCE';base.reasons.push('LIQUIDITY_BELOW_RESEARCH_FLOOR');return base;}
 if(hasVol&&finite(volBase)&&volBase<=0){base.status='NO_COMPRESSION_EVIDENCE';base.reasons.push('NO_TRADING_VOLUME');return base;}
 if(liqStable===false){base.status='NO_COMPRESSION_EVIDENCE';base.reasons.push('LIQUIDITY_DRAINING');return base;}
 const contracted=finite(volRatio)&&volRatio<=T.VOL_CONFIRMED&&finite(rangeRatio)&&rangeRatio<=T.RANGE_CONFIRMED&&(bbPct===null||bbPct<=T.BBW_PCTL_CONFIRMED);
 const emerging=finite(volRatio)&&volRatio<=T.VOL_EMERGING&&finite(rangeRatio)&&rangeRatio<=T.RANGE_EMERGING;
 // breakout: the PRIOR window was compressed and the last 3 days expand volume (and participation when observed) with a measured move
 const consV=sd(ret.slice(-13,-3)),earlyV=ret.length>=18?sd(ret.slice(0,-13)):null;
 const priorComp=finite(consV)&&finite(earlyV)&&earlyV>0&&consV/earlyV<=T.VOL_CONFIRMED;
 const breakout=priorComp&&finite(volumeRatio)&&volumeRatio>=T.BREAKOUT_VOL&&finite(move3)&&move3>0&&move3<=T.BREAKOUT_MAX_MOVE&&(partRatio===null||partRatio>=1.2);
 const participationHolds=(finite(volumeRatio)&&volumeRatio>=T.VOL_HOLD)||(finite(partRatio)&&partRatio>=1);
 if(breakout){base.status='BREAKOUT_ACTIVITY_CONFIRMED';base.reasons.push('VOLUME_EXPANSION_AFTER_CONSOLIDATION');}
 else if(contracted&&participationHolds&&liqStable!==false){base.status='COMPRESSION_CONFIRMED';base.reasons.push('VOLATILITY_AND_RANGE_CONTRACTED_PARTICIPATION_HELD');}
 else if(contracted||emerging){base.status='COMPRESSION_EMERGING';base.reasons.push(contracted?'CONTRACTION_WITHOUT_VOLUME_OR_PARTICIPATION_EVIDENCE':'PARTIAL_CONTRACTION');}
 else {base.status='NO_COMPRESSION_EVIDENCE';base.reasons.push('NO_VOLATILITY_CONTRACTION');}
 // 0..100 descriptive score (not a forecast): contraction depth, bandwidth rank, participation, liquidity stability
 const c1=finite(volRatio)?Math.max(0,Math.min(1,(1-volRatio)/0.6)):0,c2=finite(rangeRatio)?Math.max(0,Math.min(1,(1-rangeRatio)/0.6)):0;
 const c3=bbPct===null?0:Math.max(0,(100-bbPct)/100),c4=participationHolds?1:0,c5=liqStable===true?1:0;
 base.score=base.status==='NO_COMPRESSION_EVIDENCE'?0:Math.round(30*c1+25*c2+15*c3+20*c4+10*c5);
 return base;
}
const positive=c=>['COMPRESSION_CONFIRMED','BREAKOUT_ACTIVITY_CONFIRMED'].includes(c?.status);
const compact=c=>c?{version:c.version,status:c.status,score:c.score,source:c.source,days:c.days,from:c.from,to:c.to,metrics:c.metrics,reasons:c.reasons.slice(0,3)}:null;
module.exports={VERSION,STATUS,T,compute,fromOnchain,fromOhlcv,normalise,positive,compact};
