'use strict';
// ARCY Market Radar: sampled top-pool, contract-keyed discovery.
// No public feed unless the operator confirms BOTH API display and JSON delivery rights.
const IDS=Object.freeze({arc:{id:'arc',chainId:5042},ethereum:{id:'eth',chainId:1},robinhood:{id:'robinhood',chainId:4663}});
const ADDR=/^0x[0-9a-f]{40}$/i;
const cache=new Map(),inflight=new Map(),TTL=10*60*1000;
const num=value=>{
 if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
const bounded=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,max):'';
function idAddress(id,network){
 const prefix=IDS[network].id+'_';
 if(typeof id!=='string'||!id.toLowerCase().startsWith(prefix))return null;
 const addr=id.slice(prefix.length).toLowerCase();
 return ADDR.test(addr)?addr:null;
}
function takePage(body,network){
 if(!body||!Array.isArray(body.data)||!Array.isArray(body.included)||body.data.length>100||body.included.length>500)
  throw Error('RADAR_INVALID_PROVIDER_RESPONSE');
 const tokens=new Map();
 for(const item of body.included){
  if(item?.type!=='token')continue;
  const address=idAddress(item.id,network);
  if(!address)continue;
  const stated=item?.attributes?.address;
  if(stated!==undefined&&stated!==null&&String(stated).toLowerCase()!==address)continue;
  const symbol=bounded(item?.attributes?.symbol,20);
  if(!symbol)continue;
  tokens.set(String(item.id).toLowerCase(),{address,symbol,name:bounded(item?.attributes?.name,70)||symbol});
 }
 const candidates=[];
 for(const pool of body.data){
  if(pool?.type!=='pool'||typeof pool.id!=='string'||!pool.id.toLowerCase().startsWith(IDS[network].id+'_'))continue;
  const volume=num(pool.attributes?.volume_usd?.h24);
  if(volume===null||volume<=0)continue;
  const base=pool.relationships?.base_token?.data;
  const address=idAddress(base?.id,network);
  if(!address||base?.type!=='token')continue;
  const token=tokens.get(String(base.id).toLowerCase());
  if(!token)continue;
  const price=num(pool.attributes?.base_token_price_usd);
  const liquidity=num(pool.attributes?.reserve_in_usd);
  const change=num(pool.attributes?.price_change_percentage?.h24);
  const poolAddress=pool.attributes?.address;
  if(typeof poolAddress!=='string'||!/^0x[0-9a-f]{40,64}$/i.test(poolAddress))continue;
  candidates.push({
   ...token,network,chainId:IDS[network].chainId,
   volume24hUsd:volume,
   priceUsd:price!==null&&price>=0?price:null,
   liquidityUsd:liquidity!==null&&liquidity>=0?liquidity:null,
   change24hPct:change!==null&&Math.abs(change)<1e9?change:null,
   pool:poolAddress.toLowerCase()
  });
 }
 return candidates;
}
function ranked(pages,network){
 const byAddress=new Map();
 let inspected=0;
 for(const body of pages){
  if(!Array.isArray(body?.data))throw Error('RADAR_INVALID_PROVIDER_RESPONSE');
  inspected+=body.data.length;
  for(const row of takePage(body,network)){
   const existing=byAddress.get(row.address);
   // One highest-volume pool per token: prevents double counting/truncated total estimates.
   if(!existing||row.volume24hUsd>existing.volume24hUsd)byAddress.set(row.address,row);
  }
 }
 const tokens=[...byAddress.values()].sort((a,b)=>b.volume24hUsd-a.volume24hUsd||a.address.localeCompare(b.address)).slice(0,10).map((row,i)=>({rank:i+1,...row}));
 return {tokens,poolsInspected:inspected,uniqueBaseTokens:byAddress.size};
}
async function fetchPage(network,page,apiKey,fetcher){
 const url='https://pro-api.coingecko.com/api/v3/onchain/networks/'+IDS[network].id+
 '/pools?sort=h24_volume_usd_desc&include=base_token,quote_token&page='+page;
 const res=await fetcher(url,{headers:{accept:'application/json','x-cg-pro-api-key':apiKey},signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!res.ok)throw Error('RADAR_PROVIDER_HTTP_'+res.status);
 const body=await res.json();
 return body;
}
async function load(network,{apiKey,fetcher=fetch,now=Date.now(),pageCount=2,disableCache=false}={}){
 if(!Object.hasOwn(IDS,network))throw Error('RADAR_INVALID_NETWORK');
 if(typeof apiKey!=='string'||!apiKey.trim())throw Error('RADAR_KEY_REQUIRED');
 if(!Number.isInteger(pageCount)||pageCount<1||pageCount>3)throw Error('RADAR_INVALID_PAGE_COUNT');
 const key=network;
 if(!disableCache&&cache.get(key)?.expires>now)return structuredClone(cache.get(key).data);
 if(!disableCache&&inflight.has(key))return structuredClone(await inflight.get(key));
 const task=(async()=>{
  const pages=[];
  for(let page=1;page<=pageCount;page++){
   const body=await fetchPage(network,page,apiKey,fetcher);
   pages.push(body);
   if(!Array.isArray(body.data)||body.data.length<20)break;
  }
  const result=ranked(pages,network);
  if(!result.tokens.length)throw Error('RADAR_NO_VERIFIED_TOKENS');
  const data={ok:true,network,chainId:IDS[network].chainId,asOf:new Date(now).toISOString(),source:'CoinGecko Onchain',
   sourceUrl:'https://www.geckoterminal.com/'+IDS[network].id+'/pools',
   selection:'Top observed base tokens ranked by their single highest-volume pool among provider-returned pools. Not whole-chain or all-pool token volume.',
   pagesInspected:pages.length,...result};
  if(!disableCache){
   cache.set(key,{data,expires:now+TTL});
   if(cache.size>3)cache.delete(cache.keys().next().value);
  }
  return data;
 })();
 if(disableCache)return task;
 inflight.set(key,task);
 try{return structuredClone(await task)}finally{if(inflight.get(key)===task)inflight.delete(key)}
}
module.exports={IDS,takePage,ranked,load};
