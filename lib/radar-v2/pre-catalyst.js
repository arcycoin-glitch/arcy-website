'use strict';
// Issue #275: non-public, deterministic eligibility layer. This module makes no
// network calls, changes no Discovery Score, and never turns absent proof into a pass.
const {NETWORKS,PONS}=require('./sources');
const {PROFILES,classify,unverifiedIssuerBrand}=require('./discovery');
const ADDRESS=/^0x[0-9a-f]{40}$/i,DAY=86400000,MAX_CANDLES=400;
const MIN_BUYERS=Object.freeze({arc:8,ethereum:15,robinhood:8,pons:8});
const https=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.');}catch{return false;}};
const ohlcvUrl=(url,c,pool)=>{try{
 const u=new URL(url),host=['api.coingecko.com','pro-api.coingecko.com','api.geckoterminal.com'].includes(u.hostname);
 return u.protocol==='https:'&&host&&!u.username&&!u.password&&
  u.pathname.includes('/networks/'+NETWORKS[c.network].gecko+'/pools/'+pool.toLowerCase()+'/ohlcv/');
}catch{return false;}};
const median=values=>{const a=[...values].sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const host=s=>{try{return new URL(s).hostname.toLowerCase();}catch{return null;}};
const fresh=(s,now,maxAge)=>Number.isFinite(Date.parse(s))&&Date.parse(s)<=now&&now-Date.parse(s)<=maxAge;
const sourceBound=(v,c,now,maxAge=90*DAY)=>v&&v.chainId===c.chainId&&same(v.address,c.address)&&https(v.sourceUrl)&&fresh(v.observedAt,now,maxAge);
const canonical=c=>classify(c,c.network)||null;

// Parse the documented six-column OHLCV payload without supplying the seventh
// (historical liquidity) proof. A separate, timestamp-bound witness is required
// before any candle can establish a runup or a clean history.
function parsePoolOhlcv(body,request){
 const c=request?.candidate,network=c?.network,pool=request?.pool;
 if(!c||!Object.hasOwn(NETWORKS,network)||c.chainId!==NETWORKS[network].chainId||
    !ADDRESS.test(pool||'')||!ADDRESS.test(c.address||'')||!ADDRESS.test(request.quoteAddress||'')||
    body?.data?.type!=='ohlcv_request_response'||!Array.isArray(body.data.attributes?.ohlcv_list)||
    body.data.attributes.ohlcv_list.length>MAX_CANDLES||
    !same(body.meta?.base?.address,c.address)||!same(body.meta?.quote?.address,request.quoteAddress))
  return {status:'RUNUP_NOT_VERIFIED',reason:'OHLCV_SCHEMA_OR_EXACT_CONTRACT_MISMATCH'};
 const candles=body.data.attributes.ohlcv_list;
 if(candles.some(x=>!Array.isArray(x)||x.length!==6))return {status:'RUNUP_NOT_VERIFIED',reason:'OHLCV_SCHEMA_OR_EXACT_CONTRACT_MISMATCH'};
 return {network,chainId:c.chainId,address:pool.toLowerCase(),tokenAddress:c.address.toLowerCase(),quoteAddress:request.quoteAddress.toLowerCase(),
  tokenSide:'base',source:'COINGECKO_POOL_OHLCV',planAuthorized:request.planAuthorized===true,
  sourceUrl:request.sourceUrl,asOf:request.asOf,candles,historicalLiquidity:request.historicalLiquidity||[]};
}

function normalizePool(pool,c,now){
 if(!pool||pool.network!==c.network||pool.chainId!==c.chainId||!ADDRESS.test(pool.address||'')||
    !same(pool.tokenAddress,c.address)||!ADDRESS.test(pool.quoteAddress||'')||same(pool.quoteAddress,c.address)||
    pool.tokenSide!=='base'||pool.source!=='COINGECKO_POOL_OHLCV'||pool.planAuthorized!==true||
    !ohlcvUrl(pool.sourceUrl,c,pool.address)||!fresh(pool.asOf,now,12*3600000)||!Array.isArray(pool.candles)||pool.candles.length>MAX_CANDLES)
  return {ok:false,reason:'POOL_HISTORY_IDENTITY_OR_SOURCE_NOT_VERIFIED'};
 const out=[],seen=new Set(),minLiquidity=PROFILES[c.network].minLiq,minVolume=Math.max(1000,PROFILES[c.network].minVol/20);
 const witnesses=new Map((Array.isArray(pool.historicalLiquidity)?pool.historicalLiquidity:[]).filter(w=>
  Number.isSafeInteger(w?.timestamp)&&w.status==='ONCHAIN_VERIFIED'&&w.method==='HISTORICAL_RESERVE_AT_BLOCK'&&
  Number.isSafeInteger(w.blockNumber)&&w.blockNumber>0&&w.chainId===c.chainId&&same(w.pool,pool.address)&&
  same(w.tokenAddress,c.address)&&https(w.sourceUrl)&&fresh(w.observedAt,now,90*DAY)&&
  Math.abs(Date.parse(w.sampleAt)-w.timestamp*1000)<=DAY&&
  typeof w.liquidityUsd==='number'&&Number.isFinite(w.liquidityUsd)).map(w=>[w.timestamp,w]));
 for(const x of pool.candles){
  if(!Array.isArray(x)||x.length!==6)continue;
  const [timestamp,open,high,low,close,volume]=x,liquidity=witnesses.get(timestamp)?.liquidityUsd;
  if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp*1000>now||seen.has(timestamp)||
     ![open,high,low,close,volume,liquidity].every(n=>typeof n==='number'&&Number.isFinite(n))||
     open<=0||close<=0||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close)||
     volume<minVolume||liquidity<minLiquidity)continue;
  seen.add(timestamp);out.push({at:timestamp*1000,close,volume,liquidity});
 }
 out.sort((a,b)=>a.at-b.at);
 return {ok:true,candles:out,sourceUrl:pool.sourceUrl,pool:pool.address,quoteAddress:pool.quoteAddress,asOf:pool.asOf,rejected:pool.candles.length-out.length};
}

function windowRunup(candles,start,now){
 const a=candles.filter(x=>x.at>=start&&x.at<=now);
 if(a.length<6)return {status:'RUNUP_NOT_VERIFIED',reason:'TOO_FEW_CREDIBLE_CANDLES',peakMultiple:null};
 let peak=0,baselineAt=null,peakAt=null;
 const sustained=Array.from({length:a.length-2},(_,i)=>median([a[i].close,a[i+1].close,a[i+2].close]));
 let low=Infinity,lowIndex=null;
 for(let j=3;j<sustained.length;j++){
  const i=j-3;
  if(sustained[i]<low){low=sustained[i];lowIndex=i;}
  const ratio=sustained[j]/low;
  if(ratio>peak){peak=ratio;baselineAt=a[lowIndex].at;peakAt=a[j].at;}
 }
 const covered=a[0].at<=start+2*DAY&&a.at(-1).at>=now-2*DAY&&
  a.every((x,i)=>i===0||x.at-a[i-1].at<=3*DAY);
 return {status:peak>=8?'EXCLUDE_ALREADY_RAN_8X':peak>=5?'RUNUP_REVIEW':covered?'RUNUP_CLEARED':'RUNUP_NOT_VERIFIED',
  reason:peak>=8?'SUSTAINED_CLOSES':peak>=5?'PRIOR_5X_TO_8X':covered?null:'INCOMPLETE_WINDOW',peakMultiple:+peak.toFixed(4),
  baselineAt:baselineAt&&new Date(baselineAt).toISOString(),peakAt:peakAt&&new Date(peakAt).toISOString(),
  firstAt:new Date(a[0].at).toISOString(),lastAt:new Date(a.at(-1).at).toISOString(),credibleCandles:a.length};
}

function inspectHistory(c,history,now){
 const age=Date.parse(c.poolCreatedAt||'');
 if(!Number.isFinite(age)||age>now)return {status:'RUNUP_NOT_VERIFIED',reason:'POOL_AGE_NOT_VERIFIED',pools:[]};
 if(now-age<DAY)return {status:'RUNUP_NOT_VERIFIED',reason:'POOL_UNDER_24H',pools:[]};
 if(!Array.isArray(history)||history.length===0)return {status:'RUNUP_NOT_VERIFIED',reason:'OHLCV_UNAVAILABLE_OR_UNLICENSED',pools:[]};
 if(history.length>2||Number(c.poolCount)>2)return {status:'RUNUP_NOT_VERIFIED',reason:'POOL_COVERAGE_EXCEEDS_TWO',pools:[]};
 const seen=new Set(),pools=[];let excluded=false,complete=true;
 for(const raw of history){
  const p=normalizePool(raw,c,now);
  if(!p.ok||seen.has(raw?.address?.toLowerCase())){complete=false;pools.push({pool:raw?.address||null,status:'RUNUP_NOT_VERIFIED',reason:p.reason||'DUPLICATE_POOL'});continue;}
  seen.add(raw.address.toLowerCase());
  const windows={day30:windowRunup(p.candles,Math.max(age,now-30*DAY),now),day7:windowRunup(p.candles,Math.max(age,now-7*DAY),now)};
  if(Object.values(windows).some(w=>w.status==='EXCLUDE_ALREADY_RAN_8X'))excluded=true;
  if(Object.values(windows).some(w=>w.status!=='RUNUP_CLEARED'))complete=false;
  pools.push({pool:p.pool,quoteAddress:p.quoteAddress,sourceUrl:p.sourceUrl,asOf:p.asOf,rejectedCandles:p.rejected,windows});
 }
 if(c.pool&&!seen.has(c.pool.toLowerCase()))complete=false;
 if(Number.isInteger(c.poolCount)&&c.poolCount>history.length)complete=false;
 return {status:excluded?'EXCLUDE_ALREADY_RAN_8X':complete?'RUNUP_CLEARED':'RUNUP_NOT_VERIFIED',
  reason:excluded?'SUSTAINED_VERIFIED_8X':complete?null:'PARTIAL_OR_NONCOMPARABLE_POOL_HISTORY',pools};
}

function evaluate(c,evidence={},now=Date.now()){
 if(!Number.isFinite(now)||!c||!Object.hasOwn(NETWORKS,c.network)||c.chainId!==NETWORKS[c.network].chainId||!ADDRESS.test(c.address||''))
  return {decision:'EXCLUDE',reasons:['INVALID_EXACT_CONTRACT'],runup:{status:'RUNUP_NOT_VERIFIED'},key:null};
 const key=c.chainId+':'+c.address.toLowerCase(),reasons=[],review=[];
 const exclude=x=>{if(!reasons.includes(x))reasons.push(x);},unverified=x=>{if(!review.includes(x))review.push(x);};
 if(canonical(c))exclude('CANONICAL_OR_STABLE_ASSET');
 if(unverifiedIssuerBrand(c))exclude('ISSUER_AFFILIATION_NOT_VERIFIED');
 if(c.radarFreshness!=='FRESH'||!fresh(c.radarAsOf,now,DAY))unverified('RADAR_SNAPSHOT_STALE_OR_UNVERIFIED');
 if(c.discovery?.version!=='arcy-discovery-2'||!Number.isFinite(c.discovery?.score))unverified('DISCOVERY_SCORE_NOT_VERIFIED');
 if(c.network==='pons'&&!(c.launch?.status==='ONCHAIN_VERIFIED'&&PONS.factories.includes(String(c.launch.factory||'').toLowerCase())&&
  /^0x[0-9a-f]+$/i.test(c.launch.block||'')))unverified('PONS_FACTORY_NOT_VERIFIED');
 const identity=evidence.identity;
 const officialHosts=Array.isArray(identity?.officialHosts)&&identity.officialHosts.length<=5?
  identity.officialHosts.filter(x=>typeof x==='string'&&/^[a-z0-9.-]+$/.test(x)).map(x=>x.toLowerCase()):[];
 const official=v=>officialHosts.includes(host(v?.sourceUrl));
 if(!(sourceBound(identity,c,now)&&identity.status==='OFFICIAL_TOKEN_MATCHED'&&identity.proofKind==='OFFICIAL_TOKEN_ADDRESS'&&
  identity.publisherVerified===true&&official(identity)))unverified('IDENTITY_NOT_VERIFIED');
 const runup=inspectHistory(c,evidence.history,now);
 if(runup.status==='EXCLUDE_ALREADY_RAN_8X')exclude('EXCLUDE_ALREADY_RAN_8X');
 else if(runup.status!=='RUNUP_CLEARED')unverified('RUNUP_NOT_VERIFIED');
 const product=evidence.product;
 if(sourceBound(product,c,now)&&official(product)&&product.status==='ABANDONED_VERIFIED')exclude('ABANDONED_PROJECT');
 else if(!(sourceBound(product,c,now)&&official(product)&&product.status==='VERIFIED_ACTIVE'&&product.publisherVerified===true&&
  Array.isArray(product.updates)&&new Set(product.updates.filter(x=>sourceBound(x,c,now)&&official(x)&&x.publisherVerified===true&&x.status==='VERIFIED_RELEASE').map(x=>x.sourceUrl)).size>=2))unverified('PRODUCT_CONTINUITY_NOT_VERIFIED');
 const event=evidence.catalyst;
 const confirmed=sourceBound(event,c,now,30*DAY)&&official(event)&&event.status==='CONFIRMED_PUBLIC_EVENT'&&event.publisherVerified===true&&
  ['PRODUCT_RELEASE','GOVERNANCE_VOTE','BETA','TESTNET','MAINNET'].includes(event.kind)&&
  typeof event.claim==='string'&&event.claim.trim().length>=20&&Number.isFinite(Date.parse(event.eventAt))&&Date.parse(event.eventAt)>now&&Date.parse(event.eventAt)<=now+90*DAY;
 if(!confirmed)unverified(event?.status==='RUMOR_UNVERIFIED'?'RUMOR_UNVERIFIED':'CATALYST_NOT_VERIFIED');
 const risk=evidence.risk||{},riskState=k=>sourceBound(risk[k],c,now,DAY)?risk[k].status:null;
 if(riskState('sell')==='SELL_DISABLED_VERIFIED')exclude('SELL_DISABLED');
 else if(riskState('sell')!=='SELL_ENABLED_VERIFIED')unverified('SELL_EXIT_NOT_VERIFIED');
 if(riskState('mint')==='UNLIMITED_MINT_VERIFIED')exclude('UNLIMITED_MINT');
 else if(riskState('mint')!=='MINT_BOUNDED_VERIFIED')unverified('MINT_NOT_VERIFIED');
 if(riskState('admin')==='DANGEROUS_PRIVILEGE_VERIFIED')exclude('DANGEROUS_ADMIN_PRIVILEGE');
 if(riskState('admin')!=='ADMIN_REVIEWED')unverified('ADMIN_NOT_VERIFIED');
 if(riskState('holders')==='CONCENTRATED_VERIFIED')unverified('HOLDER_CONCENTRATION_RISK');
 if(evidence.sourceConsistency==='CONTRADICTED')unverified('SOURCE_CONTRADICTION');
 const exit=evidence.exit;
 const minExit=c.network==='ethereum'?5000:1000;
 if(sourceBound(exit,c,now,DAY)&&exit.status==='EXIT_FAILED_VERIFIED')exclude('LOW_EXIT_LIQUIDITY');
 else if(!(sourceBound(exit,c,now,DAY)&&exit.status==='EXIT_SIMULATED'&&
  typeof exit.executableUsd==='number'&&Number.isFinite(exit.executableUsd)&&exit.executableUsd>=minExit&&
  typeof exit.poolLiquidityUsd==='number'&&Number.isFinite(exit.poolLiquidityUsd)&&exit.poolLiquidityUsd>=PROFILES[c.network].minLiq))unverified('EXIT_LIQUIDITY_NOT_VERIFIED');
 const demand=evidence.demand;
 if(!(sourceBound(demand,c,now,7*DAY)&&demand.status==='ONCHAIN_VERIFIED'&&
  Number.isSafeInteger(demand.distinctBuyers)&&demand.distinctBuyers>=MIN_BUYERS[c.network]&&
  demand.clusterReview==='REVIEWED_NO_CONCENTRATION'&&demand.washReview==='REVIEWED_NO_SELF_TRADE'))unverified('ORGANIC_BUYER_BREADTH_NOT_VERIFIED');
 const decision=reasons.length?'EXCLUDE':review.length?'REVIEW':'ELIGIBLE';
 return {key,network:c.network,chainId:c.chainId,address:c.address.toLowerCase(),decision,reasons:[...reasons,...review],runup,
  evidenceAsOf:new Date(now).toISOString(),scoreVersion:c.discovery?.version||null,
  discoveryScore:Number.isFinite(c.discovery?.score)?c.discovery.score:null,
  verifiedReason:decision==='ELIGIBLE'?'Official token affiliation, active releases, public dated event, reviewed demand and exit evidence; 8x history gate cleared.':null};
}

function shortlist(candidates,evidenceByKey={},now=Date.now(),network=null){
 const seen=new Set(),diagnostics=[];
 for(const c of Array.isArray(candidates)?candidates:[]){
  if(network&&c?.network!==network){diagnostics.push({key:null,decision:'EXCLUDE',reasons:['WRONG_NETWORK_SHORTLIST']});continue;}
  const key=Number(c?.chainId)+':'+String(c?.address||'').toLowerCase();
  if(seen.has(key)){diagnostics.push({key,decision:'EXCLUDE',reasons:['DUPLICATE_EXACT_CONTRACT']});continue;}
  seen.add(key);diagnostics.push(evaluate(c,evidenceByKey[key],now));
 }
 const picked=diagnostics.filter(x=>x.decision==='ELIGIBLE').sort((a,b)=>(b.discoveryScore??-1)-(a.discoveryScore??-1)||a.key.localeCompare(b.key)).slice(0,5);
 return {mode:'SHADOW_ONLY',network,asOf:new Date(now).toISOString(),eligible:picked,diagnostics,
  counts:{eligible:diagnostics.filter(x=>x.decision==='ELIGIBLE').length,review:diagnostics.filter(x=>x.decision==='REVIEW').length,excluded:diagnostics.filter(x=>x.decision==='EXCLUDE').length}};
}
module.exports={evaluate,inspectHistory,shortlist,parsePoolOhlcv,normalizePool,windowRunup};
