'use strict';
// ARCY Radar V2 — four sections (Arc, Ethereum, Robinhood Chain, Pons Launch on Robinhood Chain) built ONLY from external,
// documented, rate-limited sources, cross-checked field by field. No indexer, no log scan, no historical sweep, no database:
// results live in a short in-memory cache and are recomputed from a handful of API calls.
const {NETWORKS,SOURCES,PONS,geckoAccess,publicationAllowed,dexscreenerAllowed,demoBudget}=require('./sources');
const D=require('./discovery'),gecko=require('./gecko'),dex=require('./dexscreener'),pons=require('./pons'),verify=require('./verify'),http=require('./http');
const cache=new Map(),inflight=new Map();
const STALE_MAX_MS=3*3600*1000;
const SELECTION={
 ranking:'ARCY Discovery Score ranking. Candidates: base tokens of the provider\'s highest-volume, trending (24h) and newest pools. Base/wrapped assets, stablecoins, impersonators and duplicate representations are removed by contract/identity rules; the rest are scored from verified volume, liquidity, pool age, trades, momentum and cross-source agreement against per-network floors. Not whole-chain: tokens outside those provider windows are not considered, and it is not a census.',
 pons:'Pons-launched tokens only: tokens from the provider\'s newest, trending and highest-volume pools on Robinhood Chain (up to 40 checked) that an official pons factory confirms as its launches, ranked by the ARCY Discovery Score with extra weight on fresh launches and real trades. V2 launches are also found from the factory\'s own TokenLaunched event. Tokens still on the bonding curve have no DEX pool, so no verified USD volume or liquidity exists; they are reported separately (coverage.bondingCurve) and never ranked. Not exhaustive.'
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
 const g={...row,scopeVolume:'POOL',scopeLiquidity:'POOL'};
 if(mt){
  if(!g.symbol&&mt.symbol){g.symbol=mt.symbol;g.name=mt.name||mt.symbol;}
  if(mt.priceUsd!==null)g.priceUsd=mt.priceUsd;
  // Token-level totals must be able to contain the pool they summarise. A total below the top pool's own figure (seen on Arc:
  // total_reserve_in_usd 4.04 for a pool holding $4.7M) is a provider unit/indexing error: that field falls back to the pool figure and says so.
  if(mt.volume24hUsd!==null&&(row.volume24hUsd===null||mt.volume24hUsd>=row.volume24hUsd*0.98)){g.volume24hUsd=mt.volume24hUsd;g.scopeVolume='TOKEN';}
  if(mt.liquidityUsd!==null&&(row.liquidityUsd===null||mt.liquidityUsd>=row.liquidityUsd*0.98)){g.liquidityUsd=mt.liquidityUsd;g.scopeLiquidity='TOKEN';}
  // the pool market cap is kept only when the token-level value is absent; FDV is never promoted to market cap
  g.fdvUsd=mt.fdvUsd??row.fdvUsd;g.marketCapUsd=mt.marketCapUsd??row.marketCapUsd;
  g.coinId=mt.coinId||row.coinId;
 }
 const url=(mt&&mt.logo)||row.logo;
 g.logoCandidate=url?{url,source:logoSource}:null;
 return g;
}
// ── V3 discovery ────────────────────────────────────────────────────────────────────────────────
// Candidates come from three independent GeckoTerminal views of one network — highest 24h volume, trending (24h), newest pools — merged
// per base-token contract. Identity rules remove base/wrapped/stable assets, impersonators and duplicates; only then is the ARCY
// Discovery Score computed from verified data. Large pools alone no longer define the list.
const CHANNELS=[['top',true],['trending',false],['new',false]];
async function gather(access,network,ctx,usage,disableCache){
 const by=new Map(),channelStatus={},channelCounts={top:0,trending:0,new:0};let inspected=0;
 for(const [kind,required] of CHANNELS){
  const pages=kind==='top'&&access.mode==='pro'?2:1;
  for(let p=1;p<=pages;p++){
   let body;
   try{body=await page(access,network,kind,p,ctx,usage,disableCache);}
   catch(e){if(required)throw e;channelStatus[kind]=e.code||'ERROR';break;}
   channelStatus[kind]='OK';
   const res=gecko.parse(body,network);inspected+=res.inspected;
   for(const row of res.rows){
    channelCounts[kind]++;
    const cur=by.get(row.address);
    if(!cur){by.set(row.address,{...row,channels:new Set([kind]),pools:new Set([row.pool])});continue;}
    cur.channels.add(kind);cur.pools.add(row.pool);
    if((row.volume24hUsd||0)>(cur.volume24hUsd||0)){const ch=cur.channels,po=cur.pools;Object.assign(cur,row,{channels:ch,pools:po});}
   }
   if(body.data.length<20)break;
  }
 }
 return {cands:[...by.values()],inspected,channelStatus,channelCounts};
}
// Pons membership with a short per-address cache (shared by the Robinhood and Pons sections, so each address is read once per TTL).
const memberCache=new Map();
const origClear=cache.clear.bind(cache);cache.clear=()=>{origClear();memberCache.clear();};
function checkOrder(cands){
 cands=cands.filter(c=>!c._preMember);
 const newest=[...cands].filter(c=>c.poolCreatedAt).sort((a,b)=>Date.parse(b.poolCreatedAt)-Date.parse(a.poolCreatedAt)).slice(0,PONS.maxChecked/2);
 const seen=new Set(newest.map(c=>c.address)),rest=[...cands].filter(c=>!seen.has(c.address)).sort((a,b)=>(b.volume24hUsd||0)-(a.volume24hUsd||0));
 return [...newest,...rest].slice(0,PONS.maxChecked).map(c=>c.address);
}
async function ponsLookup(cands,rpcUrl,ctx,usage,ttlMs,fresh){
 const t=ctx.now(),want=checkOrder(cands),need=want.filter(a=>{const h=memberCache.get(a);return fresh||!(h&&h.expires>t);});
 let block=null;
 if(need.length){
  const m=await pons.membershipMany(rpcUrl,need,ctx);
  usage.rpc+=m.requests;block=m.block;
  for(const a of need)memberCache.set(a,{info:m.members.get(a)||null,expires:t+ttlMs,block});
  if(memberCache.size>400)memberCache.delete(memberCache.keys().next().value);
 }
 const members=new Map();let checked=0;
 for(const a of want){const h=memberCache.get(a);if(!h)continue;checked++;if(h.info)members.set(a,h.info);block=block??h.block;}
 return {members,checked,block};
}
const brief=(r,reason,detail)=>({address:r.address,symbol:r.symbol,name:r.name,reason,detail,volume24hUsd:Number.isFinite(r.volume24hUsd)?r.volume24hUsd:null});
const valuesOf=v=>{const o={};for(const f of verify.FIELDS)o[f]=v.fields[f].status==='NOT_VERIFIED'?null:v.fields[f].value;return o;};
async function build(network,{env,fetcher,now,rpcUrl,disableCache}){
 const access=geckoAccess(env);
 if(access.mode==='off')throw http.fail(access.reason);
 const ctx={fetcher,now},usage=usageOf(),isPons=network==='pons',t0=now();
 const profile=D.PROFILES[network];
 let statsStatus='OK',ponsStatus=isPons?'OK':'NOT_USED';
 const fetchStats=async(net,addresses)=>{
  try{usage.geckoterminal++;return await gecko.fetchMulti(access,net,addresses,ctx);}
  catch(e){statsStatus=e.code||'ERROR';return new Map();}
 };
 const g=await gather(access,network,ctx,usage,disableCache);
 let cands=g.cands;
 if(!cands.length&&!isPons)throw http.fail('RADAR_NO_VERIFIED_TOKENS');
 const excluded=[],counts={};
 const drop=(r,reason,detail,list=true)=>{counts[reason]=(counts[reason]||0)+1;if(list)excluded.push(brief(r,reason,detail));};
 // Pons: genuinely new launches announced by the factory's own TokenLaunched event, even if no provider window lists them yet.
 let recent=null;
 if(isPons){
  try{recent=await pons.recentLaunches(rpcUrl,ctx);usage.rpc+=recent.requests;}
  catch(e){recent={launches:[],total:0,status:e.code||'ERROR',requests:0};}
  const have=new Set(cands.map(c=>c.address));
  const push=(l,pre)=>{if(have.has(l.token))return;have.add(l.token);
   cands.push({address:l.token,symbol:'',name:'',network,chainId:NETWORKS[network].chainId,pool:l.pool||null,dex:null,dexId:null,quote:null,logo:null,coinId:null,priceUsd:null,volume24hUsd:null,liquidityUsd:null,change24hPct:null,
    buys24h:null,sells24h:null,fdvUsd:null,marketCapUsd:null,poolCreatedAt:l.time,channels:new Set(['factory-event']),pools:new Set(l.pool?[l.pool]:[]),_eventOnly:true,_launchVersion:l.version,_preMember:pre||null});};
  const fresh=recent.launches.slice(-20);
  for(const l of fresh)push(l);
  // Graduated V2 launches (a real pool exists): the factory's own PoolGraduated event, then getLaunchedToken must still confirm phase 2. RPC-only.
  try{
   const gr=await pons.recentGraduations(rpcUrl,ctx);usage.rpc+=gr.requests;
   const list=gr.graduations.filter(g=>!have.has(g.token)).slice(0,30);
   recent.graduationEvents={status:gr.status,total:gr.total};
   if(list.length){
    const ph=await pons.graduatedV2(rpcUrl,list.map(g=>g.token),ctx);usage.rpc+=ph.requests;
    const grads=list.filter(g=>ph.members.get(g.token)?.phase===2).slice(0,20);
    if(grads.length)await pons.blockTimes(rpcUrl,grads,ctx,c=>{usage.rpc+=c;});
    for(const g of grads)push(g,ph.members.get(g.token));
    recent.graduatedFound=grads.length;recent.olderChecked=list.length;
   }
  }catch(e){recent.graduationScan=e.code||'ERROR';}
 }
 // Pons factory membership: mandatory for the Pons section; for Robinhood it only powers look-alike detection and degrades silently.
 let block=null,ponsChecked=0;
 if(isPons||network==='robinhood'){
  try{
   const m=await ponsLookup(cands,rpcUrl,ctx,usage,access.ttlMs,disableCache);
   block=m.block;ponsChecked=m.checked;ponsStatus='OK';
   for(const c of cands){const info=m.members.get(c.address)||c._preMember;if(info)c._pons=info;c._ponsChecked=true;}
  }catch(e){
   if(isPons)throw e;
   ponsStatus=e.code||'ERROR';
  }
 }
 let pool;const curveItems=[];
 if(isPons){
  pool=[];
  for(const c of cands){
   if(c.address==='0x0000000000000000000000000000000000000000'){drop(c,'NATIVE_PLACEHOLDER','Zero address.',false);continue;}
   if(!c._pons){drop(c,'NOT_FACTORY_LAUNCH','Not confirmed by an official pons factory (getLaunchedToken).',false);continue;}
   // V2 token still on its bonding curve and no provider pool: no verified USD price/volume/liquidity can exist yet. Reported separately, never ranked.
   if(c._pons.version==='v2'&&c._pons.phase===0&&c._eventOnly){curveItems.push({token:c.address,curve:c._pons.curve,launchedAt:c.poolCreatedAt||null,deployer:c._pons.deployer});drop(c,'BONDING_CURVE_NO_POOL','V2 launch still on its bonding curve; no DEX pool yet.',false);continue;}
   pool.push(c);
  }
 }else{
  const ref=D.referencePrices(network,cands);pool=[];
  for(const c of cands){
   const k=D.classify(c,network,ref);
   if(k){drop(c,k.reason,k.detail);continue;}
   // A ticker that belongs to a factory-confirmed pons launch, held by a contract the factory does NOT confirm, is a look-alike.
   if(network==='robinhood'&&c._ponsChecked&&!c._pons&&cands.some(o=>o._pons&&o.symbol.toLowerCase()===c.symbol.toLowerCase())){drop(c,'UNVERIFIED_LOOKALIKE','Same ticker as an official pons launch ('+cands.find(o=>o._pons&&o.symbol.toLowerCase()===c.symbol.toLowerCase()).address+') but not confirmed by a pons factory.');continue;}
   c.kind=D.isTokenizedEquity(c)?'TOKENIZED_EQUITY':'TOKEN';
   pool.push(c);
  }
 }
 let curveInfo=null;
 if(isPons&&curveItems.length){
  try{const st=await pons.curveStates(rpcUrl,curveItems.slice(0,20),ctx);usage.rpc+=Math.ceil(Math.min(20,curveItems.length)/10);curveInfo={status:'OK',count:curveItems.length,items:curveItems.slice(0,20).map(it=>({token:it.token,launchedAt:it.launchedAt,...(st.get(it.token)||{status:'NOT_READABLE'})}))};}
  catch(e){curveInfo={status:e.code||'ERROR',count:curveItems.length,items:[]};}
 }
 // 1st pass: provider pool-level numbers. Cheap gates + provisional score pick who is worth a token-level lookup (<=30 per call).
 const t=now();
 const pre=[];
 for(const c of pool){
  const base={...c,scopeVolume:'POOL',poolVolume24hUsd:c.volume24hUsd,crossShare:null};
  const why=c._eventOnly?[]:D.gates(base,profile);
  if(why.length){drop(c,'INELIGIBLE',why.join(','),false);continue;}
  pre.push({c,s:c._eventOnly?101:D.score(base,network,t,{pons:isPons}).score});
 }
 pre.sort((a,b)=>b.s-a.s||(b.c.volume24hUsd||0)-(a.c.volume24hUsd||0)||a.c.address.localeCompare(b.c.address));
 let evSlots=0;const picked30=[],rest30=[];
 for(const x of pre){if(picked30.length<30&&(!x.c._eventOnly||evSlots++<20))picked30.push(x);else rest30.push(x);}
 const shortlist=picked30.map(x=>x.c);
 for(const x of rest30)drop(x.c,'BELOW_SHORTLIST','Ranked below the 30 candidates that fit one token-level lookup.',false);
 const multi=shortlist.length?await fetchStats(isPons?'pons':network,shortlist.map(c=>c.address)):new Map();
 // 2nd pass: token-level numbers, identity de-duplication, provisional ranking.
 let rows=shortlist.map(c=>{const m=merge(c,multi.get(c.address),'GeckoTerminal');m._pons=c._pons;m.kind=c.kind;m.channels=[...c.channels];m.poolCount=c.pools.size;m.poolVolume24hUsd=c.volume24hUsd;return m;});
 {const ok=[];for(const r of rows){if(Number.isFinite(r.volume24hUsd)&&Number.isFinite(r.liquidityUsd)&&Number.isFinite(r.priceUsd))ok.push(r);else drop(r,'INELIGIBLE','NO_TOKEN_LEVEL_DATA',false);}rows=ok;}
 for(const r of rows)r.discovery=D.score(r,network,t,{pons:isPons});
 const dd=D.dedupe(rows);rows=dd.kept;for(const x of dd.dropped)drop(x.row,x.reason,x.detail);
 rows.sort((a,b)=>b.discovery.score-a.discovery.score||(b.volume24hUsd||0)-(a.volume24hUsd||0)||a.address.localeCompare(b.address));
 const finalists=rows.slice(0,20);
 for(const x of rows.slice(20))drop(x,'BELOW_FINALISTS','Not among the 20 highest-scoring candidates sent to independent cross-check.',false);
 const check=await crossCheck(isPons?'pons':network,finalists,env,ctx,usage);
 for(const r of finalists){const ds=check.out.get(r.address);if(!r.logoCandidate&&ds?.logo)r.logoCandidate={url:ds.logo,source:'DEX Screener'};}
 pickLogos(finalists);
 // 3rd pass: score again from VERIFIED values only (a field the two providers contradict is null, not a favoured number).
 const verified=[];
 for(const r of finalists){
  const v=verify.verifyRow(r,check.out.get(r.address)),vals=valuesOf(v);
  const three=['priceUsd','volume24hUsd','liquidityUsd'].map(f=>v.fields[f].status).filter(x=>x!=='NOT_VERIFIED');
  const crossShare=v.crossCheck==='MATCHED'&&three.length?three.filter(x=>x==='CROSS_VERIFIED').length/three.length:null;
  // Pool age when the two providers contradict each other on the creation time: the OLDER date is used for freshness credit and the
  // established-token cap (a newness claim that is not corroborated earns no credit). It is never displayed as a verified value.
  let poolAgeBasis=v.fields.poolCreatedAt.status==='NOT_VERIFIED'?null:'VERIFIED';
  let ageIso=vals.poolCreatedAt;
  if(!ageIso&&v.fields.poolCreatedAt.status==='NOT_VERIFIED'&&v.fields.poolCreatedAt.sources.length>1){
   const ts=v.fields.poolCreatedAt.sources.map(x=>Date.parse(x.value)).filter(Number.isFinite);
   if(ts.length>1){ageIso=new Date(Math.min(...ts)).toISOString();poolAgeBasis='SOURCES_DISAGREE_OLDER_USED';}
  }
  const view={...r,...vals,poolCreatedAt:ageIso,poolAgeBasis,crossShare};
  const why=D.gates(view,profile);
  if(why.length){drop(r,'INELIGIBLE_AFTER_VERIFICATION',why.join(','));continue;}
  r.discovery=D.score(view,network,t,{pons:isPons});
  r.discovery.reason=D.reasonText(view,r.discovery,D.ageDays(view,t),r.kind);
  r._age=D.ageDays(view,t);r._ageBasis=poolAgeBasis;
  r._view=view;verified.push(r);
 }
 verified.sort((a,b)=>b.discovery.score-a.discovery.score||(b._view.volume24hUsd||0)-(a._view.volume24hUsd||0)||a.address.localeCompare(b.address));
 const dv=D.diversify(verified.map(r=>Object.assign(r,{ageIso:r._view.poolCreatedAt})),10,t);
 for(const x of dv.dropped)drop(x.row,x.reason,x.detail);
 const picked=dv.out;
 for(const r of verified)if(!picked.includes(r)&&!dv.dropped.some(x=>x.row===r))drop(r,'BELOW_TOP_10','Eligible and scored, but outside the top 10.',false);
 const tokens=picked.map((r,i)=>{
  const ex=r._pons?{launch:{status:'ONCHAIN_VERIFIED',factory:r._pons.factory,factoryVersion:r._pons.version||'v1',deployer:r._pons.deployer,...(r._pons.version==='v2'?{curve:r._pons.curve,phase:r._pons.phase}:{}),source:'pons factory getLaunchedToken(address)',block},
   graduation:r._pons.graduation?{status:'ONCHAIN_VERIFIED',...r._pons.graduation}:{status:'NOT_VERIFIED',reasonCode:'GRADUATION_NOT_READABLE'}}:{};
  const d=r.discovery;
  ex.discovery={score:d.score,version:d.version,reason:d.reason,components:d.components,missing:d.missing,penalties:d.penalties,flags:d.flags,weightCoverage:d.weightCoverage,
   channels:r.channels,kind:r.kind||'TOKEN',poolsSeen:r.poolCount,poolAgeDays:r._age===null?null:+r._age.toFixed(1),poolAgeBasis:r._ageBasis,poolAgeScope:'top pool by 24h volume',
   volumeScope:r.scopeVolume,liquidityScope:r.scopeLiquidity,volumeGrowth:{status:'NOT_AVAILABLE',reason:'no verified 24h-ago volume history is stored'}};
  const row=shapeRow(i+1,r,check.out.get(r.address),ex);
  return row;
 });
 const cnt=tokens.reduce((a,t)=>{a.cross+=t.verification.counts.CROSS_VERIFIED;a.single+=t.verification.counts.SOURCE_REPORTED;a.notVerified+=t.verification.counts.NOT_VERIFIED;return a;},{cross:0,single:0,notVerified:0});
 const asOf=new Date(now()).toISOString();
 const idEx=excluded.filter(x=>!/^(INELIGIBLE|INELIGIBLE_AFTER_VERIFICATION|BELOW_|DIVERSITY_|NOT_FACTORY)/.test(x.reason));
 const listed=[...excluded].sort((a,b)=>(b.volume24hUsd||0)-(a.volume24hUsd||0)).slice(0,40);
 return {
  ok:true,version:2,engine:'arcy-radar-v3',network,chainId:NETWORKS[network].chainId,asOf,freshness:'FRESH',
  selection:isPons?SELECTION.pons:SELECTION.ranking,
  discovery:{scoreVersion:D.SCORE_VERSION,weights:isPons?D.WEIGHTS_PONS:D.WEIGHTS,networkProfile:profile,
   caps:{establishedOlderThanDays:D.LEGACY_DAYS,establishedMax:D.CAPS.legacy,tokenizedEquityMax:D.CAPS.tokenizedEquity},
   channels:{counts:g.channelCounts,status:g.channelStatus},uniqueCandidates:cands.length,identityExcluded:idEx.length,excludedCounts:counts,
   poolWindow:'top pools by 24h volume (page 1'+(access.mode==='pro'?'–2':'')+'), trending pools (24h), newest pools (page 1) — not the whole chain'},
  excluded:listed,
  coverage:{poolsInspected:g.inspected,uniqueBaseTokens:cands.length,ranked:tokens.length,fieldsCrossVerified:cnt.cross,fieldsSourceReported:cnt.single,fieldsNotVerified:cnt.notVerified,
   logos:tokens.filter(t=>t.logo).length,tokenStats:statsStatus,crossCheckProvider:check.status,
   ...(isPons?{ponsChecked,ponsConfirmed:tokens.length,block,factoryEvents:recent?{status:recent.status,launchesInWindow:recent.total,windowBlocks:recent.windowBlocks||null,newest:recent.launches.length,graduatedFound:recent.graduatedFound??null,olderChecked:recent.olderChecked??null,graduationScan:recent.graduationScan||'OK',graduationEvents:recent.graduationEvents||null,windowsUsed:recent.windowsUsed||null,perFactory:recent.perFactory||null}:null,bondingCurve:curveInfo||{status:'NONE',count:0,items:[]}}:{ponsLookalikeCheck:ponsStatus}),elapsedMs:now()-t0},
  tokens,
  sources:sourcesUsed(access,usage,check.status==='OK'?'active':check.status==='DISABLED'?'disabled-until-approved':'unavailable',isPons||network==='robinhood'),
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
