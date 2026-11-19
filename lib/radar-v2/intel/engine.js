'use strict';
// ARCY Radar Intelligence Engine — issue #279. SHADOW / INTERNAL. Not wired into any public route or UI.
//
// DISCOVER → IDENTIFY → VERIFY → DETECT CATALYST → ANALYZE ACTIVITY → CHECK HISTORY → ASSESS RISK → RANK → REFRESH
//
// Inputs are the EXISTING Radar section snapshots (lib/radar-v2 load() output or the same JSON from the site's own API):
// no new candidate source, no provider re-ranking, no change to the public arcy-discovery-2 score. Evidence is gathered only
// through ARCY's own adapters (registry, GitHub, Snapshot, Blockscout, read-only RPC, the reviewed Liquidity & Exit engines),
// sealed in-process, and judged by the deterministic pre-catalyst evaluator. Four separate outputs per candidate:
//   eligibility (EXCLUDE | REVIEW | ELIGIBLE), evidenceConfidence (0..1, how much required proof is verified),
//   discoveryScore (unchanged public score, rank order only), risk (independent veto list).
// Never: fills the list, promotes on volume/price, treats missing history as clean, accepts caller-supplied verification.
const P=require('../pre-catalyst'),{NETWORKS}=require('../sources'),registry=require('./registry'),seal=require('./seal'),F=require('./fetch');
const GH=require('./github'),GOV=require('./governance'),EX=require('./explorer'),OC=require('./onchain');
const D=require('../discovery'),CAT=require('./category'),OPP=require('./opportunity'),DOS=require('./dossiers'),RISK_HOLDS=require('./risk-holds'),NM=require('./near-match'),QUALITY=require('./discovery-quality'),QX=require('./quality-expansion'),QR=require('./quality-rank'),U=require('./universe');
const {candidateArtwork}=require('../artwork-evidence');
let DOSSIERS=DOS.load();
const OPPORTUNITY_VERSION='arcy-opportunity-1',DAY=86400000,MAX_SELECTED=10,MAX_DISPLAY=10;
const ORDER=['arc','ethereum','robinhood','pons'];
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const REQUIRED=Object.freeze(['IDENTITY','PRODUCT','CATALYST','HISTORY','DEMAND','EXIT','SELL','MINT','ADMIN']);
const REASON_CLASS=Object.freeze({IDENTITY_NOT_VERIFIED:'IDENTITY',PRODUCT_CONTINUITY_NOT_VERIFIED:'PRODUCT',CATALYST_NOT_VERIFIED:'CATALYST',RUMOR_UNVERIFIED:'CATALYST',
 RUNUP_NOT_VERIFIED:'HISTORY',ORGANIC_BUYER_BREADTH_NOT_VERIFIED:'DEMAND',EXIT_LIQUIDITY_NOT_VERIFIED:'EXIT',SELL_EXIT_NOT_VERIFIED:'SELL',MINT_NOT_VERIFIED:'MINT',ADMIN_NOT_VERIFIED:'ADMIN'});
// Cheapest next evidence action per missing proof (what an operator can actually do; cost = provider calls or human review).
const NEXT_ACTION=Object.freeze({
 IDENTITY:{action:'Owner review: run scripts/radar-registry-propose.cjs for this exact contract, confirm the official domain/repository publishes it, add a reviewed registry entry.',cost:'human review + ~4 GitHub calls'},
 PRODUCT:{action:'Needs >=2 official releases in 90 days from the registered repository (GitHub releases API).',cost:'3 GitHub calls per refresh'},
 CATALYST:{action:'Needs a dated upcoming official event: an open GitHub milestone with a due date or a pending/active vote in the registered Snapshot space.',cost:'1-2 calls per refresh'},
 HISTORY:{action:'Needs 7d/30d daily on-chain samples from a reviewed venue (V2/V3/Uniswap V4) quoted in USD stable or ETH.',cost:'~35-70 RPC calls cold, ~3 warm'},
 DEMAND:{action:'Needs >= network minimum distinct final buyers from the token Transfer logs, low top-buyer share and low buy/sell overlap.',cost:'1-6 eth_getLogs'},
 EXIT:{action:'Needs a verified exit quote from the reviewed Liquidity & Exit engine (>= $1k Arc/Robinhood, >= $5k Ethereum at <=5% cost).',cost:'~15-40 RPC calls'},
 SELL:{action:'Needs a successful transfer-to-pool eth_call from a real recent buyer.',cost:'2 RPC calls'},
 MINT:{action:'Needs explorer-verified source with no mint entry point (or a capped supply), not an upgradeable proxy.',cost:'1 explorer call (not available on Arc)'},
 ADMIN:{action:'Needs explorer-verified source with only standard ERC-20 mutating functions and no proxy.',cost:'1 explorer call (not available on Arc)'}
});
const cache=new Map();
const TTL=Object.freeze({identity:24*3600000,activity:6*3600000,governance:3600000,history:6*3600000,demand:3600000,risk:6*3600000,exit:3600000});
async function cached(kind,key,fn,now,log){
 const k=kind+'|'+key,h=cache.get(k);
 if(h&&h.expires>now){log.cacheHits++;return h.value;}
 const value=await fn();
 cache.set(k,{value,expires:now+TTL[kind],at:now});if(cache.size>1500)cache.delete(cache.keys().next().value);
 return value;
}
const iso=t=>new Date(t).toISOString();
const bound=(c,sourceUrl,now,extra)=>({chainId:c.chainId,address:c.address.toLowerCase(),sourceUrl,observedAt:iso(now),...extra});
const hashOf=x=>registry.digest(x);
// Error label for notes: stable code if present, else a short sanitized message (no URLs, no secrets).
const why=e=>e?.code?String(e.code).slice(0,50)+(Number.isInteger(e.httpStatus)?'_'+e.httpStatus:''):'RPC_'+String(e?.message||'ERROR').replace(/https?:\S+/g,'').replace(/[^A-Za-z0-9]+/g,'_').slice(0,40).toUpperCase();
// ── DISCOVER ─────────────────────────────────────────────────────────────────────────────────────────────
// V4 discovery: the ranked list is only one source. Quiet contracts the existing Radar already inspected but held back
// ONLY by the volume floor, Arc low-volume movers and on-chain pool-creation events are also research candidates.
// Every candidate keeps its exact contract, chain and provenance. No new provider request is made here.
const QUIET_GATES=new Set(['VOLUME_BELOW_NETWORK_FLOOR','TOO_FEW_TRADES']);
function quietOnly(detail){const g=String(detail||'').split(',').map(x=>x.trim()).filter(Boolean);return g.length>0&&g.every(x=>QUIET_GATES.has(x));}
function discover(sections,{maxPerNetwork=30,intake='near-match-1'}={}){
 const legacyIntake=intake==='v4.0';
 const out={},notes=[];
 const ponsVerified=new Set(((sections?.pons?.ok===true&&Array.isArray(sections.pons.tokens))?sections.pons.tokens:[])
  .filter(t=>t?.launch?.status==='ONCHAIN_VERIFIED'&&ADDRESS.test(t.address||'')).map(t=>t.address.toLowerCase()));
 for(const network of ORDER){
  const s=sections?.[network];
  if(!s||s.ok!==true||s.network!==network||s.chainId!==NETWORKS[network].chainId||!Array.isArray(s.tokens)||s.tokens.length>20){
   out[network]={status:s?'INVALID_SNAPSHOT':'SOURCE_UNAVAILABLE',asOf:s?.asOf||null,freshness:s?.freshness||null,candidates:[],bySource:{}};continue;
  }
  const seen=new Map(),candidates=[];let duplicates=0,ponsRouted=0,invalid=0;const bySource={};
  const add=(t,source,extra={})=>{
   if(!t||!ADDRESS.test(t.address||'')||(t.chainId!==undefined&&t.chainId!==NETWORKS[network].chainId)){invalid++;return;}
   const a=t.address.toLowerCase();
   if(seen.has(a)){duplicates++;seen.get(a).provenance.push(source);return;}
   // Pons is a launch subset of Robinhood Chain: a factory-verified Pons launch is shown in Pons only (#286 rule).
   if(network==='robinhood'&&ponsVerified.has(a)){ponsRouted++;return;}
   if(candidates.length>=maxPerNetwork)return;
   const row={...t,...extra,address:a,network,chainId:NETWORKS[network].chainId,radarAsOf:s.asOf,radarFreshness:s.freshness,
    poolCount:t.discovery?.poolsSeen??(t.pool?1:null),quote:t.quote&&typeof t.quote==='object'?t.quote:(typeof t.quote==='string'?{address:t.quote}:t.quote??null),provenance:[source]};
   seen.set(a,row);candidates.push(row);bySource[source]=(bySource[source]||0)+1;
  };
  const gatesOf=d=>String(d||'').split(',').map(x=>x.trim()).filter(Boolean);
  for(const t of s.tokens)add(t,'RADAR_RANKED',{v3:{stage:'RANKED',gates:[],verification:null}});
  for(const t of Array.isArray(s.excluded)?s.excluded.slice(0,80):[]){
   if(/^DIVERSITY_/.test(t?.reason||''))add(t,'RADAR_DIVERSITY_CAP',{exclusionDetail:t.detail,v3:{stage:'DIVERSITY_CAP',gates:[],verification:t.verification||null}});
  }
  // Rows V3 cut only for capacity (top-10 / finalists / shortlist) or non-critical floors: near-match intake.
  for(const t of !legacyIntake&&Array.isArray(s.nearMiss)?s.nearMiss.slice(0,60):[])
   add(t,t.stage==='BELOW_TOP_10'?'RADAR_BELOW_TOP_10':'RADAR_NEAR_MISS_'+t.stage,{v3:{stage:t.stage,gates:Array.isArray(t.gates)?t.gates:[],verification:t.verification||null,scope:t.scope||null}});
  for(const t of Array.isArray(s.excluded)?s.excluded.slice(0,80):[]){
   if(legacyIntake&&!(t?.reason==='INELIGIBLE_AFTER_VERIFICATION'&&quietOnly(t.detail)))continue;
   if(t?.reason==='INELIGIBLE_AFTER_VERIFICATION')add(t,quietOnly(t.detail)?'RADAR_QUIET_VOLUME_FLOOR':'RADAR_POST_VERIFICATION_GATES',{exclusionDetail:t.detail,v3:{stage:'POST_VERIFICATION_GATES',gates:gatesOf(t.detail),verification:t.verification||null}});
   else if(t?.reason==='POOL_UNDER_24H'||t?.reason==='POOL_AGE_NOT_VERIFIED')add(t,'RADAR_MATURITY_GATE',{v3:{stage:'MATURITY',gates:[t.reason],verification:null}});
  }
  for(const t of Array.isArray(s.watchlist)?s.watchlist.slice(0,5):[])
   add(t,'RADAR_LOW_VOLUME_WATCHLIST',{v3:{stage:'POST_VERIFICATION_GATES',gates:['VOLUME_BELOW_NETWORK_FLOOR'],verification:{crossCheck:t.verification?.crossCheck||null,fields:Object.fromEntries(Object.entries(t.fields||{}).map(([k,v])=>[k,v?.status||null])),sourcesDisagree:Object.values(t.fields||{}).some(v=>v?.reasonCode==='SOURCES_DISAGREE')}}});
  for(const t of Array.isArray(s.categories?.newPools?.items)?s.categories.newPools.items.slice(0,8):[])
   if(!t.identityFlag&&t.pool)add({address:t.address,symbol:t.symbol||null,name:t.symbol||null,pool:t.pool,quote:t.quote?{address:t.quote}:null},'ONCHAIN_POOL_CREATION',{firstSeenBlock:t.firstSeenBlock,v3:{stage:'ONCHAIN_POOL_CREATION',gates:['NO_TOKEN_LEVEL_DATA'],verification:null}});
  if(ponsRouted)notes.push({network,code:'PONS_DUPLICATES_ROUTED_TO_PONS',count:ponsRouted});
  out[network]={status:s.freshness==='STALE'?'STALE_SOURCE':'OBSERVED',asOf:s.asOf,freshness:s.freshness,candidates,duplicates,ponsRouted,invalid,bySource,
   v3:{uniqueCandidates:Number.isInteger(s.discovery?.uniqueCandidates)?s.discovery.uniqueCandidates:null,ranked:s.tokens.length,excludedListed:Array.isArray(s.excluded)?s.excluded.length:0,nearMissListed:Array.isArray(s.nearMiss)?s.nearMiss.length:0}};
 }
 return {sections:out,notes};
}
// ── RISK classification from adapter facts (pure) ─────────────────────────────────────────────────────────
function classifyRisk(c,{code,source,holders,sell},now){
 const risk={},facts=[];
 const url=source?.sourceUrl||code?.explorerUrl||null;
 if(code?.ok&&code.hasCode===false){risk.admin=bound(c,url||'https://explorer.invalid/',now,{status:'DANGEROUS_PRIVILEGE_VERIFIED',detail:'NO_CONTRACT_CODE'});return {risk,facts:['NO_CONTRACT_CODE']};}
 const verified=source?.ok&&source.verified===true,surface=verified?source.surface:null;
 const proxy=Boolean(code?.proxy||source?.proxyType),ownerActive=code?.owner&&!code.ownerRenounced;
 if(url){
  // MINT
  if(verified&&surface.hasMint&&!surface.hasCap&&ownerActive)risk.mint=bound(c,url,now,{status:'UNLIMITED_MINT_VERIFIED',detail:'verified source exposes a mint function, no cap(), owner '+code.owner});
  else if(verified&&!surface.hasMint&&!proxy&&!code?.delegatecall)risk.mint=bound(c,url,now,{status:'MINT_BOUNDED_VERIFIED',detail:'verified source has no mint entry point; not a proxy; no DELEGATECALL'});
  else if(verified&&surface.hasMint&&surface.hasCap&&!proxy)risk.mint=bound(c,url,now,{status:'MINT_BOUNDED_VERIFIED',detail:'mint is bounded by cap()'});
  else risk.mint=bound(c,url,now,{status:proxy?'UPGRADEABLE_SUPPLY_LOGIC':code?.mintSelector?'MINT_PRIVILEGE_PRESENT':'MINT_NOT_PROVEN',detail:verified?'verified':'bytecode only'});
  // ADMIN
  if(verified&&surface.dangerous.length&&ownerActive)risk.admin=bound(c,url,now,{status:'DANGEROUS_PRIVILEGE_VERIFIED',detail:'active owner + '+surface.dangerous.join(',')});
  else if(verified&&!proxy&&surface.nonStandard.length===0&&!code?.delegatecall&&!code?.selfdestruct)risk.admin=bound(c,url,now,{status:'ADMIN_REVIEWED',detail:'only standard ERC-20 mutating functions'});
  else risk.admin=bound(c,url,now,{status:proxy?'UPGRADEABLE_PROXY':'ADMIN_NOT_PROVEN',detail:verified?('non-standard: '+surface.nonStandard.slice(0,6).join(',')):'source not verified on a configured explorer'});
 }
 if(holders?.ok&&holders.largestEoaShare!==null)risk.holders=bound(c,holders.sourceUrl,now,{status:holders.largestEoaShare>0.2?'CONCENTRATED_VERIFIED':'NO_SINGLE_EOA_OVER_20PCT',largestEoaShare:holders.largestEoaShare,top10EoaShare:holders.top10EoaShare});
 if(sell?.ok){
  const status=sell.status==='TRANSFER_TO_POOL_SUCCEEDED'?'SELL_ENABLED_VERIFIED':sell.status==='TRANSFER_TO_POOL_REVERTED'?'SELL_DISABLED_VERIFIED':'SELL_UNCLEAR';
  risk.sell=bound(c,sell.explorerUrl,now,{status,detail:'eth_call transfer(pool) from recent buyer '+sell.holder+'; fee-on-transfer not modelled'});
 }
 if(code?.delegatecall)facts.push('DELEGATECALL_IN_RUNTIME');if(code?.selfdestruct)facts.push('SELFDESTRUCT_IN_RUNTIME');if(proxy)facts.push('UPGRADEABLE_PROXY');
 return {risk,facts};
}
function demandEvidence(c,d,now){
 if(!d?.ok)return null;
 const complete=d.window.complete;
 return bound(c,d.explorerUrl,now,{status:'ONCHAIN_VERIFIED',distinctBuyers:d.distinctBuyers,
  clusterReview:complete&&d.topBuyerShare!==null&&d.topBuyerShare<=0.35?'REVIEWED_NO_CONCENTRATION':complete?'CONCENTRATION_SUSPECTED':'PARTIAL_WINDOW',
  washReview:complete&&d.buySellOverlapShare!==null&&d.buySellOverlapShare<=0.5?'REVIEWED_NO_SELF_TRADE':complete?'WASH_SUSPECTED':'PARTIAL_WINDOW',
  window:d.window,scope:d.scope,topBuyerShare:d.topBuyerShare,buySellOverlapShare:d.buySellOverlapShare,buyTransfers:d.buyTransfers,sellTransfers:d.sellTransfers});
}
// Default exit analyzer: the reviewed Liquidity & Exit engines (V2 router-checked, V3 tick replay + QuoterV2, V4 V4Quoter).
async function defaultExit({network,candidate,poolKind,decimals,env,fetcher}){
 const mod={V2:require('../../liquidity-exit-v2'),V3:require('../../liquidity-exit-v3'),V4:require('../../liquidity-exit-v4')}[poolKind];
 if(!mod)return {ok:false,reason:'NO_REVIEWED_EXIT_MODEL'};
 const price=candidate.priceUsd;if(!(price>0)||!Number.isInteger(decimals))return {ok:false,reason:'PRICE_OR_DECIMALS_UNAVAILABLE'};
 const ladder=[1000,5000,25000],amounts=ladder.map(usd=>BigInt(Math.floor(usd/price*1e6))*10n**BigInt(decimals)/1000000n).filter(x=>x>0n).map(String);
 const r=await mod.analyze({network,pool:candidate.pool,tokenIn:candidate.address,amountsIn:amounts,fetcher,env});
 const verified=(r.quotes||[]).map((q,i)=>({usd:ladder[i],q})).filter(x=>x.q.state==='VERIFIED'&&Number.isFinite(x.q.totalVsMidPpm));
 const within=verified.filter(x=>x.q.totalVsMidPpm<=50000);
 return {ok:true,executableUsd:within.length?Math.max(...within.map(x=>x.usd)):0,smallestCostPpm:verified[0]?.q.totalVsMidPpm??null,verifiedSizes:verified.length,
  model:r.model||r.status,block:r.block?.number??null,crossCheck:r.evidence?.crossCheck?.state||null,
  verifiedUsdSizes:verified.map(x=>x.usd)};
}
function confidence(reasons){
 const missing=new Set(reasons.map(r=>REASON_CLASS[r]).filter(Boolean));
 const verified=REQUIRED.filter(k=>!missing.has(k));
 return {score:+(verified.length/REQUIRED.length).toFixed(3),verified,missing:[...missing]};
}
function infoText(c,ev){
 const parts=[];
 const id=ev.identity;if(id)parts.push('Official address published by '+id.proofs.map(p=>p.kind==='GITHUB_FILE'?'github.com/'+p.repo:new URL(p.sourceUrl).hostname).slice(0,2).join(' & '));
 if(ev.product)parts.push(ev.product.updates.length+' official releases in 90d');
 if(ev.catalyst)parts.push(ev.catalyst.kind==='GOVERNANCE_VOTE'?'governance vote closes '+ev.catalyst.eventAt.slice(0,10):'milestone due '+ev.catalyst.eventAt.slice(0,10));
 if(ev.demand)parts.push(ev.demand.distinctBuyers+' distinct on-chain buyers in '+ev.demand.window.hours+'h');
 if(ev.exit)parts.push('exit ≥$'+ev.exit.executableUsd.toLocaleString('en-US')+' at ≤5% cost');
 parts.push('no verified 8x in 7d/30d on-chain history');
 return ('Why selected: '+parts.join('; ')+'. Evidence, not a forecast.').slice(0,300);
}
// ── per-candidate pipeline ───────────────────────────────────────────────────────────────────────────────
async function investigate(c,ctx){
 const {now,reg,o,log,rpcFor,limits,env,fetcher,exitAnalyzer,network,allowOnchain}=ctx;
 const ev={},notes=[],sources=[],ckey=c.chainId+':'+c.address;let poolVerified=false;
 const entry=registry.lookup(reg,c.chainId,c.address);
 // IDENTIFY + VERIFY
 if(entry){
  const idr=await cached('identity',ckey,()=>GH.identity({project:entry.project,token:entry.token,now,o}).catch(e=>({proofs:[],problems:[{reason:e.code||'GITHUB_UNAVAILABLE',transient:true}]})),now,log);
  if(idr.problems.some(p=>p.contradiction)){ev.sourceConsistency='CONTRADICTED';notes.push('REGISTRY_PROOF_CONTRADICTED');}
  if(idr.proofs.length){
   const best=idr.proofs.find(p=>p.kind==='GITHUB_FILE')||idr.proofs[0];
   // A reviewed domain document older than 90 days stops counting (pre-catalyst freshness), forcing re-review.
   const observedAt=best.kind==='GITHUB_FILE'?iso(now):best.checkedAt;
   ev.identity=seal.seal({chainId:c.chainId,address:c.address,sourceUrl:best.sourceUrl,observedAt,status:'OFFICIAL_TOKEN_MATCHED',proofKind:'OFFICIAL_TOKEN_ADDRESS',
    publisherVerified:true,officialPrefixes:registry.officialPrefixes(entry.project),projectId:entry.project.id,registryVersion:reg.version,proofs:idr.proofs,
    githubOwner:idr.owner||null});
   sources.push(...idr.proofs.map(p=>p.sourceUrl));
  }
  for(const p of idr.problems)notes.push('IDENTITY_'+(p.reason||'PROBLEM'));
  // CATALYST + ACTIVITY (official sources only)
  if(entry.project.official?.github){
   const rows=await cached('activity',entry.project.id,()=>GH.activity({project:entry.project,now,o}),now,log);
   const k=GH.classifyActivity(rows,{now,chainId:c.chainId,address:c.address});
   if(k.product){ev.product=seal.seal({...k.product,officialPrefixes:undefined});sources.push(k.product.sourceUrl);}
   if(k.catalyst){ev.catalyst=seal.seal(k.catalyst);sources.push(k.catalyst.sourceUrl);}
   if(k.reason)notes.push(k.reason);
  }
  if(entry.project.official?.snapshotSpace){
   const space=entry.project.official.snapshotSpace;
   const g=await cached('governance',space,()=>GOV.proposals({space,now,o}).catch(e=>({ok:false,reason:e.code})),now,log);
   const event=g.ok?GOV.classify(g.items,{now,chainId:c.chainId,address:c.address,space}):null;
   if(event&&(!ev.catalyst||Date.parse(event.eventAt)<Date.parse(ev.catalyst.eventAt))){ev.catalyst=seal.seal(event);sources.push(event.sourceUrl);}
   if(!g.ok)notes.push('GOVERNANCE_'+(g.reason||'UNAVAILABLE'));
  }
 }
 // DOSSIER (not identity): when ARCY's primary-source check found that the OFFICIAL SITE links a public repository, that
 // repository's activity is researched for the product/team dimensions. Identity, catalyst and eligibility stay unverified.
 const dossier=entry?null:DOS.lookup(DOSSIERS,c.chainId,c.address);
 if(dossier&&DOS.researchableRepo(dossier)){
  const pseudo={id:'dossier-'+dossier.id,official:{github:{owner:dossier.github.owner,repos:dossier.github.repos}},
   proofs:dossier.github.binding?[{kind:'GITHUB_FILE',repo:dossier.github.binding.repo,path:dossier.github.binding.path,ref:dossier.github.binding.ref,addresses:[c.address]}]:[]};
  try{
   if(pseudo.proofs.length){const idr=await cached('identity','dossier:'+ckey,()=>GH.identity({project:pseudo,token:{address:c.address},now,o}),now,log);
    if(idr.problems.some(p=>p.contradiction)){ev.sourceConsistency='CONTRADICTED';notes.push('DOSSIER_BINDING_CONTRADICTED');}
    else if(idr.proofs.length)notes.push('DOSSIER_REPO_BINDING_RECHECKED');}
   const rows=await cached('activity',pseudo.id,()=>GH.activity({project:pseudo,now,o}),now,log);
   const k=GH.classifyActivity(rows,{now,chainId:c.chainId,address:c.address});
   if(k.product){ev.product=seal.seal({...k.product,basis:'DOSSIER_OFFICIAL_SITE_LINKED_REPOSITORY'});sources.push(k.product.sourceUrl);notes.push('DEVELOPMENT_FROM_DOSSIER_REPO');}
  }catch(e){notes.push('DOSSIER_GITHUB_'+(e.code||'ERROR'));}
 }
 // ON-CHAIN (bounded; registered candidates first, then a few top-ranked unregistered for exclusion insight)
 const rpc=rpcFor(network==='pons'?'robinhood':network);
 const chainNet=network==='pons'?'robinhood':network;
 ctx.category=CAT.classify(c,network,now);
 if(!CAT.isEarly(ctx.category)){notes.push('ONCHAIN_SKIPPED_NOT_EARLY_STAGE');}
 else if(allowOnchain&&rpc&&c.pool){
  const budget=ctx.rpcBudget[chainNet];
  try{
   const h=await cached('history',ckey,()=>OC.history({rpc,network:chainNet,candidate:c,now,budget,days:30,blockCache:ctx.blockCache[chainNet],ethUsd:ctx.shared.ethUsd,ethRpc:rpcFor('ethereum')}),now,log);
   if(h.ok){if(h.ethUsd)ctx.shared.ethUsd=h.ethUsd;ev.history=[seal.seal(h.pool)];
    const latest=h.pool.candles.at(-1)?.[4];
    if(latest&&c.priceUsd>0&&now-h.pool.candles.at(-1)[0]*1000<2*DAY){
     if(Math.abs(latest/c.priceUsd-1)>0.25){notes.push('PRICE_SOURCE_DISAGREEMENT');ev.sourceConsistency='CONTRADICTED';}
     else if(ev.sourceConsistency!=='CONTRADICTED')ev.sourceConsistency='CONSISTENT';
    }
   }else notes.push('HISTORY_'+h.reason);
  }catch(e){notes.push('HISTORY_'+why(e));}
  let identity=null;
  try{identity=await OC.identify(OC.metered(rpc,budget,chainNet,{pace:budget.pace!==false}),chainNet,c.pool,c.address,c.quote?.address||'');}catch(e){notes.push('POOL_IDENTITY_'+why(e));}
  if(identity?.ok){
   poolVerified=true;
   let d=null;
   try{d=await cached('demand',ckey,()=>OC.demand({rpc,network:chainNet,candidate:c,now,budget,poolIdentity:identity}),now,log);const de=demandEvidence(c,d,now);if(de){ev.demand=seal.seal(de);sources.push(de.sourceUrl);}else if(d&&!d.ok)notes.push('DEMAND_'+d.reason);}
   catch(e){notes.push('DEMAND_'+why(e));}
   try{
    const facts=await cached('risk',ckey,async()=>{
     const code=await OC.contract({rpc,network:chainNet,candidate:c,budget});
     let source=null,holders=null;
     if(EX.HOST[network]){
      try{source=await EX.contract({network,address:c.address,o});}catch(e){notes.push('EXPLORER_'+(e.code||'ERROR'));}
      try{holders=await EX.holders({network,address:c.address,o,exclude:[identity.emitter]});}catch(e){notes.push('HOLDERS_'+(e.code||'ERROR'));}
     }
     const sell=d?.lastBuyer?await OC.sellSimulation({rpc,network:chainNet,candidate:c,holder:d.lastBuyer.address,poolIdentity:identity,budget}):{ok:false,reason:'NO_RECENT_BUYER'};
     return {code,source,holders,sell};
    },now,log);
    const r=classifyRisk(c,facts,now);
    ev.risk=Object.fromEntries(Object.entries(r.risk).map(([k,v])=>[k,seal.seal(v)]));
    notes.push(...r.facts);
   }catch(e){notes.push('RISK_'+why(e));}
   if(identity.kind&&limits.exit!==false){
    try{
     const dec=await (async()=>{const raw=await OC.metered(rpc,budget,chainNet,{pace:budget.pace!==false})('eth_call',[{to:c.address,data:OC.SELECTORS.decimals},'latest']);return Number(BigInt('0x'+String(raw).slice(2,66)));})();
     const x=await cached('exit',ckey,()=>exitAnalyzer({network:chainNet,candidate:c,poolKind:identity.kind,decimals:dec,env,fetcher}),now,log);
     if(x.ok){
      const minExit=chainNet==='ethereum'?5000:1000;
      const thresholdVerified=Array.isArray(x.verifiedUsdSizes)&&x.verifiedUsdSizes.includes(minExit);
      const status=x.executableUsd>=minExit?'EXIT_SIMULATED':thresholdVerified&&x.executableUsd<minExit?'EXIT_FAILED_VERIFIED':'EXIT_INCONCLUSIVE';
      ev.exit=seal.seal(bound(c,OC.EXPLORER[chainNet]+'/address/'+(identity.kind==='V4'?identity.emitter:identity.pool),now,{status,executableUsd:x.executableUsd,poolLiquidityUsd:c.liquidityUsd,model:x.model,block:x.block,crossCheck:x.crossCheck,verifiedSizes:x.verifiedSizes,thresholdVerified,thresholdUsd:minExit,smallestCostPpm:x.smallestCostPpm,pool:c.pool}));
     }else notes.push('EXIT_'+x.reason);
    }catch(e){notes.push('EXIT_'+why(e));}
   }
  }else if(identity)notes.push('POOL_'+identity.reason);
 }else if(!allowOnchain&&CAT.isEarly(ctx.category))notes.push('ONCHAIN_SKIPPED_BY_BUDGET_POLICY');
 else if(!c.pool)notes.push('POOL_UNKNOWN');
 const {evidence,dropped}=seal.trusted(ev);
 const decision=P.evaluate(c,evidence,now);
 // Persistent negative evidence cannot be dropped when an RPC call is skipped or a source is unavailable.
 // Only a newer factory-verified exact-pool exit quote with compatible independently sampled price history clears it.
 const hold=RISK_HOLDS.observe(ctx.riskLedger,c,{exit:evidence.exit,sourceConsistency:evidence.sourceConsistency,poolVerified,now});
 if(hold?.state==='HELD'){
  decision.decision='EXCLUDE';
  if(!decision.reasons.includes('PERSISTENT_LOW_EXIT_LIQUIDITY'))decision.reasons.unshift('PERSISTENT_LOW_EXIT_LIQUIDITY');
  notes.push('AUDITED_NEGATIVE_EVIDENCE_HELD');
 }else if(hold?.state==='CLEARED')notes.push('CRITICAL_HOLD_CLEARED_BY_NEW_VERIFIED_EXIT');
 // V4 category gate: established / stable / wrapped / commodity / equity contracts are not early-stage opportunities.
 const category=ctx.category||CAT.classify(c,network,now);
 if(!CAT.isEarly(category)){
  const tag=CAT.BLOCKED.has(category.category)?'IDENTITY_CATEGORY_BLOCKED':'NOT_EARLY_STAGE_CATEGORY';
  if(!decision.reasons.includes(tag))decision.reasons.unshift(tag);
  decision.decision='EXCLUDE';
 }
 const benchmark=ctx.benchmarkFor?ctx.benchmarkFor(network==='pons'?'robinhood':network):null;
 const opportunity=OPP.evaluate({candidate:c,evidence,network,now,benchmark});
 const nmc=NM.classify(c,network==='pons'?'pons':network,now);
 const conf=confidence(decision.reasons);
 const criticalRisk=decision.reasons.filter(r=>['SELL_DISABLED','UNLIMITED_MINT','DANGEROUS_ADMIN_PRIVILEGE','LOW_EXIT_LIQUIDITY','PERSISTENT_LOW_EXIT_LIQUIDITY','ABANDONED_PROJECT','EXCLUDE_ALREADY_RAN_8X','EXCLUDE_VERIFIED_24H_8X','ISSUER_AFFILIATION_NOT_VERIFIED','CANONICAL_OR_STABLE_ASSET','INVALID_EXACT_CONTRACT'].includes(r));
 const runupCoverage=decision.runup?.status||'RUNUP_NOT_VERIFIED';
 return {key:ckey,network,chainId:c.chainId,address:c.address,symbol:c.symbol||null,name:c.name||null,pool:c.pool||null,dex:c.dex||null,
  category,opportunity,provenance:c.provenance||[],liquidityUsd:Number.isFinite(c.liquidityUsd)?c.liquidityUsd:null,
  priceUsd:Number.isFinite(c.priceUsd)?c.priceUsd:null,volume24hUsd:Number.isFinite(c.volume24hUsd)?c.volume24hUsd:null,
  change24hPct:Number.isFinite(c.change24hPct)?c.change24hPct:null,poolCreatedAt:c.poolCreatedAt||null,snapshotNow:now,
  fdvUsd:Number.isFinite(c.fdvUsd)?c.fdvUsd:null,marketCapUsd:Number.isFinite(c.marketCapUsd)?c.marketCapUsd:null,
  buys24h:Number.isFinite(c.buys24h)?c.buys24h:null,sells24h:Number.isFinite(c.sells24h)?c.sells24h:null,activity:c.activity||null,
  pairCount:Number.isInteger(c.v3?.verification?.pairCount)?c.v3.verification.pairCount:Number.isInteger(c.poolCount)?c.poolCount:null,
  sourceEvidence:sourceEvidenceOf(c),universe:c.universe||null,
  artwork:candidateArtwork(c),trades24h:Number.isFinite(c.buys24h)&&Number.isFinite(c.sells24h)?c.buys24h+c.sells24h:null,v3Verification:c.v3?.verification||null,v3Stage:c.v3?.stage||null,marketObserved:Number.isFinite(c.priceUsd)&&Number.isFinite(c.liquidityUsd),
  catalystAt:evidence.catalyst?.eventAt||null,
  eligibility:decision.decision,reasons:decision.reasons,risk:criticalRisk,evidenceConfidence:conf,discoveryScore:decision.discoveryScore,scoreVersion:decision.scoreVersion,
  runup:{history:runupCoverage,historyReason:decision.runup?.reason||null,pools:decision.runup?.pools||[],recent24h:decision.recentRunup},
  registered:Boolean(entry),projectId:entry?.project.id||null,notes:[...new Set(notes)],droppedUnsealed:dropped,sources:[...new Set(sources)],
  info:decision.decision==='ELIGIBLE'?infoText(c,evidence):null,
  dossier:DOS.label(dossier),nearMatch:nmc,discoveryClass:nmc.discoveryClass,
  infoV4:(NM.infoPrefix(nmc)?NM.infoPrefix(nmc).replace(/;/g,',')+'; ':'')+OPP.infoReason(opportunity,{eligibility:decision.decision,category:category.category,catalystAt:evidence.catalyst?.eventAt||null,dossier:DOS.label(dossier)}),
  evidenceSummary:{identity:Boolean(evidence.identity),product:evidence.product?.status||null,catalyst:evidence.catalyst?{kind:evidence.catalyst.kind,eventAt:evidence.catalyst.eventAt,url:evidence.catalyst.sourceUrl}:null,
   history:evidence.history?{candles:evidence.history[0].candles.length,venue:evidence.history[0].venue,quoteBasis:evidence.history[0].quoteBasis,missing:evidence.history[0].missingSamples}:null,
   demand:evidence.demand?{distinctBuyers:evidence.demand.distinctBuyers,cluster:evidence.demand.clusterReview,wash:evidence.demand.washReview,hours:evidence.demand.window.hours}:null,
   exit:evidence.exit?{status:evidence.exit.status,executableUsd:evidence.exit.executableUsd}:null,
   risk:Object.fromEntries(Object.entries(evidence.risk||{}).map(([k,v])=>[k,v.status]))},
  decisionHash:hashOf({c:{k:ckey,s:c.discovery?.score??null,v:c.discovery?.version??null,a:c.radarAsOf},d:decision.decision,r:decision.reasons})};
}
// ── V5 research rank + explanation (#279) ────────────────────────────────────────────────────────────────
const RESEARCH_RANK_VERSION='arcy-research-rank-1',GROWTH_POOL_DAYS=90;
const usd=v=>!Number.isFinite(v)?'yok':v>=1e9?'$'+(v/1e9).toFixed(1)+'B':v>=1e6?'$'+(v/1e6).toFixed(1)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':'$'+Math.round(v);
const MISSING_TR=Object.freeze({EXIT_NOT_SIMULATED:'çıkış simülasyonu yok',UNIQUE_PARTICIPANTS_NOT_OBSERVED:'benzersiz katılımcı verisi yok (işlem sayısı yalnızca vekil)',
 OFFICIAL_IDENTITY_NOT_VERIFIED:'resmi kimlik kaydı yok',DEVELOPMENT_ACTIVITY_NOT_VERIFIED:'geliştirme etkinliği doğrulanmadı',INDEPENDENT_CROSS_CHECK_MISSING:'bağımsız ikinci kaynak yok',
 LISTED_CONTRACT_NOT_CORROBORATED:'liste kaydı bu çalışmada doğrulanmadı',VOLUME_WINDOWS_NOT_OBSERVED:'saatlik hacim pencereleri yok',POOL_COUNT_NOT_OBSERVED:'havuz sayısı bilinmiyor',
 TRADES_NOT_OBSERVED:'işlem verisi yok',LIQUIDITY_NOT_OBSERVED:'likidite gözlenmedi',BUY_SELL_BALANCE_NOT_OBSERVED:'alım/satım dengesi yok',PRICE_CHANGE_NOT_OBSERVED:'24s fiyat değişimi yok'});
const TIER_TR=Object.freeze({EARLY:'ERKEN KEŞİF',GROWTH:'BÜYÜME — yeni değil, ölçülebilir etkinlik',ESTABLISHED:'A-SINIFI YERLEŞİK PROJE — yerleşik proje kalitesi, getiri tahmini veya güvenlik garantisi değildir'});
const ORGANIC_TR=Object.freeze({ONCHAIN_DEMAND_REVIEWED:'zincir üstü alıcı genişliği incelendi',PROVIDER_UNIQUE_WALLETS:'sağlayıcı benzersiz cüzdan sayıları',TRANSACTION_COUNT_PROXY:'yalnızca işlem sayısı (organik büyüme kanıtı değil)',NONE:'veri yok'});
function researchInfo(r,network,now){
 const q=r.qualityRank,b=r.discoveryFilter==='B_QUALITY_EXPANSION';
 const why=b?('Neden: '+(r.expansion?.basis==='EXACT_CONTRACT_LIST'?'listelenmiş kontrat, iki kaynakta kimlik eşleşti':'ölçülen büyüklük, bağımsız kaynakla doğrulandı')+', likidite/işlem eşikleri geçildi, kritik risk kaydı yok (güvenlik garantisi değildir)')
  :String(r.infoV4||'').split('; ')[0];
 const trades=Number.isFinite(r.trades24h)?r.trades24h+' işlem':'işlem sayısı yok';
 const asOf=r.radarAsOf||(Number.isFinite(r.snapshotNow)?new Date(r.snapshotNow).toISOString():null);
 // Filter A rows keep their class statement first (existing Info contract); quality-expansion rows lead with their tier.
 const head=b?[TIER_TR[r.discoveryTier]||r.discoveryTier,why]:[why,TIER_TR[r.discoveryTier]||r.discoveryTier];
 const v4=b?[]:String(r.infoV4||'').split('; ').slice(1,4);
 const parts=[...head,...v4,QR.info(q),
  'Piyasa: likidite '+usd(r.liquidityUsd)+', 24s hacim '+usd(r.volume24hUsd)+', '+trades+', organik katılım: '+(ORGANIC_TR[q.organicBasis]||'veri yok'),
  'Eksik doğrulama: '+(q.missing.map(m=>MISSING_TR[m]).filter(Boolean).slice(0,4).join(', ')||'yok'),
  'Sıralama: sınıf ('+({0:'nitelikli',1:'yakın eşleşme',2:'izleme'}[r.researchRank.classOrder]||'-')+'), doğrulanmış kanıt katmanı '+r.researchRank.evidenceTier+', kalite '+q.score.toFixed(0),
  'Veri: '+(asOf?asOf.slice(0,16).replace('T',' ')+' UTC':'zaman bilinmiyor')];
 return parts.map(x=>String(x).replace(/;/g,',')).join('; ').slice(0,900);
}
// Product-facing fallback for an empty strict eligibility list.
// Never promote REVIEW to ELIGIBLE or silently emit EXCLUDE as an opportunity.
// Keep existing Discovery Score intact; evidence completeness is NOT a
// probability of gains. Invalid engine errors are not usable watch candidates.
function watchCandidates(rows,{limit=MAX_DISPLAY}={}){
 if(!Array.isArray(rows))return [];
 const n=Math.max(0,Math.min(MAX_DISPLAY,Number.isInteger(limit)?limit:MAX_DISPLAY));
 const safe=rows.filter(r=>r&&['ELIGIBLE','REVIEW'].includes(r.eligibility)&&
  typeof r.key==='string'&&/^\d+:0x[0-9a-f]{40}$/i.test(r.key)&&
  !(r.reasons||[]).some(reason=>String(reason).startsWith('ENGINE_ERROR_')));
 const unique=new Map();
 for(const r of safe){if(!unique.has(r.key))unique.set(r.key,r);}
 const ordered=[...unique.values()].sort((a,b)=>{
  const tier=x=>x.eligibility==='ELIGIBLE'?1:0;
  const reliable=x=>!(x.reasons||[]).includes('SOURCE_CONTRADICTION')?1:0;
  const conf=x=>Number.isFinite(x.evidenceConfidence?.score)?x.evidenceConfidence.score:0;
  const score=x=>Number.isFinite(x.discoveryScore)?x.discoveryScore:-1;
  return tier(b)-tier(a)||reliable(b)-reliable(a)||conf(b)-conf(a)||score(b)-score(a)||a.key.localeCompare(b.key);
 });
 return ordered.slice(0,n).map((row,i)=>{
  const reviewed=row.eligibility==='REVIEW',missing=Array.isArray(row.evidenceConfidence?.missing)?row.evidenceConfidence.missing:[];
  const needs=missing.slice(0,3);
  const desc=reviewed
   ?'Research watchlist only; NOT VERIFIED. Missing: '+(needs.length?needs.join(', '):row.reasons.slice(0,2).join(', '))+'.'
   :'Eligible under currently verified evidence; not a forecast.';
  return {...row,rank:i+1,displayTier:reviewed?'WATCHLIST_NOT_VERIFIED':'ELIGIBLE',
   displayReason:desc,selectionBasis:'EVIDENCE_COMPLETENESS_THEN_ARCY_DISCOVERY_SCORE',
   missingProof:missing,watchOnly:reviewed};
 });
}
// V4 display policy (Layer A + Layer B). Up to ten per section, never padded:
//  1 ELIGIBLE · 2 REVIEW with verified product AND active development · 3 REVIEW with verified organic adoption ·
//  4 other early-stage REVIEW contracts whose market was actually observed.
// Never displayed: EXCLUDE (critical risk, already-ran 8x, non-early category, impersonation), source contradictions,
// engine errors, duplicates, rows without observed market data. Suspected concentrated/overlapping demand is demoted, labelled.
function selectDisplay(rows,{limit=MAX_DISPLAY,network=null,held=new Set(),now=Date.now(),filterB=true,foreignTickers=null}={}){
 const n=Math.max(0,Math.min(MAX_DISPLAY,Number.isInteger(limit)?limit:MAX_DISPLAY)),dropped={};
 const drop=(why)=>{dropped[why]=(dropped[why]||0)+1;};
 const ok=new Map();
 // Same ticker on several contracts in one section without identity proof: a near-match/monitor row is never a filler for an
 // unresolved look-alike (exact-contract QUALIFIED rows keep V3's own de-duplication result).
 const tickers=new Map();for(const r of Array.isArray(rows)?rows:[]){const t=String(r?.symbol||'').trim().toLowerCase();if(t){if(!tickers.has(t))tickers.set(t,new Set());tickers.get(t).add(String(r.address||'').toLowerCase());}}
 for(const r of Array.isArray(rows)?rows:[]){
  if(!r||typeof r.key!=='string'||!/^\d+:0x[0-9a-f]{40}$/i.test(r.key)){drop('INVALID_KEY');continue;}
  if(ok.has(r.key)){drop('DUPLICATE_EXACT_CONTRACT');continue;}
  // V4 hard gates always win over discovery class (adaptive discovery, never adaptive safety).
  if(r.eligibility==='EXCLUDE'){drop((r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY')?'NOT_EARLY_STAGE_CATEGORY':(r.reasons||[]).includes('PERSISTENT_LOW_EXIT_LIQUIDITY')?'PERSISTENT_RISK_HOLD':'EXCLUDED_RISK_OR_IDENTITY');continue;}
  if((r.reasons||[]).some(x=>String(x).startsWith('ENGINE_ERROR_'))){drop('ENGINE_ERROR');continue;}
  if((r.reasons||[]).includes('SOURCE_CONTRADICTION')){drop('SOURCE_CONTRADICTION');continue;}
  const cls=r.discoveryClass||'QUALIFIED';
  if(cls==='CONFLICT'){drop('SOURCE_CONFLICT_V3');continue;}
  if(cls==='HARD'){drop('CRITICAL_V3_GATE');continue;}
  if(cls==='NOT_SHOWN'){drop(r.nearMatch?.reason||'NOT_SHOWN');continue;}
  if(r.marketObserved===false){drop('MARKET_NOT_OBSERVED');continue;}
  if(cls!=='QUALIFIED'&&(tickers.get(String(r.symbol||'').trim().toLowerCase())?.size||0)>1){drop('DUPLICATE_TICKER_UNRESOLVED');continue;}
  // Same chain, other tab (#279 V5): a Robinhood near-match/monitor row must not carry the ticker of a DIFFERENT, factory-verified
  // Pons Launch contract (look-alike of a verified launch). QUALIFIED rows keep V3's own exact-contract result.
  {const ft=foreignTickers?.get(String(r.symbol||'').trim().toLowerCase());if(cls!=='QUALIFIED'&&ft&&!ft.has(String(r.address||'').toLowerCase())){drop('DUPLICATE_TICKER_CROSS_SECTION');continue;}}
  const qualityReason=QUALITY.reason(r,network);
  if(qualityReason){drop(qualityReason);continue;}
  ok.set(r.key,r);
 }
 const d=r=>r.opportunity?.dimensions||{};
 const CLASS_ORDER={QUALIFIED:0,NEAR_MATCH:1,MONITOR_ONLY:2};
 const cls=r=>CLASS_ORDER[r.discoveryClass||'QUALIFIED'];
 // Heuristic demand concentration/overlap is a warning, not confirmed manipulation: shown last within its class, labelled.
 const suspect=r=>(r.opportunity?.flags||[]).includes('DEMAND_CONCENTRATED_OR_WASH');
 const tier=r=>r.eligibility==='ELIGIBLE'&&!suspect(r)?1:suspect(r)?4:(d(r).product>=50&&d(r).team>=50)?2:d(r).adoption>=50?3:4;
 const crossed=r=>Object.values(r.nearMatch?.passed||[]).length+((r.v3Verification?.crossCheck==='MATCHED')?1:0);
 // arcy-research-rank-1 comparator: class (QUALIFIED > NEAR_MATCH > MONITOR_ONLY), then for near/monitor rows the distance to the
 // real thresholds, then V4 verified-evidence tier, then the separate Quality Ranking, then the previous V4 keys. Applied to
 // Filter A and quality-expansion rows alike, so a corroborated established project outranks a weak monitor row, while a
 // verified-evidence row is never pushed below an unverified one by market size.
 const qs=r=>r.qualityRank?.score??-1;
 const cmp=(a,b)=>cls(a)-cls(b)||
  // NEAR_MATCH / MONITOR_ONLY: distance to the real thresholds first, then evidence quality, liquidity, activity
  ((cls(a)>0)?((a.nearMatch?.maxDistance??1)-(b.nearMatch?.maxDistance??1)||crossed(b)-crossed(a)||(b.liquidityUsd??0)-(a.liquidityUsd??0)||(b.trades24h??0)-(a.trades24h??0)):0)||
  tier(a)-tier(b)||Number(suspect(a))-Number(suspect(b))||qs(b)-qs(a)||(b.opportunity?.score??0)-(a.opportunity?.score??0)||
  (b.evidenceConfidence?.score??0)-(a.evidenceConfidence?.score??0)||(b.discoveryScore??-1)-(a.discoveryScore??-1)||a.key.localeCompare(b.key);
 const ordered=[...ok.values()];
 // Arc/Ethereum may use the remaining ranked slots for transparently labeled, source-observed
 // MONITOR_ONLY candidates. This changes presentation capacity only; no category, contract,
 // conflict, persistent-risk, pricing or verification gate is relaxed. Other networks retain
 // the conservative three-monitor ceiling.
 const monitorLimit=network==='arc'||network==='ethereum'?n:NM.MONITOR_MAX;
 // V5 combined selection (#279, `arcy-research-rank-1`). Three tiers compete for the same ten slots; no slot is reserved:
 //   EARLY        Filter A row (V3/V4 early discovery) whose pool is younger than 90 days or of unknown age
 //   GROWTH       Filter A row with a pool >= 90 days, or a measured-size established row that passed Filter B
 //   ESTABLISHED  A-class: listed exact contract with corroborated identity that passed Filter B
 // Order = cmp above (class, threshold distance, V4 evidence tier, Quality Ranking). The SCORE column (arcy-discovery-2) and
 // every gate are unchanged; a high rank never overrides a risk rule because rows that fail one never enter this pool.
 const fb={ran:false,considered:0,accepted:0,droppedByReason:{}};
 let bRows=[];
 if(filterB!==false){const x=QX.expand(rows,network,{aKeys:new Set(ok.keys()),held,now});bRows=x.rows;Object.assign(fb,{ran:x.ran,considered:x.considered,accepted:x.rows.length,droppedByReason:x.dropped});}
 const pool=[...ordered.map(r=>{const age=D.ageDays(r,now);return {...r,discoveryFilter:'A_EARLY_DISCOVERY',discoveryTier:age!==null&&age>=GROWTH_POOL_DAYS?'GROWTH':'EARLY',qualityRank:QR.compute(r,network,now)};}),...bRows]
  .sort(cmp).map((r,i)=>({...r,researchRank:{version:RESEARCH_RANK_VERSION,position:i+1,classOrder:cls(r),evidenceTier:tier(r),quality:r.qualityRank.score,
   basis:'CLASS_THEN_THRESHOLD_DISTANCE_THEN_V4_EVIDENCE_TIER_THEN_QUALITY'}}));
 const out=[];let monitors=0;
 for(const row of pool){
  if(out.length>=n){drop(row.discoveryFilter==='B_QUALITY_EXPANSION'?'B_RANKED_BELOW_TOP_10':'RANKED_BELOW_TOP_10');continue;}
  if(row.discoveryClass==='MONITOR_ONLY'){if(monitors>=monitorLimit){drop('MONITOR_ONLY_CAP');continue;}monitors++;}
  const b=row.discoveryFilter==='B_QUALITY_EXPANSION';
  const reviewed=b||row.eligibility!=='ELIGIBLE',missing=b?row.qualityRank.missing.slice(0,6):Array.isArray(row.evidenceConfidence?.missing)?row.evidenceConfidence.missing:[];
  out.push({...row,rank:out.length+1,displayTier:reviewed?'WATCHLIST_NOT_VERIFIED':'ELIGIBLE',selectionTier:b?5:tier(row),discoveryClass:row.discoveryClass||'QUALIFIED',
   displayReason:b?row.discoveryTier+' research candidate (quality expansion). NOT an early-stage discovery, NOT verified, not a forecast.':
    reviewed?'Research watchlist only; NOT VERIFIED. Missing: '+(missing.slice(0,3).join(', ')||'none')+'.':'Eligible under currently verified evidence; not a forecast.',
   selectionBasis:'ARCY_RESEARCH_RANK_1',missingProof:missing,watchOnly:reviewed,
   infoV4:researchInfo(row,network,now)});
 }
 out.shortfall=out.length<n?{shown:out.length,target:n,droppedByReason:dropped,eligibleRows:ok.size+bRows.length,filterB:fb}:null;
 out.byClass=out.reduce((m,r)=>{m[r.discoveryClass]=(m[r.discoveryClass]||0)+1;return m;},{});
 out.byFilter=out.reduce((m,r)=>{m[r.discoveryFilter]=(m[r.discoveryFilter]||0)+1;return m;},{});
 out.byTier=out.reduce((m,r)=>{m[r.discoveryTier]=(m[r.discoveryTier]||0)+1;return m;},{});
 out.filterB=fb;
 return out;
}
// Independent-source evidence of one candidate, from what V3 or the builder cross-check already recorded (no new request).
function sourceEvidenceOf(c){
 const F=['priceUsd','volume24hUsd','liquidityUsd'];
 if(c.fields&&typeof c.fields==='object'&&Object.keys(c.fields).length){
  const st=F.map(f=>c.fields[f]?.status||null);
  return {crossCheck:c.verification?.crossCheck||null,crossVerifiedFields:st.filter(x=>x==='CROSS_VERIFIED').length,of:F.length,
   sourcesDisagree:F.some(f=>c.fields[f]?.reasonCode==='SOURCES_DISAGREE'),basis:'V3_FIELD_EVIDENCE'};
 }
 const v=c.v3?.verification;
 if(v)return {crossCheck:v.crossCheck||null,crossVerifiedFields:F.filter(f=>v.fields?.[f]==='CROSS_VERIFIED').length,of:F.length,sourcesDisagree:Boolean(v.sourcesDisagree),basis:'V3_OR_BUILDER_VERIFICATION'};
 return {crossCheck:null,crossVerifiedFields:0,of:F.length,sourcesDisagree:false,basis:'NONE'};
}
// ── RUN ──────────────────────────────────────────────────────────────────────────────────────────────────
async function run({sections,now=Date.now(),env=process.env,fetcher=global.fetch,rpc={},registryDoc=require('./project-registry.json'),exitAnalyzer=defaultExit,
 limits={},priorRiskLedger=null}={}){
 const t0=Date.now();
 const L={maxCandidatesPerNetwork:45,unregisteredOnchain:2,rpcPerNetwork:300,httpPerRun:150,concurrency:2,exit:true,pace:true,...limits};
 const reg=registry.load(registryDoc,now);
 const riskLedger=RISK_HOLDS.initial(priorRiskLedger);
 const log={cacheHits:0};
 const run={budget:{max:L.httpPerRun,used:0},calls:{}};
 const o={fetcher,now:()=>now,env,run};
 const rpcFor=n=>typeof rpc[n]==='function'?rpc[n]:null;
 const shared={ethUsd:null};
 // ETH/USD 30-day benchmark from the reviewed Ethereum USDC/WETH samples (only when they were read in this run).
 const benchmarkFor=n=>{if(n==='arc'||!shared.ethUsd||shared.ethUsd.size<20)return null;const k=[...shared.ethUsd.keys()].sort((a,b)=>a-b),last=k.at(-1),base=k.find(t=>t>=last-30*86400);
  const a=shared.ethUsd.get(base),b=shared.ethUsd.get(last);return a>0&&b>0?{id:'ETH_USD_REVIEWED_POOL',change30dPct:+((b/a-1)*100).toFixed(2)}:null;};
 const ctx={now,reg,o,log,env,fetcher,exitAnalyzer,limits:L,rpcFor,shared,benchmarkFor,riskLedger,
  rpcBudget:{arc:{max:L.rpcPerNetwork,used:0,pace:L.pace},ethereum:{max:L.rpcPerNetwork,used:0,pace:L.pace},robinhood:{max:L.rpcPerNetwork,used:0,pace:L.pace}},
  blockCache:{arc:new Map(),ethereum:new Map(),robinhood:new Map()}};
 const d=discover(sections,{maxPerNetwork:L.maxCandidatesPerNetwork,intake:L.intake});
 // Builder-side independent cross-check (out of request, one batched DEX Screener call per network, <=30 contracts):
 // contracts V3 dropped BEFORE its own cross-check stage (pool-level floors, shortlist/finalist capacity) get the same
 // field-by-field verification V3 applies to finalists, so NEAR_MATCH claims rest on two sources. No call when disabled.
 if(L.crossCheck!==false&&typeof L.crossCheckFetcher==='function'){
  const dex=require('../dexscreener'),verify=require('../verify'),{dexscreenerAllowed}=require('../sources');
  for(const network of ORDER){
   const pending=d.sections[network].candidates.filter(c=>c.v3&&['POOL_LEVEL_GATES','BELOW_SHORTLIST','BELOW_FINALISTS'].includes(c.v3.stage)).slice(0,30);
   if(!pending.length)continue;
   if(!dexscreenerAllowed(env)){for(const c of pending)c.v3.crossCheckSkipped='DEXSCREENER_NOT_APPROVED';continue;}
   try{
    ctx.crossChecks=(ctx.crossChecks||0)+1;
    const byToken=await dex.tokens(network==='pons'?'pons':network,pending.map(c=>c.address),{fetcher:L.crossCheckFetcher,now});
    for(const c of pending){
     const check=verify.summarize({...c,network},byToken.get(c.address));
     const v=verify.verifyRow({...c,network},check,{now});
     c.v3={...c.v3,stage:'BUILDER_CROSS_CHECKED',originalStage:c.v3.stage,verification:{crossCheck:v.crossCheck,
      fields:Object.fromEntries(['priceUsd','volume24hUsd','liquidityUsd','poolCreatedAt','change24hPct'].map(f=>[f,v.fields[f]?.status||null])),
      sourcesDisagree:['priceUsd','volume24hUsd','liquidityUsd'].some(f=>v.fields[f]?.reasonCode==='SOURCES_DISAGREE'),
      pairCount:check.state==='MATCHED'&&check.complete&&Number.isInteger(check.pairCount)?check.pairCount:null}};
     // Exact-contract artwork from the same DEX Screener response (base-token pairs of THIS contract only), when the candidate had none.
     if(!candidateArtwork(c)&&check.state==='MATCHED'&&check.logo){c.logo={url:check.logo,source:'DEX Screener'};ctx.artworkAdopted=(ctx.artworkAdopted||0)+1;}
    }
   }catch(e){for(const c of pending)c.v3.crossCheckSkipped=e.code||'CROSS_CHECK_UNAVAILABLE';}
  }
 }
 // V5 established / growth universe (#279): a SEPARATE bounded intake, builder only (needs an explicit universeFetcher).
 // Registry + explorer token index + one batched DEX Screener request per 30 contracts; never another chain, never by symbol.
 ctx.universe={};
 if(L.universe!==false&&typeof L.universeFetcher==='function'){
  const dex=require('../dexscreener'),{dexscreenerAllowed}=require('../sources');
  const ponsLaunches=new Set(((sections?.pons?.ok===true&&Array.isArray(sections.pons.tokens))?sections.pons.tokens:[])
   .filter(t=>t?.launch?.status==='ONCHAIN_VERIFIED'&&ADDRESS.test(t.address||'')).map(t=>t.address.toLowerCase()));
  for(const network of ['arc','ethereum','robinhood']){
   const sec=d.sections[network];
   if(sec.status!=='OBSERVED'&&sec.status!=='STALE_SOURCE'){ctx.universe[network]={network,skipped:sec.status};continue;}
   if(!dexscreenerAllowed(env)){ctx.universe[network]={network,skipped:'DEXSCREENER_NOT_APPROVED'};continue;}
   try{
    const {rows,report,enrich}=await U.discover({network,fetcher:L.universeFetcher,now,o:{...o,fetcher:L.universeFetcher},existing:new Set(sec.candidates.map(c=>c.address)),
     exclude:network==='robinhood'?ponsLaunches:new Set(),maxCandidates:L.universeMax||40,dexTokens:dex.tokens,dexTokenPairs:dex.tokenPairs});
    for(const c of sec.candidates)if(enrich?.has(c.address)&&!c.universe)c.universe=enrich.get(c.address);
    sec.universeRows=rows;sec.universeCount=rows.length;
    for(const r of rows){sec.candidates.push(r);sec.bySource[r.provenance[0]]=(sec.bySource[r.provenance[0]]||0)+1;}
    ctx.universe[network]=report;
   }catch(e){ctx.universe[network]={network,error:e.code||'UNIVERSE_UNAVAILABLE'};}
  }
 }
 const networks={};
 for(const network of ORDER){
  const sec=d.sections[network],cands=sec.candidates.slice(0,L.maxCandidatesPerNetwork+(sec.universeCount||0));
  const registered=cands.filter(c=>registry.lookup(reg,c.chainId,c.address));
  // On-chain budget goes to registered projects first, then to EARLY-STAGE unregistered contracts with a known pool,
  // prioritised by liquidity (exit depth), never by 24h volume.
  const unregistered=cands.filter(c=>!registry.lookup(reg,c.chainId,c.address));
  const early=unregistered.filter(c=>c.pool&&!c.universe&&CAT.isEarly(CAT.classify(c,network,now)))
   .sort((a,b)=>(b.liquidityUsd??-1)-(a.liquidityUsd??-1)||a.address.localeCompare(b.address));
  const onchainSet=new Set([...registered,...early.slice(0,L.unregisteredOnchain)].map(c=>c.address));
  const results=[];
  // bounded concurrency
  const queue=[...registered,...unregistered];let i=0;
  await Promise.all(Array.from({length:Math.max(1,Math.min(L.concurrency,queue.length))},async()=>{
   while(i<queue.length){const c=queue[i++];
    try{results.push(await investigate(c,{...ctx,network,allowOnchain:onchainSet.has(c.address)}));}
    catch(e){results.push({key:c.chainId+':'+c.address,network,address:c.address,symbol:c.symbol||null,eligibility:'REVIEW',reasons:['ENGINE_ERROR_'+(e.code||'UNKNOWN')],risk:[],evidenceConfidence:{score:0,verified:[],missing:REQUIRED},discoveryScore:c.discovery?.score??null,notes:[]});}
   }
  }));
  results.sort((a,b)=>(b.discoveryScore??-1)-(a.discoveryScore??-1)||a.key.localeCompare(b.key));
  const eligible=results.filter(r=>r.eligibility==='ELIGIBLE').slice(0,MAX_SELECTED);
  const review=results.filter(r=>r.eligibility==='REVIEW').map(r=>({...r,missingProof:r.evidenceConfidence.missing,
   nextAction:NEXT_ACTION[r.evidenceConfidence.missing[0]]||null}))
   .sort((a,b)=>b.evidenceConfidence.score-a.evidenceConfidence.score||(b.discoveryScore??-1)-(a.discoveryScore??-1)||a.key.localeCompare(b.key));
  const held=new Set(RISK_HOLDS.list(riskLedger).filter(x=>x.state==='HELD').map(x=>x.key));
  let foreignTickers=null;
  if(network==='robinhood'){foreignTickers=new Map();for(const t of Array.isArray(sections?.pons?.tokens)?sections.pons.tokens:[])if(t?.launch?.status==='ONCHAIN_VERIFIED'&&ADDRESS.test(t.address||'')){const k=String(t.symbol||'').trim().toLowerCase();if(k){if(!foreignTickers.has(k))foreignTickers.set(k,new Set());foreignTickers.get(k).add(t.address.toLowerCase());}}}
  const displayCandidates=selectDisplay(results,{network,held,now,filterB:L.filterB,foreignTickers});
  const reasonCounts={};for(const r of results)for(const x of r.reasons||[])reasonCounts[x]=(reasonCounts[x]||0)+1;
  networks[network]={source:{status:sec.status,asOf:sec.asOf,freshness:sec.freshness,duplicates:sec.duplicates||0,ponsRouted:sec.ponsRouted||0,invalid:sec.invalid||0},
   counts:{candidates:results.length,eligible:eligible.length,displayed:displayCandidates.length,
    watchOnly:displayCandidates.filter(r=>r.watchOnly).length,review:review.length,
    excluded:results.filter(r=>r.eligibility==='EXCLUDE').length,registered:registered.length,onchainInspected:onchainSet.size},
   historyCoverage:{RUNUP_CLEARED:results.filter(r=>r.runup?.history==='RUNUP_CLEARED').length,EXCLUDE_ALREADY_RAN_8X:results.filter(r=>r.runup?.history==='EXCLUDE_ALREADY_RAN_8X').length,
    RUNUP_NOT_VERIFIED:results.filter(r=>r.runup?.history==='RUNUP_NOT_VERIFIED').length,EXCLUDE_VERIFIED_24H_8X:results.filter(r=>r.runup?.recent24h?.status==='EXCLUDE_VERIFIED_24H_8X').length},
   display:{shown:displayCandidates.length,target:MAX_DISPLAY,shortfall:displayCandidates.shortfall||null,byClass:displayCandidates.byClass||{},byFilter:displayCandidates.byFilter||{},byTier:displayCandidates.byTier||{},filterB:displayCandidates.filterB||null},
   funnel:{v3:sec.v3||null,v4Candidates:results.length,duplicatesCollapsed:sec.duplicates||0,ponsRouted:sec.ponsRouted||0,
    classes:results.reduce((m,r)=>{const k=r.eligibility==='EXCLUDE'?'V4_EXCLUDED':(r.discoveryClass||'UNCLASSIFIED');m[k]=(m[k]||0)+1;return m;},{}),
    v4ExcludedBy:results.filter(r=>r.eligibility==='EXCLUDE').reduce((m,r)=>{const k=(r.reasons||[]).includes('NOT_EARLY_STAGE_CATEGORY')?'NOT_EARLY_STAGE_CATEGORY':(r.reasons||[]).includes('PERSISTENT_LOW_EXIT_LIQUIDITY')?'PERSISTENT_RISK_HOLD':'CRITICAL_RISK_OR_IDENTITY';m[k]=(m[k]||0)+1;return m;},{}),
    shownByClass:displayCandidates.byClass||{},shownByFilter:displayCandidates.byFilter||{},shownByTier:displayCandidates.byTier||{},filterB:displayCandidates.filterB||null,universe:ctx.universe[network]?{considered:ctx.universe[network].considered,accepted:ctx.universe[network].accepted,rejected:ctx.universe[network].rejected}:null},
   categories:results.reduce((m,r)=>{const k=r.category?.category||'UNKNOWN';m[k]=(m[k]||0)+1;return m;},{}),bySource:sec.bySource||{},
   universe:ctx.universe[network]||null,universeRows:sec.universeRows||[],
   reasonCounts,selected:eligible,displayCandidates,researchQueue:review.slice(0,10),excluded:results.filter(r=>r.eligibility==='EXCLUDE'),all:results};
 }
 const top10=watchCandidates(ORDER.flatMap(network=>networks[network].displayCandidates),{limit:MAX_DISPLAY});
 return {mode:'SHADOW_ONLY',opportunityVersion:OPPORTUNITY_VERSION,scoreVersion:'arcy-discovery-2',asOf:iso(now),
  top10,displayPolicy:'At most 10 observed non-excluded contracts; REVIEW remains WATCHLIST_NOT_VERIFIED. Never pad; 10 candidates are not 10 verified opportunities.',
  registry:{schema:reg.schema,version:reg.version,digest:reg.digest,approvedProjects:reg.projects.length,rejected:reg.rejected},
  notes:d.notes,networks,riskLedger:RISK_HOLDS.list(riskLedger),
  cost:{builderCrossChecks:ctx.crossChecks||0,artworkAdoptedFromCrossCheck:ctx.artworkAdopted||0,httpCalls:run.calls,httpUsed:run.budget.used,httpBudget:run.budget.max,rpc:Object.fromEntries(Object.entries(ctx.rpcBudget).map(([k,v])=>[k,v.used])),rpcBudgetPerNetwork:L.rpcPerNetwork,cacheHits:log.cacheHits,elapsedMs:Date.now()-t0},
  providers:F.snapshot(),
  policy:'Shadow only. Up to ten ranked watch candidates per network and globally; never padded. WATCHLIST_NOT_VERIFIED is NOT ELIGIBLE. Confirmed critical risks are excluded. ELIGIBLE requires official identity, product continuity, a dated official event, organic buyers, verified exit, sell/mint/admin proof and clean 7d+30d on-chain history.'};
}
function _clearCache(){cache.clear();}
function _setDossiers(doc){DOSSIERS=DOS.load(doc);}
module.exports={RESEARCH_RANK_VERSION,GROWTH_POOL_DAYS,researchInfo,run,discover,selectDisplay,quietOnly,classifyRisk,demandEvidence,confidence,infoText,watchCandidates,defaultExit,OPPORTUNITY_VERSION,NEXT_ACTION,REQUIRED,_clearCache,_setDossiers};
