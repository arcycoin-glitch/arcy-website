'use strict';
// ARCY Radar V6 — `arcy-research-rank-3`: the premium Top 10 sorter (issue #279).
// Runs AFTER every hard gate (V4 eligibility, risk holds, identity/category blocks, V5 research tier). It only orders rows that are
// allowed into the main ranking and moves rows OUT to WATCH_ONLY when the V6 evidence gates fail; it never adds a row and never
// changes the Discovery Score (arcy-discovery-2). Bands (research prioritisation, never a price forecast):
//   TOP_RESEARCH_SIGNAL   strong, multidimensional, independently corroborated early-activity evidence (not established, no pump
//                         history, no suspicious integrity signal, at least two of: compression/breakout, reviewed on-chain demand,
//                         observed activity growth, verified development)
//   QUALITY_GROWTH        research-qualified with real adoption or development evidence
//   ESTABLISHED_QUALITY   research-qualified A-class established project
//   ADDITIONAL_RESEARCH   in the main ranking with weaker opportunity evidence
const PC=require('./profile-completeness'),CX=require('./compression'),INT=require('./integrity');
const VERSION='arcy-research-rank-3',SCORE_VERSION='arcy-research-score-1';
const BANDS=Object.freeze({TOP_RESEARCH_SIGNAL:0,QUALITY_GROWTH:1,ESTABLISHED_QUALITY:2,ADDITIONAL_RESEARCH:3,WATCH_ONLY:4});
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const IDENTITY_OK=new Set(['METADATA_CROSS_CORROBORATED','OFFICIAL_CONTRACT_VERIFIED']);
// which independent early-activity dimensions are evidenced for this row
function signals(r){
 const s=[];
 if(CX.positive(r.compression))s.push('COMPRESSION_'+r.compression.status);
 const dm=r.evidenceSummary?.demand;
 if(r.qualityRank?.organicBasis==='ONCHAIN_DEMAND_REVIEWED'&&dm&&dm.cluster==='REVIEWED_NO_CONCENTRATION'&&dm.wash==='REVIEWED_NO_SELF_TRADE')s.push('ONCHAIN_DEMAND_REVIEWED');
 if((r.history?.flags||[]).includes('ACTIVITY_GROWTH_OBSERVED'))s.push('ACTIVITY_GROWTH_OBSERVED');
 if(r.evidenceSummary?.product==='VERIFIED_ACTIVE')s.push('DEVELOPMENT_VERIFIED_ACTIVE');
 return s;
}
function topSignal(r,sig=signals(r)){
 const why=[];
 if(r.researchTier!=='RESEARCH_QUALIFIED')why.push('NOT_RESEARCH_QUALIFIED');
 if(r.discoveryTier==='ESTABLISHED')why.push('ESTABLISHED_PROJECT');
 if(!IDENTITY_OK.has(r.identity?.level))why.push('IDENTITY');
 if(!r.profileCompleteness?.qualifiesMain)why.push('PROFILE');
 if(!(r.v3Verification?.crossCheck==='MATCHED'||r.sourceEvidence?.crossCheck==='MATCHED'||r.identity?.level==='OFFICIAL_CONTRACT_VERIFIED'))why.push('NOT_CORROBORATED');
 if(!finite(r.qualityRank?.score)||r.qualityRank.score<50)why.push('QUALITY_BELOW_50');
 if(!finite(r.change24hPct)||r.change24hPct>35||r.change24hPct< -25)why.push('PRICE_MOVE_OUT_OF_RANGE');
 if(r.integrity?.pumpHistory)why.push('PUMP_OR_COLLAPSE_HISTORY');
 if(r.integrity?.suspicious?.length)why.push('SUSPICIOUS_INTEGRITY_SIGNAL');
 // Owner's A-filter is explicitly a pre-expansion compression research filter.
 // Two activity signals without an independently observed compression/breakout
 // phase are not enough to claim a compressed-market early opportunity.
 if(!CX.positive(r.compression))why.push('COMPRESSION_NOT_CONFIRMED');
 if(sig.length<2)why.push('FEWER_THAN_TWO_INDEPENDENT_SIGNALS');
 return {ok:why.length===0,why};
}
function band(r){
 if(r.researchTier==='WATCH_ONLY')return 'WATCH_ONLY';
 const sig=signals(r);
 if(topSignal(r,sig).ok)return 'TOP_RESEARCH_SIGNAL';
 if(r.researchTier==='RESEARCH_QUALIFIED'&&r.discoveryTier==='ESTABLISHED')return 'ESTABLISHED_QUALITY';
 if(r.researchTier==='RESEARCH_QUALIFIED'&&sig.length>=1&&(r.integrity?.suspicious?.length||0)<2)return 'QUALITY_GROWTH';
 return 'ADDITIONAL_RESEARCH';
}
// combined research score: coverage and quality first; compression adds only when it is a positive, verified condition
function researchScore(r){
 const q=finite(r.qualityRank?.score)?r.qualityRank.score:0,p=finite(r.profileCompleteness?.score)?r.profileCompleteness.score:0;
 const c=CX.positive(r.compression)?r.compression.score:0;
 return +(0.45*q+0.40*p+0.15*c).toFixed(2);
}
function compare(a,b){
 const t=BANDS[band(a)]-BANDS[band(b)];if(t)return t;
 const s=researchScore(b)-researchScore(a);if(Math.abs(s)>1e-9)return s;
 const e=(b.evidenceConfidence?.score??-1)-(a.evidenceConfidence?.score??-1);if(e)return e;
 return String(a.key||'').localeCompare(String(b.key||''));
}
// V6 main-ranking gate applied on top of the V5 research tier: profile completeness >= 60 with identity and market evidence of
// their own, no confirmed critical integrity finding; two independent suspicious signals cap the row at RESEARCH_CANDIDATE.
function gate(r){
 const why=[];
 for(const g of r.profileCompleteness?.gates||['PROFILE_COMPLETENESS_NOT_COMPUTED'])why.push(g);
 if(r.integrity?.confirmedCritical?.length)why.push('INTEGRITY_CONFIRMED_CRITICAL');
 // an observed pump, run-up or collapse (ARCY memory or dated daily series) keeps a non-established row out, even after the 24h
 // percentage normalised; an established project keeps it as context only
 if(r.integrity?.pumpHistory&&r.discoveryTier!=='ESTABLISHED')why.push('INTEGRITY_PRICE_EVENT_HISTORY');
 if(why.length)return {tier:'WATCH_ONLY',reasons:why};
 if((r.integrity?.suspicious?.length||0)>=2)return {tier:'RESEARCH_CANDIDATE',reasons:[...(r.researchTier==='RESEARCH_CANDIDATE'?r.researchTierReasons||[]:[]),'MULTIPLE_SUSPICIOUS_INTEGRITY_SIGNALS']};
 return null;
}
module.exports={VERSION,SCORE_VERSION,BANDS,signals,topSignal,band,researchScore,compare,gate};
