'use strict';
/**
 * Read-only, contract-scoped DEX Screener market observations.
 * Data is limited to compact source-reported fields, never a raw API proxy.
 * Source/terms: https://docs.dexscreener.com/api/api-terms-and-conditions
 * Market metrics are returned-pool subtotals, NOT complete network totals.
 */
const {readJson}=require('./http');
const {chain}=require('./chains');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const PAIR=/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const NETWORKS=Object.freeze({arc:'arc',ethereum:'ethereum',robinhood:'robinhood'});
const ORIGIN='https://api.dexscreener.com';
const TTL=60000;
const cache=new Map(),inflight=new Map();
function finite(value,{positive=false}={}){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))return null;
 const n=Number(value);
 return Number.isFinite(n)&&(positive?n>0:n>=0)&&n<=1e18?n:null;
}
const missing=(reason,code='DEXSCREENER_SOURCE_UNAVAILABLE')=>({
 value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reason,reasonCode:code,source:null,evidence:[]
});
function asField(value,network,address,selected,method,scope,kind){
 if(value===null||value===undefined)return missing('DEX Screener did not provide an exact-contract '+method+' observation.','DEXSCREENER_FIELD_UNAVAILABLE');
 const cfg=chain(network);
 const pairs=Array.isArray(selected)?selected:(selected?[selected]:[]);
 const out={value,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',source:'DEX Screener',
  network,chainId:cfg.chainId,
  evidence:[{network,chainId:cfg.chainId,address,provider:'DEX Screener',
   sourceUrl:pairs.length?'https://dexscreener.com/'+NETWORKS[network]+'/'+pairs[0].pair:null,
   pairs:pairs.map(p=>p.pair),method,scope,
   checkedAt:new Date().toISOString()}]};
 if(kind)out.kind=kind;
 return out;
}
function validPools(payload,network,address){
 if(!Object.hasOwn(NETWORKS,network)||!ADDRESS.test(address))throw Error('Invalid network and token contract');
 if(!Array.isArray(payload))throw Error('Invalid DEX Screener response');
 const expected=NETWORKS[network],seen=new Set(),out=[];
 for(const pair of payload.slice(0,60)){
  const p=typeof pair?.pairAddress==='string'?pair.pairAddress.toLowerCase():'';
  const base=typeof pair?.baseToken?.address==='string'?pair.baseToken.address.toLowerCase():'';
  const quote=typeof pair?.quoteToken?.address==='string'?pair.quoteToken.address.toLowerCase():'';
  if(pair?.chainId!==expected||!PAIR.test(p)||!ADDRESS.test(base)||!ADDRESS.test(quote)||
    base===quote||![base,quote].includes(address)||seen.has(p))continue;
  seen.add(p);out.push({pair:p,base,quote,dex:String(pair.dexId||'').slice(0,80),
   price:finite(pair.priceUsd,{positive:true}),
   liquidity:finite(pair.liquidity?.usd),
   volume24h:finite(pair.volume?.h24),
   change24h:typeof pair.priceChange?.h24==='number'&&Number.isFinite(pair.priceChange.h24)&&
    Math.abs(pair.priceChange.h24)<=1e7?pair.priceChange.h24:null,
   marketCap:finite(pair.marketCap,{positive:true}),
   fdv:finite(pair.fdv,{positive:true}),
   // These are first-party response values, not ARCY calculations.
  });
 }
 return out.slice(0,30);
}
function parseMarket(payload,network,address){
 const token=address.toLowerCase(),rows=validPools(payload,network,token);
 const candidates=rows.filter(p=>p.base===token&&p.price!==null).sort((a,b)=>(b.liquidity??0)-(a.liquidity??0));
 const best=candidates[0]||null;
 const withLiquidity=rows.filter(p=>p.liquidity!==null);
 const withVolume=rows.filter(p=>p.volume24h!==null);
 const liquidity=withLiquidity.length?withLiquidity.reduce((x,p)=>x+p.liquidity,0):null;
 const volume=withVolume.length?withVolume.reduce((x,p)=>x+p.volume24h,0):null;
 const pairsLabel=rows.length?(new Set(rows.map(p=>p.dex).filter(Boolean)).size+
  ' DEX · '+rows.length+' tracked pools'+(payload.length>=30?' (limited)':'')):null;
 const scope='Only API-returned matching '+network+' token pools (max 30); partial pools and pagination may omit other venues. This is NOT total market liquidity or total market volume.';
 const valuation=best?(best.marketCap!==null?asField(best.marketCap,network,token,best,'marketCap',scope,'MARKET_CAP'):
  best.fdv!==null?asField(best.fdv,network,token,best,'fdv',scope,'FDV'):
  missing('Neither a source-reported market cap nor FDV is present.','VALUATION_NOT_VERIFIED')):missing('Price-listed base-token pool unavailable.','VALUATION_NOT_VERIFIED');
 return {rows,fields:{
  liquidityUsd:asField(liquidity,network,token,withLiquidity,'sum(liquidity.usd)',scope),
  volume24h:asField(volume,network,token,withVolume,'sum(volume.h24)',scope),
  dexPairCount:asField(pairsLabel,network,token,rows,'unique DEX and pair count',scope),
  lpStatus:missing('Pool reserves do not verify LP ownership, withdrawal control, burn or locker status.','LP_STATUS_NOT_VERIFIED'),
  priceUsd:asField(best?.price,network,token,best,'baseToken priceUsd',scope),
  valuation,
  change24h:asField(best?.change24h,network,token,best,'baseToken priceChange.h24',scope)
 }};
}
function unavailable(reason='DEX Screener did not return exact-contract pool data.'){
 return {liquidityUsd:missing(reason),volume24h:missing(reason),
  dexPairCount:missing(reason),lpStatus:missing('No independently verified LP lock/custody evidence.','LP_STATUS_NOT_VERIFIED'),
  priceUsd:missing(reason),valuation:missing(reason),change24h:missing(reason)};
}
async function json(url,{fetcher=global.fetch,now=Date.now()}={}){
 const cached=cache.get(url);
 if(fetcher===global.fetch&&cached&&cached.expires>now)return structuredClone(cached.body);
 if(fetcher===global.fetch&&inflight.has(url))return structuredClone(await inflight.get(url));
 const request=(async()=>{
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(9000)});
  if(!response?.ok)throw Error('DEX Screener HTTP '+String(response?.status||'UNKNOWN'));
  const body=await readJson(response,2*1024*1024);
  if(fetcher===global.fetch){cache.set(url,{body,expires:Date.now()+TTL});if(cache.size>100)cache.delete(cache.keys().next().value)}
  return body;
 })();
 if(fetcher!==global.fetch)return request;
 inflight.set(url,request);
 try{return structuredClone(await request)}finally{if(inflight.get(url)===request)inflight.delete(url)}
}
async function inspect(network,address,{fetcher=global.fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof address!=='string'||!ADDRESS.test(address))
  throw Error('Invalid market network/contract');
 const token=address.toLowerCase();
 const url=ORIGIN+'/token-pairs/v1/'+NETWORKS[network]+'/'+token;
 try{
  const data=await json(url,{fetcher,now});
  return parseMarket(data,network,token).fields;
 }catch(error){
  return unavailable('DEX Screener exact-contract market provider unavailable ('+
   String(error?.message||'unknown').slice(0,70)+').');
 }
}
function parseSearch(payload,network,rawQuery){
 if(!Object.hasOwn(NETWORKS,network)||typeof rawQuery!=='string'||!Array.isArray(payload?.pairs))
  throw Error('Invalid DEX Screener search response');
 const needle=rawQuery.normalize('NFKC').toLocaleLowerCase('en-US');
 const items=[],seen=new Set();
 for(const pair of payload.pairs.slice(0,100)){
  if(pair?.chainId!==NETWORKS[network]||!PAIR.test(pair.pairAddress||''))continue;
  for(const entry of [pair.baseToken,pair.quoteToken]){
   const address=typeof entry?.address==='string'?entry.address.toLowerCase():'';
   const name=typeof entry?.name==='string'?entry.name.trim().slice(0,90):'';
   const symbol=typeof entry?.symbol==='string'?entry.symbol.trim().slice(0,30):'';
   if(!ADDRESS.test(address)||seen.has(address)||(!name&&!symbol)||
     !((name+' '+symbol).normalize('NFKC').toLocaleLowerCase('en-US').includes(needle)))continue;
   seen.add(address);
   items.push({address,network,chainId:chain(network).chainId,name:name||symbol,symbol,
    source:'DEX Screener pool index (unverified identity)',identityVerified:false,
    registryMatched:false,logoUrl:null});
   if(items.length===20)return items;
  }
 }
 return items;
}
async function discover(network,rawQuery,{fetcher=global.fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORKS,network)||typeof rawQuery!=='string'||rawQuery.length<2||rawQuery.length>48)
  throw Error('Invalid market discovery query');
 const url=ORIGIN+'/latest/dex/search?q='+encodeURIComponent(rawQuery.normalize('NFKC').trim());
 return parseSearch(await json(url,{fetcher,now}),network,rawQuery.trim());
}
module.exports={NETWORKS,finite,validPools,parseMarket,inspect,unavailable,parseSearch,discover};
