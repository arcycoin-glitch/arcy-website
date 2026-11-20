'use strict';
// ARCY Radar V5 — IDENTITY LEVELS, RESEARCH PROFILE and RESEARCH TIER (issue #279).
// Separates four things that must never be confused:
//   identity (is this the contract we think it is?), research profile (what do we actually know about the project?),
//   market/liquidity quality, and security/risk evidence. A logo is none of them.
// Research tiers are research prioritisation labels, never safety or investment labels:
//   RESEARCH_QUALIFIED  adequate evidence for research prioritisation (not a safety certification)
//   RESEARCH_CANDIDATE  some evidence supports investigation; important verification still incomplete
//   WATCH_ONLY          preliminary observation; never shown in the main ranking
const CAT=require('./category');
const MM=require('./market-memory');
const CANON=require('./canonical-identity.json');
const D=require('../discovery');
const LEVELS=Object.freeze(['IMPERSONATION_EVIDENCE','IDENTITY_SOURCE_CONFLICT','OFFICIAL_IDENTITY_UNESTABLISHED','EXACT_CONTRACT_OBSERVED','METADATA_CROSS_CORROBORATED','OFFICIAL_CONTRACT_VERIFIED']);
const RANK=Object.fromEntries(LEVELS.map((l,i)=>[l,i]));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// Main-ranking liquidity floors (research prioritisation, not the V3 discovery floors). Pons: a factory launch with a few thousand
// dollars of liquidity is a launch, not a meaningfully liquid research candidate.
const RESEARCH_LIQUIDITY=Object.freeze({ethereum:200000,arc:20000,robinhood:25000,pons:25000});
const MARKET_SPREAD_MAX=3; // providers more than 3x apart on liquidity or 24h volume = market sources disagree
const PROFILE_SECTIONS=Object.freeze(['identity','officialWebsite','officialX','documentation','purpose','tokenRole','marketStructure','contractControls','activity','history']);
// Canonical identity captured from the network explorers (exact contract linked to aggregator market data), dated, expiring.
const canonNow=now=>Number.isFinite(Date.parse(CANON.expiresAt))&&now<=Date.parse(CANON.expiresAt);
const canonByAddr=new Map(),canonByTicker=new Map();
for(const [cid,list] of Object.entries(CANON.networks||{}))for(const e of list){
 canonByAddr.set(cid+':'+e.address,e);
 const t=cid+':'+String(e.symbol||'').trim().toLowerCase();
 if(!canonByTicker.has(t))canonByTicker.set(t,[]);canonByTicker.get(t).push(e);
}
function canonical(chainId,address,now=Date.now()){return canonNow(now)?canonByAddr.get(chainId+':'+String(address||'').toLowerCase())||null:null;}
function canonicalTickerOwners(chainId,symbol,now=Date.now()){return canonNow(now)?canonByTicker.get(chainId+':'+String(symbol||'').trim().toLowerCase())||[]:[];}
// Identity level of one engine row. Order of checks: impersonation, conflict, official, corroborated, observed.
function identityLevel(r,{now=Date.now(),foreignTickers=null}={}){
 const evidence=[],chainId=r.chainId,addr=String(r.address||'').toLowerCase();
 const cat=r.category?.category;
 if(CAT.BLOCKED.has(cat)||(r.reasons||[]).includes('ISSUER_AFFILIATION_NOT_VERIFIED'))return {level:'IMPERSONATION_EVIDENCE',evidence:['IDENTITY_RULE:'+(cat||'ISSUER_AFFILIATION_NOT_VERIFIED')]};
 // another contract on the same chain is the explorer-linked (aggregator-listed) owner of this ticker
 const owners=canonicalTickerOwners(chainId,r.symbol,now);
 if(owners.length===1&&owners[0].address!==addr)return {level:'IMPERSONATION_EVIDENCE',evidence:['TICKER_OWNED_BY_LISTED_CONTRACT:'+owners[0].address]};
 const ft=foreignTickers?.get(String(r.symbol||'').trim().toLowerCase());
 if(ft&&!ft.has(addr))return {level:'IMPERSONATION_EVIDENCE',evidence:['TICKER_OF_VERIFIED_PONS_LAUNCH']};
 if(r.discoveryClass==='CONFLICT'||r.sourceEvidence?.sourcesDisagree||r.sourceEvidence?.crossCheck==='CONFLICT')return {level:'IDENTITY_SOURCE_CONFLICT',evidence:['SOURCES_DISAGREE']};
 const ds=r.dossier?.status;
 // V6: a live re-check of the official page that no longer shows the exact contract voids the official claim (forged / changed site)
 const oc=r.officialCheck?.status;
 if((ds==='OWNER_APPROVED'||ds==='PRIMARY_SOURCE_VERIFIED')&&r.dossier?.siteShowsExactAddress&&oc!=='ADDRESS_NOT_FOUND')
  return {level:'OFFICIAL_CONTRACT_VERIFIED',evidence:['OFFICIAL_SITE_PUBLISHES_EXACT_CONTRACT:'+(r.dossier.evidenceUrl||r.dossier.officialSite||''),...(oc==='ADDRESS_FOUND'?['OFFICIAL_PAGE_RECHECKED:'+String(r.officialCheck.at||'').slice(0,10)]:[])]};
 if(oc==='ADDRESS_NOT_FOUND')return {level:'IDENTITY_SOURCE_CONFLICT',evidence:['OFFICIAL_PAGE_DOES_NOT_SHOW_CONTRACT:'+(r.officialCheck.url||'')]};
 // A creator-linked website that publishes the *exact* address, combined with
 // independently matched exact-contract market observations, corroborates the
 // project's self-reported identity. It is NOT an issuer/official certificate.
 // One website alone, or matched ticker symbols alone, does not qualify.
 if(ds==='PARTIAL_EVIDENCE'&&r.dossier?.siteShowsExactAddress===true&&
  ['ADDRESS_FOUND','CARRIED_FROM_RECENT_CHECK'].includes(oc)&&
  (r.v3Verification?.crossCheck==='MATCHED'||r.sourceEvidence?.crossCheck==='MATCHED'))
  return {level:'METADATA_CROSS_CORROBORATED',evidence:[
   'SELF_PUBLISHED_EXACT_CONTRACT_NOT_OFFICIAL:'+(r.dossier.evidenceUrl||r.dossier.officialSite||''),
   'INDEPENDENT_MARKET_PROVIDERS_MATCH_EXACT_CONTRACT']};
 const c=canonical(chainId,addr,now);
 if(c&&!c.ambiguousTicker)evidence.push('EXPLORER_LINKED_MARKET_LISTING:'+CANON.observedAt.slice(0,10));
 if(r.universe?.identity?.status==='TWO_SOURCE_SYMBOL_MATCH')evidence.push('EXPLORER_AND_DEX_SYMBOL_MATCH');
 if(r.launch?.status==='ONCHAIN_VERIFIED'||r.network==='pons'&&r.v3Stage==='RANKED')evidence.push('PONS_FACTORY_LAUNCH');
 if(evidence.length)return {level:'METADATA_CROSS_CORROBORATED',evidence};
 if(r.v3Verification?.crossCheck==='MATCHED'||r.sourceEvidence?.crossCheck==='MATCHED')return {level:'EXACT_CONTRACT_OBSERVED',evidence:['TWO_INDEXERS_OBSERVE_EXACT_CONTRACT']};
 return {level:'OFFICIAL_IDENTITY_UNESTABLISHED',evidence:[]};
}
const atLeast=(l,min)=>RANK[l]>=RANK[min];
// Research profile: which facts about the project are actually evidenced. Completeness is NOT a security assessment.
function profile(r,{network,now=Date.now(),identity,history}={}){
 const s={},sources=[],missing=[];
 const put=(k,ok,value,src)=>{s[k]=ok?{status:'EVIDENCED',value:value??null,...(src?{source:src}:{})}:{status:'NOT_AVAILABLE'};if(ok&&src)sources.push(src);if(!ok)missing.push(k);};
 const d=r.dossier,c=canonical(r.chainId,r.address,now),reg=r.universe?.registry||null;
 put('identity',atLeast(identity.level,'METADATA_CROSS_CORROBORATED'),identity.level,identity.level==='OFFICIAL_CONTRACT_VERIFIED'?d?.officialSite:c?CANON.sources[String(r.chainId)]:null);
 put('officialWebsite',Boolean(d?.officialSite&&['OWNER_APPROVED','PRIMARY_SOURCE_VERIFIED','PARTIAL_EVIDENCE'].includes(d.status)),d?.officialSite,d?.officialSite);
 put('officialX',false); // no verified social-account source is configured: never inferred from a name
 put('documentation',Boolean(d?.github?.linkedFromOfficialSite),d?.github?.repos?.[0]?'https://github.com/'+d.github.repos[0]:null,d?.github?.repos?.[0]?'https://github.com/'+d.github.repos[0]:null);
 put('purpose',Boolean(reg?.kind||d?.siteContext),reg?reg.project+' — '+reg.kind+' (maintainer-described)':d?.siteContext||null);
 put('tokenRole',Boolean(reg?.kind&&/GOVERNANCE/.test(reg.kind)),reg&&/GOVERNANCE/.test(reg.kind)?'governance token (maintainer-described)':null);
 const ms=finite(r.liquidityUsd)&&finite(r.volume24hUsd);
 put('marketStructure',ms,ms?{liquidityUsd:r.liquidityUsd,volume24hUsd:r.volume24hUsd,pools:r.pairCount??null,turnover:r.liquidityUsd>0?+(r.volume24hUsd/r.liquidityUsd).toFixed(2):null,spread:r.marketSpread||null}:null,r.dexUrl||null);
 const risk=r.evidenceSummary?.risk||{};
 put('contractControls',Object.keys(risk).length>0,risk);
 const dev=r.opportunity?.developmentEvidence;
 put('activity',Boolean(dev||finite(r.opportunity?.dimensions?.team)),dev||null);
 put('history',(history?.observations||0)>=2,history?{observations:history.observations,from:history.from,to:history.to}:null);
 const evidenced=PROFILE_SECTIONS.filter(k=>s[k].status==='EVIDENCED').length;
 const completeness=+(evidenced/PROFILE_SECTIONS.length).toFixed(2);
 return {version:'arcy-research-profile-1',completeness,level:completeness>=0.6?'COMPLETE':completeness>=0.3?'PARTIAL':'MINIMAL',sections:s,
  lastVerifiedAt:r.radarAsOf||(finite(r.snapshotNow)?new Date(r.snapshotNow).toISOString():null),sources:[...new Set(sources.filter(Boolean))].slice(0,6),missing,
  note:'Profile completeness describes available evidence; it is not a security assessment.'};
}
// Research tier: hard gates were applied before this; here: identity, liquidity, history, profile, class, freshness.
function tier(r,{network,layer,identity,profile:p,history}){
 const why=[];
 if((r.discoveryClass||'QUALIFIED')==='MONITOR_ONLY')why.push('MONITOR_ONLY_CLASS');
 if(!atLeast(identity.level,'METADATA_CROSS_CORROBORATED'))why.push('IDENTITY_'+identity.level);
 const floor=RESEARCH_LIQUIDITY[network];
 // conservative depth: when providers contradict each other on liquidity, the lower value decides. A provider that V3 recorded as
 // indexing only part of the pools (PARTIAL_COVERAGE) gives a lower bound, not a contradiction; the wide spread still blocks QUALIFIED.
 const ls=r.marketSpread?.liquidityUsd;
 const liq=finite(ls?.min)&&!ls.partialCoverage?Math.min(ls.min,finite(r.liquidityUsd)?r.liquidityUsd:Infinity):r.liquidityUsd;
 if(!finite(liq)||liq<floor)why.push('LIQUIDITY_BELOW_RESEARCH_FLOOR');
 if(layer!=='ESTABLISHED'&&MM.extreme(history))why.push('HISTORICAL_EXTREME_MOVE');
 if(p.level==='MINIMAL')why.push('RESEARCH_PROFILE_MINIMAL');
 if(r.radarFreshness&&r.radarFreshness!=='FRESH')why.push('SOURCE_NOT_FRESH');
 if(why.length)return {tier:'WATCH_ONLY',reasons:why};
 // V4 ELIGIBLE = every evidence check verified for this exact contract; it qualifies on evidence, not on market-quality score.
 const disagree=['liquidityUsd','volume24hUsd'].filter(f=>{const x=r.marketSpread?.[f];return x&&(x.ratio===null||x.ratio>MARKET_SPREAD_MAX);});
 const qualified=(r.discoveryClass||'QUALIFIED')==='QUALIFIED'&&p.level!=='MINIMAL'&&(r.eligibility==='ELIGIBLE'||(r.qualityRank?.score??0)>=40)&&!disagree.length;
 return {tier:qualified?'RESEARCH_QUALIFIED':'RESEARCH_CANDIDATE',reasons:qualified?[]:disagree.length?disagree.map(f=>'MARKET_SOURCES_DISAGREE_'+(f==='liquidityUsd'?'LIQUIDITY':'VOLUME')):['IMPORTANT_VERIFICATION_INCOMPLETE']};
}
// Layer (EARLY / GROWTH / ESTABLISHED / MATURE): growth needs observed growth, not pool age.
function layer(r,{history,expansionTier=null,now=Date.now()}={}){
 if(expansionTier==='ESTABLISHED')return 'ESTABLISHED';
 const age=D.ageDays(r,now);
 const grew=Boolean(history?.flags?.includes('ACTIVITY_GROWTH_OBSERVED'));
 if(age!==null&&age<90&&!expansionTier)return 'EARLY';
 return grew?'GROWTH':'MATURE';
}
module.exports={MARKET_SPREAD_MAX,LEVELS,RANK,atLeast,RESEARCH_LIQUIDITY,PROFILE_SECTIONS,identityLevel,profile,tier,layer,canonical,canonicalTickerOwners,CANON};
