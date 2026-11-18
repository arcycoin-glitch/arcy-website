'use strict';
// Radar V4 — snapshot contract between the out-of-request opportunity engine and the public Radar response (issue #279).
//
//   DISCOVERY → RESEARCH → VERIFICATION → RANKING  (scripts/radar-v4-snapshot.cjs, scheduled GitHub Actions job, bounded)
//   → SNAPSHOT  (validated JSON committed to the data-only branch `radar-v4-snapshots`; Vercel deployments disabled there)
//   → PUBLIC RADAR (this module: one cached, size/time-bounded read; release gate RADAR_V4_OPPORTUNITY_ENABLED=true; OFF by default)
//
// The public response keeps its exact DTO shape (tokens ≤10, rank, address, symbol, name, fields, discovery-2 block), so the
// existing UI, columns, SCORE and ⓘ Info render unchanged. Only the ORDER/MEMBERSHIP of `tokens` and the Info sentence come
// from the V4 engine, plus an additive `opportunity` block. If the snapshot is missing, invalid or older than 24 h the legacy
// list is served untouched and `opportunity.status` says why. Sections are independent: one stale chain never blocks another.
const D=require('./discovery'),{NETWORKS}=require('./sources');
const SCHEMA='arcy-radar-v4-snapshot/1',OPPORTUNITY_VERSION='arcy-opportunity-intel-4';
const HOST='raw.githubusercontent.com',REPO_PATH='/arcycoin-glitch/arcy-website/',FILE='/radar-v4/snapshot.json',DEFAULT_REF='radar-v4-snapshots';
const FRESH_MS=6*3600000,STALE_MS=24*3600000,CACHE_MS=10*60000,MAX_BYTES=600000,TIMEOUT_MS=1500;
const ADDRESS=/^0x[0-9a-f]{40}$/,TIERS=new Set(['ELIGIBLE','WATCHLIST_NOT_VERIFIED']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const enabled=env=>env?.RADAR_V4_OPPORTUNITY_ENABLED==='true';
function url(env=process.env){
 const ref=typeof env.RADAR_V4_SNAPSHOT_REF==='string'&&/^[a-z0-9][a-z0-9-]{0,39}$/.test(env.RADAR_V4_SNAPSHOT_REF)?env.RADAR_V4_SNAPSHOT_REF:DEFAULT_REF;
 return 'https://'+HOST+REPO_PATH+ref+FILE;
}
// ── build (engine → snapshot) ─────────────────────────────────────────────────────────────────────────
// Truthful field provenance (#279 hardening). A row that the live Radar returned only in its excluded/diversity list carries
// provider-reported numbers WITHOUT per-field source attribution, so they are published as SOURCE_REPORTED with
// sourceConfirmed:false and the exact route they came through — never with an invented provider name or a verified status.
const fieldOf=(v,ctx)=>finite(v)?{status:'SOURCE_REPORTED',value:v,sourceConfirmed:false,sources:[],
  provenance:{via:ctx.via,chainId:ctx.chainId,address:ctx.address,pool:ctx.pool||null,measuredAt:ctx.measuredAt,
   note:'Value returned by the ARCY Radar candidate window for this exact contract; the original provider is not identified per field.'}}
 :{status:'NOT_VERIFIED',value:null,reasonCode:'NOT_IN_SOURCE_ROW'};
function publicRow(rank,r,raw,network,now){
 const ranked=raw.provenance?.includes('RADAR_RANKED')&&raw.discovery?.version==='arcy-discovery-2'&&finite(raw.discovery?.score);
 let disc;
 if(ranked)disc={...raw.discovery,legacyReason:raw.discovery.reason||null,basis:'RADAR_RANKED'};
 else{
  // Same arcy-discovery-2 formula on the provider-reported values the Radar already returned for this exact contract.
  const view={...raw,scopeVolume:'POOL',crossShare:null};
  const sc=finite(raw.volume24hUsd)&&finite(raw.liquidityUsd)?D.score(view,network,now,{pons:network==='pons'}):null;
  disc=sc?{score:sc.score,version:sc.version,components:sc.components,missing:sc.missing,penalties:sc.penalties,flags:sc.flags,weightCoverage:sc.weightCoverage,
   legacyReason:null,basis:'ARCY_DISCOVERY_2_ON_SOURCE_REPORTED_ROW'}:{score:null,version:'arcy-discovery-2',weightCoverage:null,legacyReason:null,basis:'NOT_SCORED'};
 }
 disc.reason=r.infoV4;
 // Rows the live Radar shaped itself (ranked list, Arc watchlist) already carry per-field provider evidence: keep it verbatim.
 const shaped=raw.fields&&typeof raw.fields==='object'&&Object.keys(raw.fields).length>0;
 const fctx={via:(raw.provenance||[])[0]||'UNKNOWN',chainId:NETWORKS[network].chainId,address:r.address,pool:raw.pool,measuredAt:raw.radarAsOf||null};
 const fields=shaped?raw.fields:{priceUsd:fieldOf(raw.priceUsd,fctx),volume24hUsd:fieldOf(raw.volume24hUsd,fctx),
  liquidityUsd:fieldOf(raw.liquidityUsd,fctx),change24hPct:fieldOf(raw.change24hPct,fctx)};
 const o=r.opportunity||{};
 return {rank,network,chainId:NETWORKS[network].chainId,address:r.address,symbol:String(raw.symbol||r.symbol||''),name:String(raw.name||r.name||raw.symbol||''),
  logo:raw.logo||null,pool:raw.pool||null,dex:raw.dex||null,quote:raw.quote||null,dexUrl:raw.dexUrl||null,
  priceUsd:finite(raw.priceUsd)?raw.priceUsd:null,volume24hUsd:finite(raw.volume24hUsd)?raw.volume24hUsd:null,liquidityUsd:finite(raw.liquidityUsd)?raw.liquidityUsd:null,
  change24hPct:finite(raw.change24hPct)?raw.change24hPct:null,fdvUsd:finite(raw.fdvUsd)?raw.fdvUsd:null,marketCapUsd:finite(raw.marketCapUsd)?raw.marketCapUsd:null,
  measuredAt:raw.radarAsOf||null,fieldsProvenance:shaped?'ARCY_RADAR_FIELD_EVIDENCE':'SOURCE_REPORTED_UNCONFIRMED',
  poolCreatedAt:raw.poolCreatedAt||null,buys24h:finite(raw.buys24h)?raw.buys24h:null,sells24h:finite(raw.sells24h)?raw.sells24h:null,fields,
  ...(raw.launch?{launch:raw.launch}:{}),...(raw.graduation?{graduation:raw.graduation}:{}),...(raw.verification?{verification:raw.verification}:{}),
  discovery:disc,
  opportunity:{version:o.version||OPPORTUNITY_VERSION,score:o.score??null,coverage:o.coverage??null,dimensions:o.dimensions||null,flags:o.flags||[],
   divergence:o.divergence?{signal:o.divergence.signal,change7dPct:o.divergence.change7dPct??null,change30dPct:o.divergence.change30dPct??null,
    drawdownFromSustainedPeakPct:o.divergence.drawdownFromSustainedPeakPct??null,liquidityChangePct:o.divergence.liquidityChangePct??null,relative30dPct:o.divergence.relative30dPct??null,status:o.divergence.status}:null,
   developmentEvidence:o.developmentEvidence||null,category:r.category?.category||null,eligibility:r.eligibility,displayTier:r.displayTier,selectionTier:r.selectionTier,
   evidenceConfidence:r.evidenceConfidence?.score??null,missingProof:r.missingProof||[],runup:r.runup?.history||'RUNUP_NOT_VERIFIED',provenance:r.provenance||[],
   sources:(r.sources||[]).slice(0,6),dossier:r.dossier||null,decisionHash:r.decisionHash||null,notForecast:true}};
}
function build(engineResult,sections,{now=Date.now(),commit=null}={}){
 const out={schema:SCHEMA,opportunityVersion:OPPORTUNITY_VERSION,generatedAt:new Date(now).toISOString(),engineCommit:commit,registry:engineResult.registry?{version:engineResult.registry.version,approvedProjects:engineResult.registry.approvedProjects}:null,
  cost:engineResult.cost||null,sections:{}};
 const ponsAddresses=new Set((engineResult.networks?.pons?.all||[]).map(r=>r.address));
 for(const network of Object.keys(NETWORKS)){
  const n=engineResult.networks?.[network];
  if(!n||n.source?.status!=='OBSERVED'&&n.source?.status!=='STALE_SOURCE'){out.sections[network]={status:'NOT_BUILT',reason:n?.source?.status||'NO_ENGINE_RESULT',asOf:null,rows:[]};continue;}
  const raws=new Map();
  const s=sections?.[network]||{};
  for(const t of [...(s.tokens||[]),...(s.watchlist||[]),...(s.excluded||[]),...(s.categories?.newPools?.items||[])])if(ADDRESS.test(String(t?.address||'').toLowerCase())&&!raws.has(t.address.toLowerCase()))raws.set(t.address.toLowerCase(),t);
  const rows=[];
  for(const r of n.displayCandidates||[]){
   if(network==='robinhood'&&ponsAddresses.has(r.address))continue; // #286: Pons launches never appear in general Robinhood
   const raw={...(raws.get(r.address)||{}),provenance:r.provenance,radarAsOf:s.asOf||null};
   rows.push(publicRow(rows.length+1,r,raw,network,now));
  }
  out.sections[network]={status:n.source.status==='OBSERVED'?'BUILT':'BUILT_FROM_STALE_SOURCE',asOf:new Date(now).toISOString(),sourceRadarAsOf:n.source.asOf,rows,
   counts:n.counts,display:n.display,categories:n.categories,bySource:n.bySource,historyCoverage:n.historyCoverage,
   legacyTop:(s.tokens||[]).map(t=>String(t.address).toLowerCase()).slice(0,10),
   // Presentation context the existing UI reads, copied from the same live Radar section (attribution duties preserved).
   presentation:{attribution:Array.isArray(s.attribution)?s.attribution.slice(0,4):[],sources:Array.isArray(s.sources)?s.sources.slice(0,4):[],
    statusLegend:s.statusLegend||null,categories:s.categories||null,watchlist:network==='arc'&&Array.isArray(s.watchlist)?s.watchlist.slice(0,5):[],
    uniqueCandidates:Number.isInteger(s.discovery?.uniqueCandidates)?s.discovery.uniqueCandidates:null}};
 }
 return out;
}
// ── validation (both before publishing and before serving) ───────────────────────────────────────────
function validSection(network,sec){
 if(!sec||!Array.isArray(sec.rows)||sec.rows.length>10)return false;
 if(sec.status==='NOT_BUILT')return sec.rows.length===0;
 if(!Number.isFinite(Date.parse(sec.asOf)))return false;
 const seen=new Set();
 return sec.rows.every((x,i)=>x&&x.rank===i+1&&x.network===network&&x.chainId===NETWORKS[network].chainId&&ADDRESS.test(x.address)&&!seen.has(x.address)&&seen.add(x.address)&&
  typeof x.symbol==='string'&&typeof x.name==='string'&&x.fields&&typeof x.fields==='object'&&x.discovery?.version==='arcy-discovery-2'&&typeof x.discovery.reason==='string'&&
  x.opportunity?.version===OPPORTUNITY_VERSION&&TIERS.has(x.opportunity.displayTier)&&(x.opportunity.displayTier==='ELIGIBLE')===(x.opportunity.eligibility==='ELIGIBLE')&&
  x.opportunity.eligibility!=='EXCLUDE'&&x.opportunity.category==='EARLY_STAGE_CANDIDATE'&&x.opportunity.notForecast===true&&
  !(network==='robinhood'&&x.launch?.status==='ONCHAIN_VERIFIED'));
}
function validate(snap){
 if(!snap||snap.schema!==SCHEMA||snap.opportunityVersion!==OPPORTUNITY_VERSION||!Number.isFinite(Date.parse(snap.generatedAt))||!snap.sections||typeof snap.sections!=='object')return {ok:false,reason:'SNAPSHOT_SCHEMA_INVALID'};
 const bad=Object.keys(NETWORKS).filter(n=>snap.sections[n]!==undefined&&!validSection(n,snap.sections[n]));
 if(bad.length)return {ok:false,reason:'SNAPSHOT_SECTION_INVALID',sections:bad};
 // Cross-tab rule: an exact contract in Pons Launch must not also be listed in general Robinhood.
 const pons=new Set((snap.sections.pons?.rows||[]).map(x=>x.address));
 if((snap.sections.robinhood?.rows||[]).some(x=>pons.has(x.address)))return {ok:false,reason:'PONS_ROBINHOOD_DUPLICATE'};
 return {ok:true};
}
// Per-section carry-forward: a section that failed this run keeps its previous valid rows, marked with their own old asOf.
function merge(previous,next){
 const ok=previous&&validate(previous).ok?previous:null,out={...next,sections:{}};
 for(const n of Object.keys(NETWORKS)){
  const s=next.sections[n];
  out.sections[n]=s&&s.status!=='NOT_BUILT'?s:ok?.sections?.[n]&&ok.sections[n].status!=='NOT_BUILT'?{...ok.sections[n],carriedForward:true}:s||{status:'NOT_BUILT',reason:'NO_DATA',asOf:null,rows:[]};
 }
 return out;
}
// ── serve (public request path) ──────────────────────────────────────────────────────────────────────
const state={at:0,data:null,reason:null,inflight:null};
async function read({env=process.env,fetcher=global.fetch,now=Date.now()}={}){
 // 10 min positive cache; 60 s negative cache so a just-published first snapshot is picked up quickly.
 if(state.at&&now>=state.at&&now-state.at<(state.data?CACHE_MS:60000))return state.data?{snapshot:state.data,reason:state.reason}:{snapshot:null,reason:state.reason};
 if(state.inflight)return state.inflight;
 state.inflight=(async()=>{
  let snapshot=null,reason=null;
  try{
   const res=await fetcher(url(env),{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS)});
   if(!res.ok)reason='SNAPSHOT_HTTP_'+res.status;
   else{const text=await res.text();
    if(text.length>MAX_BYTES)reason='SNAPSHOT_TOO_LARGE';
    else{let parsed=null;try{parsed=JSON.parse(text);}catch{reason='SNAPSHOT_INVALID_JSON';}
     if(parsed){const v=validate(parsed);if(v.ok)snapshot=parsed;else reason=v.reason;}}}
  }catch(e){reason=e?.name==='TimeoutError'?'SNAPSHOT_TIMEOUT':'SNAPSHOT_UNREACHABLE';}
  // keep the last valid snapshot during an outage (its own section ages decide FRESH/STALE/expired)
  if(!snapshot&&state.data)snapshot=state.data;
  state.at=now;state.data=snapshot;state.reason=reason;
  return snapshot?{snapshot,reason}:{snapshot:null,reason};
 })();
 try{return await state.inflight;}finally{state.inflight=null;}
}
// Snapshot-first serving (#279 hardening). Called BEFORE the legacy provider-backed loader, after the handler's own
// publication / site-origin checks. A valid FRESH (<=6 h) or STALE-in-grace (<=24 h) section is served without any provider
// request; otherwise the caller falls back to the legacy Radar. Never fabricates rows.
async function serve(network,{env=process.env,fetcher=global.fetch,now=Date.now()}={}){
 if(!enabled(env))return {data:null,reason:'V4_DISABLED'};
 if(!Object.hasOwn(NETWORKS,network))return {data:null,reason:'INVALID_NETWORK'};
 const {snapshot,reason}=await read({env,fetcher,now});
 const sec=snapshot?.sections?.[network];
 if(!sec)return {data:null,reason:reason||'SNAPSHOT_SECTION_MISSING'};
 if(sec.status==='NOT_BUILT')return {data:null,reason:'SNAPSHOT_SECTION_NOT_BUILT'};
 const age=now-Date.parse(sec.asOf);
 if(!(age>=-300000)||age>STALE_MS)return {data:null,reason:'SNAPSHOT_SECTION_EXPIRED'};
 let rows=sec.rows;
 // Serving-path cross-tab guard: an exact contract listed in Pons Launch is never served in general Robinhood.
 if(network==='robinhood'){
  const pons=new Set((snapshot.sections.pons?.rows||[]).map(x=>x.address));
  rows=rows.filter(x=>!pons.has(x.address)&&x.launch?.status!=='ONCHAIN_VERIFIED').map((x,i)=>({...x,rank:i+1}));
 }
 const status=age<=FRESH_MS?'FRESH':'STALE',p=sec.presentation||{};
 const legacy=sec.legacyTop||[];
 return {data:{ok:true,version:2,engine:'arcy-radar-v3',network,chainId:NETWORKS[network].chainId,asOf:sec.asOf,freshness:status,
  ...(status==='STALE'?{staleReason:'V4_SNAPSHOT_OLDER_THAN_6H',staleAgeSeconds:Math.round(age/1000)}:{}),
  selection:'ARCY Opportunity Intelligence V4: research candidates ranked by verified project evidence, not 24h volume. WATCHLIST_NOT_VERIFIED rows are not verified opportunities. SCORE column remains arcy-discovery-2. Not a forecast.',
  discovery:{scoreVersion:'arcy-discovery-2',uniqueCandidates:p.uniqueCandidates??null},
  coverage:{ranked:rows.length},tokens:structuredClone(rows),categories:p.categories||null,
  ...(network==='arc'?{watchlist:structuredClone(p.watchlist||[])}:{}),
  sources:p.sources||[],attribution:p.attribution||[],statusLegend:p.statusLegend||null,
  opportunity:{version:OPPORTUNITY_VERSION,status,snapshotAsOf:sec.asOf,sourceRadarAsOf:sec.sourceRadarAsOf||null,generatedAt:snapshot.generatedAt,engineCommit:snapshot.engineCommit||null,
   servedList:'V4_OPPORTUNITY',shown:rows.length,target:10,shortfall:sec.display?.shortfall||null,counts:sec.counts||null,
   legacyRemoved:legacy.filter(a=>!rows.some(r=>r.address===a)).length,carriedForward:sec.carriedForward===true,snapshotReadReason:reason||null,
   policy:'Snapshot computed outside visitor requests; served without a live provider call. Up to ten rows, never padded.'}},reason:null};
}
// Legacy fallback marker: the legacy response is unchanged except for an additive explanation of why V4 was not served.
function markUnavailable(data,reason){
 if(data?.ok!==true)return data;
 return {...data,opportunity:{version:OPPORTUNITY_VERSION,status:'UNAVAILABLE',reason:reason||'UNKNOWN',servedList:'LEGACY_DISCOVERY_2'}};
}
// Back-compat for callers/tests of the earlier gate: prefer snapshot, else legacy marked.
async function apply(network,data,opts={}){
 if(!enabled(opts.env||process.env)||data?.ok!==true||data.network!==network)return data;
 const v=await serve(network,opts);
 return v.data||markUnavailable(data,v.reason);
}
function _reset(){state.at=0;state.data=null;state.reason=null;state.inflight=null;}
module.exports={build,validate,merge,read,apply,serve,markUnavailable,enabled,url,publicRow,_reset,SCHEMA,OPPORTUNITY_VERSION,FRESH_MS,STALE_MS,DEFAULT_REF};
