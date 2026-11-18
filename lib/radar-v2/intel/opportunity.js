'use strict';
// ARCY OPPORTUNITY INTELLIGENCE SCORE — V4 (issue #279). Independent of the public arcy-discovery-2 score.
//
// Six dimensions, each 0..100 or null (= evidence unavailable). Weights: product 30, team 20, adoption 15, catalyst 15,
// divergence 10, market 10. A null dimension contributes 0 — unknown is never treated as good — and is reported in
// `coverage`, so a token can never rank highly on market size alone (market + adoption + divergence max = 35).
// Identity and critical risk are NOT score inputs: they are separate eligibility gates applied by pre-catalyst/engine.
// The score is a research-priority index. It is not a probability, a price target or a return forecast.
const VERSION='arcy-opportunity-intel-4';
const WEIGHTS=Object.freeze({product:30,team:20,adoption:15,catalyst:15,divergence:10,market:10});
const MIN_BUYERS=Object.freeze({arc:8,ethereum:15,robinhood:8,pons:8});
const MIN_LIQ=Object.freeze({arc:20000,ethereum:200000,robinhood:25000,pons:3000});
const DAY=86400000;
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const log01=(v,lo,hi)=>finite(v)&&v>0?clamp(Math.log10(v/lo)/Math.log10(hi/lo),0,1):0;
const median3=a=>a.map((_,i)=>i<2?null:[a[i-2],a[i-1],a[i]].sort((x,y)=>x-y)[1]);
function product(ev,flags,now){
 const p=ev.product;if(!p)return null;
 if(p.status==='ABANDONED_VERIFIED'){flags.push('DEVELOPMENT_ABANDONED');return 0;}
 const a=p.activity||{},rel=a.releases90d??(p.updates||[]).length;
 let s=p.status==='VERIFIED_ACTIVE'?40:15;
 s+=Math.min(40,10*rel);
 if(a.lastReleaseAt&&now-Date.parse(a.lastReleaseAt)<=30*DAY)s+=20;
 return clamp(s);
}
function team(ev,flags){
 const a=ev.product?.activity;if(!a)return null;
 if(a.archived){flags.push('REPOSITORY_ARCHIVED');return 0;}
 const authors=a.maxAuthors90d||0;
 let s=authors>=3?50:authors===2?35:authors===1?20:0;
 s+=clamp((a.activeWeeks90d||0)/13*30,0,30);
 if(a.commits30d>0)s+=5;if(a.commits7d>0)s+=5;
 if(Number.isInteger(a.closedIssues90d)&&a.closedIssues90d>0)s+=10;
 // Artificial activity: a large share of 90-day commits on a single day is a burst, not continuity.
 if(a.commits90d>=20&&finite(a.maxDayShare)&&a.maxDayShare>0.6){flags.push('ARTIFICIAL_COMMIT_BURST');s=Math.min(s,25);}
 if(authors<=1&&a.commits90d>=80){flags.push('SINGLE_AUTHOR_HIGH_VOLUME_COMMITS');s=Math.min(s,40);}
 return clamp(s);
}
function adoption(ev,network,flags){
 const d=ev.demand;if(!d)return null;
 const min=MIN_BUYERS[network]||8;
 let s=clamp(40*Math.min(1,d.distinctBuyers/min)+40*log01(d.distinctBuyers,min,min*10),0,80);
 if(d.clusterReview==='REVIEWED_NO_CONCENTRATION')s+=10;
 if(d.washReview==='REVIEWED_NO_SELF_TRADE')s+=10;
 if(d.clusterReview==='CONCENTRATION_SUSPECTED'||d.washReview==='WASH_SUSPECTED'){flags.push('DEMAND_CONCENTRATED_OR_WASH');s=Math.min(s,25);}
 if(ev.risk?.holders?.status==='CONCENTRATED_VERIFIED'){flags.push('HOLDER_CONCENTRATION');s=Math.min(s,30);}
 return clamp(s);
}
function catalyst(ev,now){
 const c=ev.catalyst;if(!c)return null;
 const days=(Date.parse(c.eventAt)-now)/DAY;
 return days<=0?null:days<=30?100:days<=60?80:60;
}
function market(c,ev,network){
 const exit=ev.exit,liq=finite(c.liquidityUsd)?c.liquidityUsd:null;
 if(!exit&&liq===null)return null;
 let s=0;
 if(exit?.status==='EXIT_SIMULATED')s+=60*log01(exit.executableUsd,500,25000);
 else if(exit?.status==='EXIT_FAILED_VERIFIED')s+=0;
 if(liq!==null)s+=40*log01(liq,MIN_LIQ[network]||20000,(MIN_LIQ[network]||20000)*50);
 return clamp(s);
}
// Time-aligned price/liquidity trend from ARCY's own on-chain daily samples (never provider OHLCV).
function priceTrend(ev,now,benchmark){
 const h=ev.history?.[0];
 if(!h||!Array.isArray(h.candles)||h.candles.length<8)return {status:'PRICE_HISTORY_NOT_VERIFIED'};
 const pts=h.candles.map(x=>({at:x[0]*1000,close:x[4]})).sort((a,b)=>a.at-b.at);
 const liq=new Map((h.historicalLiquidity||[]).map(w=>[w.timestamp*1000,w.liquidityUsd]));
 const last=pts.at(-1),at=(days)=>{const t=last.at-days*DAY;let best=null;for(const p of pts)if(p.at<=t+DAY/2)best=p;return best&&Math.abs(best.at-t)<=2*DAY?best:null;};
 const chg=(p)=>p?+((last.close/p.close-1)*100).toFixed(2):null;
 const smooth=median3(pts.map(p=>p.close)).filter(finite),peak=smooth.length?Math.max(...smooth):null;
 const first=pts[0],l0=liq.get(first.at),l1=liq.get(last.at);
 const p30=chg(at(30)),b30=benchmark?.change30dPct;
 return {status:'ONCHAIN_DAILY_SAMPLES',candles:pts.length,change7dPct:chg(at(7)),change30dPct:p30,change90dPct:null,change90dStatus:'NOT_MEASURED_30D_WINDOW',
  drawdownFromSustainedPeakPct:peak?+((last.close/peak-1)*100).toFixed(2):null,
  liquidityChangePct:finite(l0)&&finite(l1)&&l0>0?+((l1/l0-1)*100).toFixed(2):null,
  benchmark:benchmark?{id:benchmark.id,change30dPct:b30}:null,relative30dPct:finite(p30)&&finite(b30)?+(p30-b30).toFixed(2):null,
  firstAt:new Date(first.at).toISOString(),lastAt:new Date(last.at).toISOString()};
}
function divergence(trend,fund,adoptionScore,flags){
 if(trend.status!=='ONCHAIN_DAILY_SAMPLES')return {score:null,signal:'PRICE_HISTORY_NOT_VERIFIED'};
 if(fund===null)return {score:null,signal:'FUNDAMENTALS_NOT_VERIFIED'};
 const rel=finite(trend.relative30dPct)?trend.relative30dPct:trend.change30dPct;
 if(!finite(rel))return {score:null,signal:'PRICE_WINDOW_INCOMPLETE'};
 if(finite(trend.liquidityChangePct)&&trend.liquidityChangePct<=-50){flags.push('LIQUIDITY_COLLAPSE');return {score:0,signal:'LIQUIDITY_COLLAPSED'};}
 if(adoptionScore!==null&&adoptionScore<=25){return {score:0,signal:'ADOPTION_WEAK_OR_CONCENTRATED'};}
 if(fund<50)return {score:0,signal:rel<0?'PRICE_WEAK_FUNDAMENTALS_WEAK':'NO_DIVERGENCE'};
 if(rel>-20)return {score:clamp(20*fund/100),signal:'NO_MATERIAL_UNDERPERFORMANCE'};
 return {score:clamp(Math.min(100,-rel/60*100)*fund/100),signal:'FUNDAMENTALS_IMPROVING_PRICE_WEAK'};
}
function evaluate({candidate:c,evidence:ev,network,now=Date.now(),benchmark=null}){
 const flags=[];
 const dims={product:product(ev,flags,now),team:team(ev,flags),adoption:adoption(ev,network,flags),catalyst:catalyst(ev,now),market:market(c,ev,network),divergence:null};
 const fundVals=[dims.product,dims.team].filter(v=>v!==null),fund=fundVals.length?fundVals.reduce((a,b)=>a+b,0)/fundVals.length:null;
 const trend=priceTrend(ev,now,benchmark),div=divergence(trend,fund,dims.adoption,flags);dims.divergence=div.score;
 let score=0,coverage=0;
 for(const [k,w] of Object.entries(WEIGHTS)){if(dims[k]!==null){score+=w*dims[k]/100;coverage+=w;}}
 return {version:VERSION,score:+score.toFixed(1),coverage:coverage/100,dimensions:Object.fromEntries(Object.entries(dims).map(([k,v])=>[k,v===null?null:+v.toFixed(1)])),
  weights:WEIGHTS,flags:[...new Set(flags)],divergence:{signal:div.signal,...trend},
  developmentEvidence:ev.product?'PUBLIC_REPOSITORY_VERIFIED':'DEVELOPMENT_EVIDENCE_UNAVAILABLE'};
}
// Short, factual evidence sentence for the existing Info control (Turkish UI). No forecast wording.
function infoReason(o,{eligibility,category,catalystAt=null}){
 const parts=[];
 const d=o.dimensions,v=o.divergence;
 parts.push(eligibility==='ELIGIBLE'?'Doğrulanmış erken aşama adayı (tahmin değildir)':'Araştırma izleme listesi — DOĞRULANMADI');
 if(d.product!==null)parts.push(d.product>=60?'Doğrulanmış ürün sürümleri':'Ürün geliştirme kanıtı zayıf');
 else parts.push('Ürün/geliştirme kanıtı yok (kayıtlı resmi kaynak yok)');
 if(d.team!==null)parts.push(d.team>=50?'Geliştirme sürüyor':'Geliştirme sürekliliği zayıf');
 if(d.adoption!==null)parts.push(o.flags.includes('DEMAND_CONCENTRATED_OR_WASH')?'Alım tarafı yoğunlaşmış/şüpheli':'Zincir üstü alıcı katılımı doğrulandı');
 else parts.push('Kullanıcı aktivitesi doğrulanmadı');
 if(v.status==='ONCHAIN_DAILY_SAMPLES'&&finite(v.change30dPct))parts.push('30 günlük fiyat '+(v.change30dPct>0?'+':'')+v.change30dPct.toFixed(0)+'%');
 else parts.push('Fiyat geçmişi doğrulanmadı');
 parts.push(catalystAt?'Resmi tarihli etkinlik: '+catalystAt.slice(0,10):'Doğrulanmış yaklaşan etkinlik yok');
 if(o.flags.length)parts.push('watch: '+o.flags.slice(0,2).join(', '));
 if(category&&category!=='EARLY_STAGE_CANDIDATE')parts.push('Kategori: '+category);
 return parts.join('; ').slice(0,400);
}
module.exports={evaluate,infoReason,priceTrend,divergence,VERSION,WEIGHTS};
