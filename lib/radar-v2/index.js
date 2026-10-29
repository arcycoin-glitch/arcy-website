'use strict';
// ARCY Radar V2 — four sections (Arc, Ethereum, Robinhood Chain, Pons Launch on Robinhood Chain) built ONLY from external,
// documented, rate-limited sources, cross-checked field by field. No indexer, no log scan, no historical sweep, no database:
// results live in a short in-memory cache and are recomputed from a handful of API calls.
const {NETWORKS,SOURCES,PONS,geckoAccess,publicationAllowed,dexscreenerAllowed,demoBudget}=require('./sources');
const gecko=require('./gecko'),dex=require('./dexscreener'),pons=require('./pons'),verify=require('./verify'),http=require('./http');
const cache=new Map(),inflight=new Map();
const STALE_MAX_MS=3*3600*1000;
const SELECTION={
 ranking:'Top observed base tokens ranked by their single highest-volume pool among the pools the provider returned (page 1). Not whole-chain, not all-pool token volume, not a census.',
 pons:'Pons-launched tokens only: base tokens from the provider\'s newest pools and highest-volume pools on Robinhood Chain that an official pons factory confirms as its launches, newest pool first. Tokens still on the bonding curve (no DEX pool yet) and pools outside those two provider windows are not covered; not exhaustive.'
};
const clone=x=>structuredClone(x);
function usageOf(){return {geckoterminal:0,dexscreener:0,rpc:0};}
async function crossCheck(network,tokens,env,ctx,usage){
 const out=new Map();
 if(!dexscreenerAllowed(env)){for(const t of tokens)out.set(t.address,{state:'DISABLED'});return {out,status:'DISABLED'};}
 try{
  usage.dexscreener++;
  const byToken=await dex.tokens(network,tokens.map(t=>t.address),ctx);
  for(const t of tokens)out.set(t.address,verify.matchPair(t,byToken.get(t.address)));
  return {out,status:'OK'};
 }catch(e){
  for(const t of tokens)out.set(t.address,{state:'UNAVAILABLE'});
  return {out,status:e.code||'ERROR'};
 }
}
function shapeRow(rank,gt,check,extra={}){
 const v=verify.verifyRow(gt,check);
 const val=f=>v.fields[f].status==='NOT_VERIFIED'?null:v.fields[f].value;
 return {
  rank,network:gt.network,chainId:gt.chainId,address:gt.address,symbol:gt.symbol,name:gt.name,
  pool:gt.pool,dex:gt.dex,quote:gt.quote,dexUrl:v.dexUrl,
  // flat numbers for the existing UI; NOT_VERIFIED fields are null, never zero
  priceUsd:val('priceUsd'),volume24hUsd:gt.volume24hUsd,liquidityUsd:val('liquidityUsd'),change24hPct:val('change24hPct'),
  fdvUsd:val('fdvUsd'),marketCapUsd:val('marketCapUsd'),poolCreatedAt:val('poolCreatedAt'),
  buys24h:gt.buys24h,sells24h:gt.sells24h,
  fields:v.fields,verification:{crossCheck:v.crossCheck,counts:v.counts},
  ...extra
 };
}
function sourcesUsed(access,usage,dexStatus,includeRpc){
 const list=[{id:'geckoterminal',label:SOURCES.geckoterminal.label,role:SOURCES.geckoterminal.role,mode:access.mode,calls:usage.geckoterminal,limit:access.perMinute?access.perMinute+' calls/min':null,monthly:access.monthlyCredits||null,attribution:SOURCES.geckoterminal.attribution,docs:SOURCES.geckoterminal.docs,terms:SOURCES.geckoterminal.terms,confirmed:access.confirmed===true}];
 list.push({id:'dexscreener',label:SOURCES.dexscreener.label,role:SOURCES.dexscreener.role,mode:dexStatus,calls:usage.dexscreener,limit:SOURCES.dexscreener.perMinute+' requests/min',attribution:SOURCES.dexscreener.attribution,docs:SOURCES.dexscreener.docs,terms:SOURCES.dexscreener.terms,confirmed:true});
 if(includeRpc)list.push({id:'pons',label:SOURCES.pons.label,role:SOURCES.pons.role,mode:'onchain-point-reads',calls:usage.rpc,limit:'≤2 batched requests per refresh',attribution:SOURCES.pons.attribution,docs:SOURCES.pons.docs,confirmed:true});
 return list;
}
async function build(network,{env,fetcher,now,rpcUrl}){
 const access=geckoAccess(env);
 if(access.mode==='off')throw http.fail(access.reason);
 const ctx={fetcher,now},usage=usageOf(),isPons=network==='pons';
 let rows,inspected=0,unique=0,extra={};
 if(!isPons){
  const pages=access.mode==='pro'?2:1,results=[];
  for(let p=1;p<=pages;p++){usage.geckoterminal++;const body=await gecko.fetchPage(access,network,'top',p,ctx);const parsed=gecko.parse(body,network);results.push(parsed);if(body.data.length<20)break;}
  const top=gecko.rankTop(results,10);
  inspected=top.inspected;unique=top.unique;rows=top.tokens;
  if(!rows.length)throw http.fail('RADAR_NO_VERIFIED_TOKENS');
 }else{
  const results=[];
  for(const kind of ['new','top']){usage.geckoterminal++;const body=await gecko.fetchPage(access,'pons',kind,1,ctx);results.push(gecko.parse(body,'pons'));}
  inspected=results.reduce((a,r)=>a+r.inspected,0);
  // Candidate budget stays at PONS.maxCandidates (public RPC batch size): half from the newest pools, the rest from the highest-volume pools.
  const pick=(res,n,out)=>{for(const row of res.rows){if(out.size>=n)break;if(row.poolCreatedAt&&!out.has(row.address))out.set(row.address,row);}};
  const seen=new Map();
  pick({rows:[...results[0].rows].sort((a,b)=>Date.parse(b.poolCreatedAt)-Date.parse(a.poolCreatedAt))},PONS.maxCandidates/2,seen);
  pick(results[1],PONS.maxCandidates,seen);
  const candidates=[...seen.values()];
  unique=candidates.length;
  usage.rpc++;
  const m=await pons.membership(rpcUrl,candidates.map(c=>c.address),ctx);
  if(m.members.size)usage.rpc++;
  rows=candidates.filter(c=>m.members.has(c.address)).sort((a,b)=>Date.parse(b.poolCreatedAt)-Date.parse(a.poolCreatedAt)).slice(0,10).map(c=>({...c,_pons:m.members.get(c.address)}));
  extra={ponsChecked:m.checked,ponsConfirmed:rows.length,block:m.block};
 }
 const check=await crossCheck(isPons?'pons':network,rows,env,ctx,usage);
 const tokens=rows.map((r,i)=>{
  const ex=r._pons?{launch:{status:'ONCHAIN_VERIFIED',factory:r._pons.factory,deployer:r._pons.deployer,source:'pons factory getLaunchedToken(address)',block:extra.block},
   graduation:r._pons.graduation?{status:'ONCHAIN_VERIFIED',...r._pons.graduation}:{status:'NOT_VERIFIED',reasonCode:'GRADUATION_NOT_READABLE'}}:{};
  return shapeRow(i+1,r,check.out.get(r.address),ex);
 });
 const counts=tokens.reduce((a,t)=>{a.cross+=t.verification.counts.CROSS_VERIFIED;a.single+=t.verification.counts.SOURCE_REPORTED;a.notVerified+=t.verification.counts.NOT_VERIFIED;return a;},{cross:0,single:0,notVerified:0});
 const asOf=new Date(now()).toISOString();
 return {
  ok:true,version:2,network,chainId:NETWORKS[network].chainId,asOf,freshness:'FRESH',
  selection:isPons?SELECTION.pons:SELECTION.ranking.replace('(page 1)',access.mode==='pro'?'(pages 1–2)':'(page 1)'),
  coverage:{poolsInspected:inspected,uniqueBaseTokens:unique,ranked:tokens.length,fieldsCrossVerified:counts.cross,fieldsSourceReported:counts.single,fieldsNotVerified:counts.notVerified,crossCheckProvider:check.status,...extra},
  tokens,
  sources:sourcesUsed(access,usage,check.status==='OK'?'active':check.status==='DISABLED'?'disabled-until-approved':'unavailable',isPons),
  usage,attribution:[SOURCES.geckoterminal.attribution,...(check.status==='OK'?[SOURCES.dexscreener.attribution]:[])],
  statusLegend:{CROSS_VERIFIED:'Two independent indexers agree on the same pool within tolerance.',SOURCE_REPORTED:'One provider reports it; not independently cross-checked.',NOT_VERIFIED:'Missing or contradicting; shown as N/A.',ONCHAIN_VERIFIED:'Read directly from the official pons factory contract.'}
 };
}
async function load(network,{env=process.env,fetcher=global.fetch,now=Date.now,rpcUrl='https://rpc.mainnet.chain.robinhood.com',disableCache=false}={}){
 if(!Object.hasOwn(NETWORKS,network))throw http.fail('RADAR_INVALID_NETWORK');
 const gate=publicationAllowed(env);
 if(!gate.ok)throw http.fail(gate.reason);
 const access=geckoAccess(env);
 if(access.mode==='off')throw http.fail('RADAR_SOURCE_KEY_REQUIRED');
 const key=network+'|'+access.mode,t=now(),hit=cache.get(key);
 if(!disableCache&&hit&&hit.expires>t)return clone(hit.data);
 if(!disableCache&&inflight.has(key))return clone(await inflight.get(key));
 const task=(async()=>{
  try{
   const data=await build(network,{env,fetcher,now,rpcUrl});
   if(!disableCache){cache.set(key,{data,expires:t+access.ttlMs,at:t});if(cache.size>8)cache.delete(cache.keys().next().value);}
   return data;
  }catch(e){
   // Bounded stale-if-error: an older SUCCESSFUL result, clearly labelled, protects the free-tier quota during provider trouble.
   const transient=['RADAR_PROVIDER_RATE_LIMITED','RADAR_PROVIDER_TIMEOUT','RADAR_PROVIDER_UNREACHABLE'].includes(e.code)||/^RADAR_PROVIDER_HTTP_5/.test(e.code||'');
   if(!disableCache&&hit&&transient&&t-hit.at<=STALE_MAX_MS)
    return {...clone(hit.data),freshness:'STALE',staleReason:e.code,staleAgeSeconds:Math.round((t-hit.at)/1000)};
   throw e;
  }
 })();
 if(disableCache)return task;
 inflight.set(key,task);
 try{return clone(await task);}finally{if(inflight.get(key)===task)inflight.delete(key);}
}
const _cache=cache;
module.exports={load,build,NETWORKS,SOURCES,demoBudget,_cache};
