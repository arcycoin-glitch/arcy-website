'use strict';
// DEX Screener adapter: independent cross-check only (the API has no top-by-volume list). Exact chain slug + exact base-token match.
const {NETWORKS,SOURCES}=require('./sources');
const http=require('./http');
const ADDR=/^0x[0-9a-f]{40}$/i,POOL=/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v==='string'&&/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v.trim())){const n=Number(v);return Number.isFinite(n)?n:null;}return null;};
function parse(body,network){
 const slug=NETWORKS[network].dex;
 const list=Array.isArray(body)?body:Array.isArray(body?.pairs)?body.pairs:null;
 if(!list||list.length>300)throw http.fail('RADAR_INVALID_PROVIDER_RESPONSE',{provider:'dexscreener'});
 const byToken=new Map();
 for(const p of list){
  if(!p||p.chainId!==slug)continue;                                    // wrong/other chain: dropped
  const pair=typeof p.pairAddress==='string'?p.pairAddress.toLowerCase():'',base=typeof p.baseToken?.address==='string'?p.baseToken.address.toLowerCase():'';
  if(!POOL.test(pair)||!ADDR.test(base))continue;
  const nn=v=>{const n=num(v);return n!==null&&n>=0?n:null;};
  const change=num(p.priceChange?.h24),created=num(p.pairCreatedAt);
  const row={pair,token:base,dexId:typeof p.dexId==='string'?p.dexId.slice(0,40):null,url:typeof p.url==='string'&&p.url.startsWith('https://dexscreener.com/')?p.url:null,
   priceUsd:nn(p.priceUsd),volume24hUsd:nn(p.volume?.h24),liquidityUsd:nn(p.liquidity?.usd),
   change24hPct:change!==null&&Math.abs(change)<1e9?change:null,fdvUsd:nn(p.fdv),marketCapUsd:nn(p.marketCap),
   pairCreatedAt:created!==null&&created>0?new Date(created).toISOString():null};
  row.poolCreatedAt=row.pairCreatedAt;
  if(!byToken.has(base))byToken.set(base,[]);
  byToken.get(base).push(row);
 }
 return byToken;
}
async function tokens(network,addresses,{fetcher,now}){
 const list=[...new Set(addresses.filter(a=>ADDR.test(a)).map(a=>a.toLowerCase()))].slice(0,SOURCES.dexscreener.batch);
 if(!list.length)return new Map();
 const url=SOURCES.dexscreener.host+'/tokens/v1/'+NETWORKS[network].dex+'/'+list.join(',');
 return parse(await http.request('dexscreener',url,{fetcher,now}),network);
}
module.exports={parse,tokens};
