'use strict';
// ARCY Radar V2 — four sections (Arc, Ethereum, Robinhood Chain, Pons Launch on Robinhood Chain) built ONLY from external,
// documented, rate-limited sources, cross-checked field by field. No indexer, no log scan, no historical sweep, no database:
// results live in a short in-memory cache and are recomputed from a handful of API calls.
const {NETWORKS,SOURCES,PONS,geckoAccess,publicationAllowed,dexscreenerAllowed,demoBudget}=require('./sources');
const gecko=require('./gecko'),dex=require('./dexscreener'),pons=require('./pons'),verify=require('./verify'),http=require('./http');
const cache=new Map(),inflight=new Map();
const STALE_MAX_MS=3*3600*1000;
const SELECTION={
 ranking:'Candidates are the base tokens of the provider\'s 20 highest-volume pools (page 1); the top 10 are ranked by each token\'s provider-stated 24h volume across ALL its indexed pools. Not whole-chain: tokens outside that pool window are not considered, and it is not a census.',
 pons:'Pons-launched tokens only: base tokens from the provider\'s newest pools and highest-volume pools on Robinhood Chain that an official pons factory confirms as its launches, newest pool first. Tokens still on the bonding curve (no DEX pool yet) and pools outside those two provider windows are not covered; not exhaustive.'
};
const clone=x=>structuredClone(x);
// CoinGecko attribution guide: key-authenticated CoinGecko API data -> "Powered by CoinGecko API" (coingecko.com/en/api);
// GeckoTerminal public API data -> "On-chain data provided by GeckoTerminal" (geckoterminal.com).
const geckoAttribution=access=>access.mode==='keyless'?{text:'On-chain data provided by GeckoTerminal',url:'https://www.geckoterminal.com/'}:{text:'Powered by CoinGecko API',url:'https://www.coingecko.com/en/api'};
function usageOf(){return {geckoterminal:0,dexscreener:0,rpc:0};}
async function crossCheck(network,tokens,env,ctx,usage){
 const out=new Map();
 if(!dexscreenerAllowed(env)){for(const t of tokens)out.set(t.address,{state:'DISABLED'});return {out,status:'DISABLED'};}
 try{
  usage.dexscreener++;
  const byToken=await dex.tokens(network,tokens.map(t=>t.address),ctx);
  for(const t of tokens)out.set(t.address,verify.summarize(t,byToken.get(t.address)));
  return {out,status:'OK'};
 }catch(e){
  for(const t of tokens)out.set(t.address,{state:'UNAVAILABLE'});
  return {out,status:e.code||'ERROR'};
 }
}
// A logo URL shared by several tokens in one section is a copy-cat signal: it stays only on the token CoinGecko itself curates (coin id).
function pickLogos(rows){
 const seen=new Map();
 for(const r of rows)if(r.logoCandidate){if(!seen.has(r.logoCandidate.url))seen.set(r.logoCandidate.url,[]);seen.get(r.logoCandidate.url).push(r);}
 for(const r of rows){
  const c=r.logoCandidate,group=c&&seen.get(c.url);
  r.logo=c&&(group.length===1||(Boolean(r.coinId)&&group.filter(x=>x.coinId).length===1))?c:null;
 }
}
function shapeRow(rank,gt,check,extra={}){
 const v=verify.verifyRow(gt,check);
 const val=f=>v.fields[f].status==='NOT_VERIFIED'?null:v.fields[f].value;
 return {
  rank,network:gt.network,chainId:gt.chainId,address:gt.address,symbol:gt.symbol,name:gt.name,
  logo:gt.logo||null,
  pool:gt.pool,dex:gt.dex,quote:gt.quote,dexUrl:v.dexUrl,
  // flat numbers for the UI; NOT_VERIFIED fields are null, never zero
  priceUsd:val('priceUsd'),volume24hUsd:val('volume24hUsd'),liquidityUsd:val('liquidityUsd'),change24hPct:val('change24hPct'),
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
// Provider pages are shared between sections (Pons reuses the Robinhood top-volume page) and cached for the tier TTL.
async function page(access,network,kind,p,ctx,usage,disableCache){
 const key='page|'+NETWORKS[network].gecko+'|'+kind+'|'+p+'|'+access.mode,t=ctx.now(),hit=cache.get(key);
 if(!disableCache&&hit&&hit.expires>t)return hit.data;
 usage.geckoterminal++;
 const body=await gecko.fetchPage(access,network,kind,p,ctx);
 if(!disableCache){cache.set(key,{data:body,expires:t+access.ttlMs,at:t});}
 return body;
}
// Merge token-level facts (tokens/multi) over the pool row. Without them the row keeps its pool-level numbers and says so (scope POOL).
function merge(row,mt,logoSource){
 const g={...row,scope:'POOL'};
 if(mt){
  if(mt.priceUsd!==null)g.priceUsd=mt.priceUsd;
  // volume and liquidity switch together so one row never mixes token-level and pool-level scopes
  if(mt.volume24hUsd!==null&&mt.liquidityUsd!==null){g.volume24hUsd=mt.volume24hUsd;g.liquidityUsd=mt.liquidityUsd;g.scope='TOKEN';}
  // the pool market cap is kept only when the token-level value is absent; FDV is never promoted to market cap
  g.fdvUsd=mt.fdvUsd??row.fdvUsd;g.marketCapUsd=mt.marketCapUsd??row.marketCapUsd;
  g.coinId=mt.coinId||row.coinId;
 }
 const url=(mt&&mt.logo)||row.logo;
 g.logoCandidate=url?{url,source:logoSource}:null;
 return g;
}
async function build(network,{env,fetcher,now,rpcUrl,disableCache}){
 const access=geckoAccess(env);
 if(access.mode==='off')throw http.fail(access.reason);
 const ctx={fetcher,now},usage=usageOf(),isPons=network==='pons';
 let rows,inspected=0,unique=0,extra={},statsStatus='OK',multi=new Map();
 const fetchStats=async(net,addresses)=>{
  try{usage.geckoterminal++;return await gecko.fetchMulti(access,net,addresses,ctx);}
  catch(e){statsStatus=e.code||'ERROR';return new Map();}
 };
 if(!isPons){
  const pages=access.mode==='pro'?2:1,results=[];
  for(let p=1;p<=pages;p++){const body=await page(access,network,'top',p,ctx,usage,disableCache);results.push(gecko.parse(body,network));if(body.data.length<20)break;}
  const cand=gecko.rankTop(results,20);
  inspected=cand.inspected;unique=cand.unique;
  if(!cand.tokens.length)throw http.fail('RADAR_NO_VERIFIED_TOKENS');
  multi=await fetchStats(network,cand.tokens.map(t=>t.address));
  rows=cand.tokens.map(t=>merge(t,multi.get(t.address),'GeckoTerminal'))
   .sort((a,b)=>(b.volume24hUsd||0)-(a.volume24hUsd||0)||a.address.localeCompare(b.address)).slice(0,10);
 }else{
  const results=[];
  for(const kind of ['new','top'])results.push(gecko.parse(await page(access,'pons',kind,1,ctx,usage,disableCache),'pons'));
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
  const confirmed=candidates.filter(c=>m.members.has(c.address));
  multi=confirmed.length?await fetchStats('pons',confirmed.map(c=>c.address)):new Map();
  rows=confirmed.map(c=>({...merge(c,multi.get(c.address),'GeckoTerminal'),_pons:m.members.get(c.address)}))
   .sort((a,b)=>Date.parse(b.poolCreatedAt)-Date.parse(a.poolCreatedAt)).slice(0,10);
  extra={ponsChecked:m.checked,ponsConfirmed:rows.length,block:m.block};
 }
 const check=await crossCheck(isPons?'pons':network,rows,env,ctx,usage);
 // logo: GeckoTerminal/CoinGecko token image by exact contract, else DEX Screener's image for the exact base-token contract
 for(const r of rows){const ds=check.out.get(r.address);if(!r.logoCandidate&&ds?.logo)r.logoCandidate={url:ds.logo,source:'DEX Screener'};}
 pickLogos(rows);
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
  coverage:{poolsInspected:inspected,uniqueBaseTokens:unique,ranked:tokens.length,fieldsCrossVerified:counts.cross,fieldsSourceReported:counts.single,fieldsNotVerified:counts.notVerified,
   logos:tokens.filter(t=>t.logo).length,tokenStats:statsStatus,crossCheckProvider:check.status,...extra},
  tokens,
  sources:sourcesUsed(access,usage,check.status==='OK'?'active':check.status==='DISABLED'?'disabled-until-approved':'unavailable',isPons),
  usage,attribution:[geckoAttribution(access),...(check.status==='OK'?[SOURCES.dexscreener.attribution]:[])],
  statusLegend:{CROSS_VERIFIED:'Two independent indexers agree within tolerance.',SOURCE_REPORTED:'One provider reports it; not independently cross-checked.',NOT_VERIFIED:'Missing or contradicting; shown as N/A.',ONCHAIN_VERIFIED:'Read directly from the official pons factory contract.'}
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
   const data=await build(network,{env,fetcher,now,rpcUrl,disableCache});
   if(!disableCache){cache.set(key,{data,expires:t+access.ttlMs,at:t});if(cache.size>40)cache.delete(cache.keys().next().value);}
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
