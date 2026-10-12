'use strict';
// Search-only public GeckoTerminal adapter. No CoinGecko or DEX Screener API
// requests are made here. Values remain source-reported and chain/address scoped.
const {readJson}=require('./http');
const {chain}=require('./chains');
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const NETWORK_IDS=Object.freeze({arc:'arc',ethereum:'eth',robinhood:'robinhood'});
const CACHE_MS=60000;
const cache=new Map(),pending=new Map();
const finite=v=>{
 if(typeof v!=='number'&&typeof v!=='string')return null;
 if(typeof v==='string'&&!v.trim())return null;
 const n=Number(v);return Number.isFinite(n)?n:null;
};
const nonnegative=v=>{const n=finite(v);return n!==null&&n>=0?n:null};
async function json(url,{fetcher=fetch,now=Date.now()}={}){
 const hit=cache.get(url);
 if(fetcher===fetch&&hit&&hit.expires>now)return structuredClone(hit.body);
 if(fetcher===fetch&&pending.has(url))return structuredClone(await pending.get(url));
 const task=(async()=>{
  const response=await fetcher(url,{headers:{accept:'application/json;version=20230203'},signal:AbortSignal.timeout(8500)});
  if(!response.ok)throw Error('GeckoTerminal HTTP '+response.status);
  const body=await readJson(response,2*1024*1024);
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Malformed GeckoTerminal JSON');
  if(fetcher===fetch){cache.set(url,{expires:Date.now()+CACHE_MS,body});if(cache.size>100)cache.delete(cache.keys().next().value)}
  return body;
 })();
 if(fetcher!==fetch)return task;
 pending.set(url,task);
 try{return structuredClone(await task)}finally{if(pending.get(url)===task)pending.delete(url)}
}
function relationAddress(value,network){
 if(typeof value!=='string')return null;
 const prefix=network+'_';
 if(!value.toLowerCase().startsWith(prefix))return null;
 const address=value.slice(prefix.length).toLowerCase();
 return ADDRESS.test(address)?address:null;
}
function normalizePools(body,network,address){
 if(!Array.isArray(body?.data))throw Error('Invalid GeckoTerminal pools response');
 const networkId=NETWORK_IDS[network],rows=[],seen=new Set();
 for(const item of body.data){
  const a=item?.attributes||{},rel=item?.relationships||{};
  const pool=String(a.address||'').toLowerCase();
  const base=relationAddress(rel.base_token?.data?.id,networkId);
  const quote=relationAddress(rel.quote_token?.data?.id,networkId);
  const poolId=String(item?.id||'').toLowerCase();
  if(item?.type!=='pool'||!/^0x[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(pool)||
    poolId!==networkId+'_'+pool||!base||!quote||![base,quote].includes(address)||seen.has(pool))continue;
  seen.add(pool);
  rows.push({pool,base,quote,dex:String(rel.dex?.data?.id||'').slice(0,100),attributes:a,
   url:'https://www.geckoterminal.com/'+networkId+'/pools/'+pool});
 }
 return rows;
}
function unknown(reason,code){return {value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',
 reason,reasonCode:code,source:null,evidence:[]};}
function asField(value,network,address,pools,method){
 if(value===null||value===undefined)return unknown('GeckoTerminal did not return this exact-token field.','GECKOTERMINAL_FIELD_UNAVAILABLE');
 const cfg=chain(network);
 return {value,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',network,chainId:cfg.chainId,
  source:'GeckoTerminal',evidence:[{provider:'GeckoTerminal',network,chainId:cfg.chainId,address,
   pools:pools.map(p=>p.pool),method,scope:'Only GeckoTerminal-returned pools matching this exact network and token contract; not a complete chain-wide market census.'}]};
}
function parseMarket(body,network,address){
 const rows=normalizePools(body,network,address);
 const completeSum=key=>rows.length&&rows.every(p=>nonnegative(p.attributes[key])!==null)?
  rows.reduce((sum,p)=>sum+nonnegative(p.attributes[key]),0):null;
 const liquidity=completeSum('reserve_in_usd');
 const volume=rows.length&&rows.every(p=>nonnegative(p.attributes.volume_usd?.h24)!==null)?
  rows.reduce((sum,p)=>sum+nonnegative(p.attributes.volume_usd.h24),0):null;
 const selected=rows.find(p=>nonnegative(p.attributes.reserve_in_usd)>0)||rows[0]||null;
 const baseSelected=selected&&selected.base===address;
 const price=selected?nonnegative(baseSelected?selected.attributes.base_token_price_usd:
  selected.attributes.quote_token_price_usd):null;
 const fdv=baseSelected?nonnegative(selected.attributes.fdv_usd):null;
 const change=baseSelected?finite(selected.attributes.price_change_percentage?.h24):null;
 const dexCount=rows.length&&rows.every(p=>p.dex)?new Set(rows.map(p=>p.dex)).size:null;
 const count=rows.length&&dexCount?dexCount+' DEX · '+rows.length+' pools':null;
 return {rows,fields:{
  liquidityUsd:asField(liquidity,network,address,rows,'sum(reserve_in_usd) over returned exact-token pools'),
  volume24h:asField(volume,network,address,rows,'sum(volume_usd.h24) over returned exact-token pools'),
  dexPairCount:asField(count,network,address,rows,'count of returned exact-token pools by DEX'),
  lpStatus:unknown('Pool liquidity does not establish LP ownership, lock, or withdrawal permissions.','LP_STATUS_NOT_VERIFIED'),
  priceUsd:asField(price,network,address,selected?[selected] : [],'base_token_price_usd or quote_token_price_usd for matched token'),
  valuation:fdv===null?unknown('Market cap is omitted; GeckoTerminal FDV was not available for a matched base-token pool.','VALUATION_NOT_VERIFIED'):
   {...asField(fdv,network,address,[selected],'GeckoTerminal fdv_usd for exact base token'),kind:'FDV'},
  change24h:asField(change,network,address,selected?[selected]:[],'price_change_percentage.h24 for exact base token')
 }};
}
async function inspect(network,address,{fetcher=fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORK_IDS,network)||!ADDRESS.test(address))throw Error('Invalid GeckoTerminal market identity');
 const id=NETWORK_IDS[network],normalized=address.toLowerCase();
 const url='https://api.geckoterminal.com/api/v2/networks/'+id+'/tokens/'+normalized+'/pools?page=1&include=base_token,quote_token,dex';
 return parseMarket(await json(url,{fetcher,now}),network,normalized);
}
function parseSearch(body,network,query){
 if(!Array.isArray(body?.data))throw Error('Invalid GeckoTerminal search response');
 const id=NETWORK_IDS[network],q=query.toLocaleLowerCase('en-US'),included=new Map();
 for(const item of Array.isArray(body.included)?body.included:[])included.set(item.id,item);
 const seen=new Set(),out=[];
 for(const pool of body.data.slice(0,200)){
  if(pool?.type!=='pool')continue;
  const rel=pool.relationships||{};
  for(const key of ['base_token','quote_token']){
   const tokenId=rel[key]?.data?.id;
   if(typeof tokenId!=='string'||!tokenId.toLowerCase().startsWith(id+'_'))continue;
   const token=included.get(tokenId),attrs=token?.attributes||{};
   const address=relationAddress(tokenId,id),name=String(attrs.name||'').slice(0,90),symbol=String(attrs.symbol||'').slice(0,30);
   if(!address||seen.has(address)||!name&&!symbol||
    !(name.toLocaleLowerCase('en-US').includes(q)||symbol.toLocaleLowerCase('en-US').includes(q)))continue;
   seen.add(address);
   out.push({name,symbol,address,chainId:chain(network).chainId,network,
    source:'GeckoTerminal',identityVerified:false,logoUrl:null});
  }
 }
 return out.slice(0,12);
}
async function discover(network,query,{fetcher=fetch,now=Date.now()}={}){
 if(!Object.hasOwn(NETWORK_IDS,network)||typeof query!=='string'||query.length<2||query.length>48)throw Error('Invalid GeckoTerminal search');
 const normalized=query.normalize('NFKC').trim().replace(/\s+/g,' ');
 const url='https://api.geckoterminal.com/api/v2/search/pools?query='+encodeURIComponent(normalized)+'&include=base_token,quote_token,dex';
 return parseSearch(await json(url,{fetcher,now}),network,normalized);
}
module.exports={NETWORK_IDS,json,normalizePools,parseMarket,parseSearch,inspect,discover};
