'use strict';
// ARCY Radar V6 — `arcy-profile-completeness-1` (issue #279).
// A weighted, provenance-carrying measure of RESEARCH COVERAGE for one exact contract. It is NOT a probability of price
// appreciation and NOT a safety rating: a component scores only for evidence that was actually observed; missing evidence
// scores zero, and a missing risk check is never described as safe. Token artwork earns nothing.
//   identity 20 · official website / documentation / purpose 20 · market structure & source agreement 20 ·
//   contract controls & material security analysis 15 · development / product activity 15 · historical evidence 10
const VERSION='arcy-profile-completeness-1';
const WEIGHTS=Object.freeze({identity:20,official:20,market:20,security:15,development:15,history:10});
const MIN_MAIN=60;              // main Top 10 requires at least this verified coverage
const MIN_IDENTITY=12;          // ... AND identity at least explorer/indexer-corroborated (independent of the total)
const MIN_MARKET=10;            // ... AND market evidence of its own (independent of the total)
const SPREAD_MAX=3;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const DAY=86400000;
const OFFICIAL_MAX_AGE_DAYS=120; // a primary-source check older than this no longer counts (re-review required)
function officialFresh(d,now){const t=Date.parse(d?.recheckedAt||d?.checkedAt||'');return Number.isFinite(t)&&now-t<=OFFICIAL_MAX_AGE_DAYS*DAY;}
function compute(r,{network,now=Date.now(),identity=null,researchFloor=null}={}){
 const parts={},add=(k,points,why,prov=null)=>{const c=parts[k]||(parts[k]={score:0,max:WEIGHTS[k],awarded:[],missing:[]});
  if(points>0){c.score=Math.min(c.max,c.score+points);c.awarded.push({why,points,...(prov?{source:prov.source||null,url:prov.url||null,at:prov.at||null}:{})});}
  else c.missing.push(why);};
 for(const k of Object.keys(WEIGHTS))parts[k]={score:0,max:WEIGHTS[k],awarded:[],missing:[]};
 const asOf=r.radarAsOf||(finite(r.snapshotNow)?new Date(r.snapshotNow).toISOString():new Date(now).toISOString());
 const d=r.dossier&&officialFresh(r.dossier,now)&&r.officialCheck?.status!=='ADDRESS_NOT_FOUND'?r.dossier:null;
 // 1. identity (20): official exact-contract publication > explorer/indexer corroboration > exact contract merely observed
 const lvl=identity?.level||r.identity?.level||null;
 const idProv={source:(identity?.evidence||r.identity?.evidence||[])[0]||null,at:asOf};
 if(lvl==='OFFICIAL_CONTRACT_VERIFIED')add('identity',20,'OFFICIAL_SOURCE_PUBLISHES_EXACT_CONTRACT',{source:'official site',url:d?.evidenceUrl||d?.officialSite||null,at:d?.recheckedAt||d?.checkedAt||null});
 else if(lvl==='METADATA_CROSS_CORROBORATED')add('identity',12,'EXPLORER_OR_INDEXER_CORROBORATION_NOT_OFFICIAL',idProv);
 else if(lvl==='EXACT_CONTRACT_OBSERVED')add('identity',4,'EXACT_CONTRACT_OBSERVED_ONLY',idProv);
 else add('identity',0,'IDENTITY_NOT_CORROBORATED');
 // 2. official website (8), documentation (6), project purpose (6) — only from a dated primary-source check, never from aggregator links
 if(d&&['PRIMARY_SOURCE_VERIFIED','OWNER_APPROVED','PARTIAL_EVIDENCE'].includes(d.status)&&d.officialSite)add('official',8,'OFFICIAL_WEBSITE_REVIEWED',{source:'official site',url:d.officialSite,at:d.recheckedAt||d.checkedAt});
 else add('official',0,'OFFICIAL_WEBSITE_NOT_VERIFIED');
 if(d&&(d.docsUrl||d.github?.linkedFromOfficialSite))add('official',6,'DOCUMENTATION_LINKED_FROM_OFFICIAL_SITE',{source:'official documentation',url:d.docsUrl||('https://github.com/'+d.github.repos[0]),at:d.checkedAt});
 else add('official',0,'DOCUMENTATION_NOT_VERIFIED');
 if(d&&d.siteContext)add('official',6,'PURPOSE_STATED_BY_OFFICIAL_SOURCE',{source:'official site',url:d.officialSite,at:d.checkedAt});
 else add('official',0,'PURPOSE_NOT_VERIFIED');
 // 3. market structure (20): research-floor liquidity (8), price corroborated (4), liquidity agreement (4), volume agreement (4)
 const floor=finite(researchFloor)?researchFloor:null;
 const ls=r.marketSpread?.liquidityUsd,vs=r.marketSpread?.volume24hUsd;
 const liq=finite(ls?.min)&&!ls.partialCoverage?Math.min(ls.min,finite(r.liquidityUsd)?r.liquidityUsd:Infinity):r.liquidityUsd;
 if(finite(liq)&&(floor===null||liq>=floor))add('market',8,'LIQUIDITY_AT_OR_ABOVE_RESEARCH_FLOOR',{source:'GeckoTerminal / DEX Screener',url:r.dexUrl||null,at:asOf});
 else add('market',0,'LIQUIDITY_BELOW_FLOOR_OR_UNKNOWN');
 const priceCorroborated=r.v3Verification?.crossCheck==='MATCHED'||r.sourceEvidence?.crossCheck==='MATCHED'||r.universe?.priceCrossCheck?.status==='MATCHED';
 if(priceCorroborated)add('market',4,'PRICE_CORROBORATED_BY_TWO_PROVIDERS',{source:'GeckoTerminal + DEX Screener',at:asOf});else add('market',0,'PRICE_SINGLE_SOURCE');
 if(ls&&finite(ls.ratio)&&ls.ratio<=SPREAD_MAX)add('market',4,'LIQUIDITY_PROVIDERS_AGREE',{source:ls.providers+' providers',at:asOf});else add('market',0,ls?'LIQUIDITY_PROVIDERS_DISAGREE':'LIQUIDITY_SINGLE_SOURCE');
 if(vs&&finite(vs.ratio)&&vs.ratio<=SPREAD_MAX)add('market',4,'VOLUME_PROVIDERS_AGREE',{source:vs.providers+' providers',at:asOf});else add('market',0,vs?'VOLUME_PROVIDERS_DISAGREE':'VOLUME_SINGLE_SOURCE');
 // 4. contract controls & security analysis (15): points for checks that were PERFORMED; a finding is reported elsewhere, never "safe"
 const risk=r.evidenceSummary?.risk||{};
 if(risk.mint)add('security',4,'MINT_SURFACE_ANALYSED:'+risk.mint,{source:'verified source / bytecode',at:asOf});else add('security',0,'MINT_NOT_ANALYSED');
 if(risk.admin)add('security',4,'ADMIN_SURFACE_ANALYSED:'+risk.admin,{source:'verified source / bytecode',at:asOf});else add('security',0,'ADMIN_NOT_ANALYSED');
 if(risk.holders)add('security',3,'HOLDER_CONCENTRATION_ANALYSED:'+risk.holders,{source:'explorer holders',at:asOf});else add('security',0,'HOLDERS_NOT_ANALYSED');
 const ex=r.evidenceSummary?.exit?.status,sell=risk.sell;
 if(ex==='EXIT_SIMULATED'||sell==='SELL_ENABLED_VERIFIED')add('security',4,'EXIT_OR_SELL_PATH_SIMULATED',{source:'eth_call simulation',at:asOf});else add('security',0,'EXIT_NOT_SIMULATED');
 // 5. development / product activity (15): official-site-linked repository activity; NEVER inferred from trading volume
 const prod=r.evidenceSummary?.product||null;
 const officialLink=Boolean(d)||lvl==='OFFICIAL_CONTRACT_VERIFIED';
 if(prod==='VERIFIED_ACTIVE'&&officialLink)add('development',15,'RECENT_ACTIVITY_IN_OFFICIALLY_LINKED_REPOSITORY:'+prod,{source:'GitHub (linked from official site)',url:d?.github?.repos?.[0]?'https://github.com/'+d.github.repos[0]:null,at:asOf});
 else if(prod!=='ABANDONED_VERIFIED'&&d?.github?.linkedFromOfficialSite)add('development',5,'REPOSITORY_LINKED_RECENT_ACTIVITY_NOT_VERIFIED',{source:'GitHub (linked from official site)',url:'https://github.com/'+d.github.repos[0],at:d.checkedAt});
 else add('development',0,'DEVELOPMENT_ACTIVITY_NOT_VERIFIED');
 // 6. historical evidence (10): dated daily series (on-chain reserves or provider OHLCV) > own multi-day observations
 const cx=r.compression;
 const h=r.history;
 if(cx&&finite(cx.days)&&cx.days>=21)add('history',10,'DAILY_SERIES_'+cx.days+'D:'+cx.source,{source:cx.source,at:cx.to||asOf});
 else if(h&&h.observations>=2&&h.from&&h.to&&Date.parse(h.to)-Date.parse(h.from)>=72*3600000)add('history',6,'OWN_OBSERVATIONS_OVER_3_DAYS',{source:'ARCY market memory',at:h.to});
 else if(h&&h.observations>=2)add('history',3,'OWN_OBSERVATIONS_UNDER_3_DAYS',{source:'ARCY market memory',at:h.to});
 else add('history',0,'NO_HISTORICAL_SERIES');
 const score=Object.values(parts).reduce((s,c)=>s+c.score,0);
 const gates=[];
 if(parts.identity.score<MIN_IDENTITY)gates.push('IDENTITY_EVIDENCE_INSUFFICIENT');
 if(parts.market.score<MIN_MARKET)gates.push('MARKET_EVIDENCE_INSUFFICIENT');
 if(score<MIN_MAIN)gates.push('PROFILE_COMPLETENESS_BELOW_60');
 return {version:VERSION,score,max:100,qualifiesMain:gates.length===0,gates,components:parts,
  note:'Research coverage only: not a safety rating, not a price forecast. Missing evidence scores zero.'};
}
// compact public form (snapshot / API): scores and reasons, provenance of awarded parts
function compact(p){
 if(!p)return null;
 return {version:p.version,score:p.score,qualifiesMain:p.qualifiesMain,gates:p.gates,
  components:Object.fromEntries(Object.entries(p.components).map(([k,c])=>[k,{score:c.score,max:c.max,awarded:c.awarded.slice(0,4).map(a=>({why:a.why,points:a.points,source:a.source||null,url:a.url||null,at:a.at||null})),missing:c.missing.slice(0,4)}]))};
}
module.exports={VERSION,WEIGHTS,MIN_MAIN,MIN_IDENTITY,MIN_MARKET,OFFICIAL_MAX_AGE_DAYS,compute,compact};
