'use strict';
// ARCY Radar V6 — market integrity `arcy-integrity-1` (issue #279): fake-volume, pump and manipulation INDICATORS.
// Every finding has a status: CONFIRMED (observed directly: an ARCY observation, an eth_call simulation, a verified source finding,
// a persistent risk hold), SUSPICIOUS (a statistical signal), UNVERIFIED (could not be decided from the evidence held), or
// UNAVAILABLE (the check was not performed). One suspicious statistic never labels a token fraudulent; findings only restrict
// RANKING (no early-signal band, no RESEARCH_QUALIFIED with two independent suspicious signals). Confirmed critical findings exclude.
const VERSION='arcy-integrity-1';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const CRITICAL=new Set(['HONEYPOT_OR_FAILED_EXIT','CRITICAL_CONTRACT_CONTROL','PERSISTENT_RISK_HOLD']);
const MAX_TURNOVER=5,REPEAT_TRADES_PER_WALLET=20,SPREAD_MAX=3;
function assess(r,{held=false}={}){
 const f=[],add=(code,status,detail=null)=>f.push({code,status,...(detail?{detail}:{})});
 const h=r.history||{},flags=h.flags||[];
 // price behaviour (ARCY's own dated observations)
 if(finite(r.change24hPct)&&r.change24hPct>=70)add('RECENT_EXTREME_PUMP','CONFIRMED','24h '+Math.round(r.change24hPct)+'%');
 if(flags.includes('EXTREME_24H_RISE_OBSERVED')||flags.includes('PRICE_RUNUP_MULTIPLE_OBSERVED'))
  add('HISTORICAL_RUNUP','CONFIRMED',[finite(h.peak24hRisePct)?'peak 24h +'+Math.round(h.peak24hRisePct)+'%':null,finite(h.maxRunupMultiple)&&h.maxRunupMultiple>=3?h.maxRunupMultiple+'x':null,h.peak24hRiseAt?String(h.peak24hRiseAt).slice(0,10):null].filter(Boolean).join(' '));
 if(flags.includes('EXTREME_24H_DROP_OBSERVED')||flags.includes('COLLAPSE_FROM_PEAK_OBSERVED')||(finite(r.change24hPct)&&r.change24hPct<=-50))
  add('SUDDEN_COLLAPSE','CONFIRMED',finite(h.drawdownFromPeakPct)?'from peak '+Math.round(h.drawdownFromPeakPct)+'%':null);
 if(!h.observations)add('PRICE_HISTORY','UNAVAILABLE');
 // volume vs liquidity
 if(finite(r.volume24hUsd)&&finite(r.liquidityUsd)&&r.liquidityUsd>0){if(r.volume24hUsd/r.liquidityUsd>MAX_TURNOVER)add('THIN_LIQUIDITY_HIGH_VOLUME','SUSPICIOUS','turnover '+(r.volume24hUsd/r.liquidityUsd).toFixed(1)+'x');}
 else add('THIN_LIQUIDITY_HIGH_VOLUME','UNAVAILABLE');
 // transaction-level evidence (on-chain demand review), else provider wallet counts, else unavailable
 const dm=r.evidenceSummary?.demand;
 if(dm){
  if(dm.cluster==='CONCENTRATION_SUSPECTED')add('WALLET_CONCENTRATION','SUSPICIOUS','top buyer share above 35% in the reviewed window');
  else if(dm.cluster==='PARTIAL_WINDOW')add('WALLET_CONCENTRATION','UNVERIFIED');
  if(dm.wash==='WASH_SUSPECTED')add('WASH_TRADING_PATTERN','SUSPICIOUS','buy/sell wallet overlap above 50%');
  else if(dm.wash==='PARTIAL_WINDOW')add('WASH_TRADING_PATTERN','UNVERIFIED');
 }else{add('WALLET_CONCENTRATION','UNAVAILABLE');add('WASH_TRADING_PATTERN','UNAVAILABLE');}
 if((r.opportunity?.flags||[]).includes('DEMAND_CONCENTRATED_OR_WASH'))add('ARTIFICIAL_ACTIVITY','SUSPICIOUS','demand concentrated or overlapping');
 const buyers=r.activity?.buyers?.h24,sellers=r.activity?.sellers?.h24,trades=r.trades24h;
 if(finite(buyers)&&finite(sellers)&&finite(trades)){
  const w=buyers+sellers;if(w>0&&trades/w>REPEAT_TRADES_PER_WALLET)add('REPEATED_TRANSACTION_PATTERN','SUSPICIOUS',(trades/w).toFixed(0)+' trades per wallet (24h)');
 }else if(!dm)add('REPEATED_TRANSACTION_PATTERN','UNAVAILABLE');
 // independent providers
 for(const k of ['liquidityUsd','volume24hUsd']){const s=r.marketSpread?.[k];if(!s)continue;
  if(s.ratio===null||s.ratio>SPREAD_MAX)add('PROVIDER_DISCREPANCY_'+(k==='liquidityUsd'?'LIQUIDITY':'VOLUME'),s.partialCoverage?'UNVERIFIED':'SUSPICIOUS',(s.ratio??'∞')+'x');}
 if(r.sourceEvidence?.sourcesDisagree||r.sourceEvidence?.crossCheck==='CONFLICT')add('PROVIDER_DISCREPANCY_PRICE','SUSPICIOUS');
 // exit / honeypot and contract controls (verified checks only)
 const risk=r.evidenceSummary?.risk||{},ex=r.evidenceSummary?.exit?.status;
 if(held)add('PERSISTENT_RISK_HOLD','CONFIRMED');
 if(risk.sell==='SELL_DISABLED_VERIFIED'||ex==='EXIT_FAILED_VERIFIED')add('HONEYPOT_OR_FAILED_EXIT','CONFIRMED');
 else if(!risk.sell&&!ex)add('HONEYPOT_OR_FAILED_EXIT','UNAVAILABLE');
 if(risk.mint==='UNLIMITED_MINT_VERIFIED'||risk.admin==='DANGEROUS_PRIVILEGE_VERIFIED')add('CRITICAL_CONTRACT_CONTROL','CONFIRMED',[risk.mint,risk.admin].filter(Boolean).join(','));
 else if(!risk.mint&&!risk.admin)add('CRITICAL_CONTRACT_CONTROL','UNAVAILABLE');
 const confirmedCritical=f.filter(x=>x.status==='CONFIRMED'&&CRITICAL.has(x.code)).map(x=>x.code);
 const suspicious=[...new Set(f.filter(x=>x.status==='SUSPICIOUS').map(x=>x.code.replace(/^(PROVIDER_DISCREPANCY)_(LIQUIDITY|VOLUME|PRICE)$/,'$1')))];
 const pumped=f.some(x=>x.status==='CONFIRMED'&&['RECENT_EXTREME_PUMP','HISTORICAL_RUNUP','SUDDEN_COLLAPSE'].includes(x.code));
 return {version:VERSION,findings:f,confirmedCritical,suspicious,pumpHistory:pumped,
  summary:confirmedCritical.length?'CONFIRMED_CRITICAL':suspicious.length>=2?'MULTIPLE_SUSPICIOUS_SIGNALS':suspicious.length?'SUSPICIOUS_SIGNAL':pumped?'PRICE_EVENT_HISTORY':'NO_SIGNAL_IN_CHECKS_PERFORMED'};
}
const compact=a=>a?{version:a.version,summary:a.summary,confirmedCritical:a.confirmedCritical,suspicious:a.suspicious,pumpHistory:a.pumpHistory,
 findings:a.findings.filter(x=>x.status!=='UNAVAILABLE').slice(0,6),unavailable:a.findings.filter(x=>x.status==='UNAVAILABLE').map(x=>x.code).slice(0,6)}:null;
module.exports={VERSION,CRITICAL,assess,compact};
