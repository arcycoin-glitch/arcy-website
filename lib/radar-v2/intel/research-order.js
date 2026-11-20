'use strict';
// ARCY research-rank-2: order high-evidence PRE-MOMENTUM activity first, then
// reputable established/growing research, then evidence-backed candidates.
// No growth or price forecast. This sorter never bypasses eligibility, risk
// holds, identity/cross-source vetoes or liquidity floors; engine filters first.
// Market momentum alone (or transaction count) cannot pass the first tier.
const VERSION='arcy-research-rank-2';
const TYPES=Object.freeze({
 EVIDENCED_EARLY_SIGNAL:0,
 RESEARCH_QUALIFIED:1,
 RESEARCH_CANDIDATE:2,
 WATCH_ONLY:3
});
const observed=x=>typeof x==='number'&&Number.isFinite(x);
const score=x=>observed(x)?x:-1;
const corroborated=r=>['MATCHED','CROSS_VERIFIED'].includes(r?.sourceEvidence?.crossCheck)||
 (r?.sourceEvidence?.crossVerifiedFields||0)>=2||
 r?.identity?.level==='OFFICIAL_CONTRACT_VERIFIED';
function earlySignal(r){
 if(r?.researchTier!=='RESEARCH_QUALIFIED')return false;
 if(!['EARLY','GROWTH'].includes(r.discoveryTier))return false;
 if(!['METADATA_CROSS_CORROBORATED','OFFICIAL_CONTRACT_VERIFIED'].includes(r.identity?.level))return false;
 if(!r.researchProfile||r.researchProfile.level==='MINIMAL')return false;
 if(!corroborated(r))return false;
 if(score(r.qualityRank?.score)<50)return false;
 if(!observed(r.change24hPct)||r.change24hPct>35||r.change24hPct< -25)return false;
 if(r.marketSpread&&['liquidityUsd','volume24hUsd'].some(k=>{
  const p=r.marketSpread[k];return p&&(p.ratio===null||p.ratio>3)&&!p.partialCoverage;
 }))return false;
 if((r.history?.flags||[]).some(x=>/EXTREME|RUNUP|DRAWDOWN|PRICE_COLLAPSE/.test(x)))return false;
 // A real on-chain participant observation or a measured multi-day activity trend
 // is required; raw trade count is NOT unique-user growth evidence.
 const demand=r.qualityRank?.organicBasis==='ONCHAIN_DEMAND_REVIEWED';
 const growth=(r.history?.flags||[]).includes('ACTIVITY_GROWTH_OBSERVED');
 return demand||growth;
}
function band(r){
 if(r?.researchTier==='WATCH_ONLY')return 'WATCH_ONLY';
 if(earlySignal(r))return 'EVIDENCED_EARLY_SIGNAL';
 if(r?.researchTier==='RESEARCH_QUALIFIED')return 'RESEARCH_QUALIFIED';
 return 'RESEARCH_CANDIDATE';
}
function compare(a,b){
 const t=TYPES[band(a)]-TYPES[band(b)];
 if(t)return t;
 // Quality rank is the primary comparison WITHIN the same class; V4
 // thresholds/Discovery Score remain separate signals and tie-breakers.
 const q=score(b.qualityRank?.score)-score(a.qualityRank?.score);
 if(q)return q;
 const e=score(b.evidenceConfidence?.score)-score(a.evidenceConfidence?.score);
 if(e)return e;
 const c=score(b.opportunity?.score)-score(a.opportunity?.score);
 if(c)return c;
 const d=score(b.discoveryScore)-score(a.discoveryScore);
 if(d)return d;
 return String(a.key||'').localeCompare(String(b.key||''));
}
module.exports={VERSION,TYPES,earlySignal,band,compare};
