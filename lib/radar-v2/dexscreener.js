'use strict';
// DEX Screener adapter: independent cross-check only (the API has no top-by-volume list). Exact chain slug + exact base-token match.
const {NETWORKS,SOURCES}=require('./sources');
const http=require('./http');
const {logoUrl}=require('./gecko');
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
  const quote=typeof p.quoteToken?.address==='string'?p.quoteToken.address.toLowerCase():'';
  const row={pair,token:base,side:'base',dexId:typeof p.dexId==='string'?p.dexId.slice(0,40):null,url:typeof p.url==='string'&&p.url.startsWith('https://dexscreener.com/')?p.url:null,
   priceUsd:nn(p.priceUsd),volume24hUsd:nn(p.volume?.h24),liquidityUsd:nn(p.liquidity?.usd),
   change24hPct:change!==null&&Math.abs(change)<1e9?change:null,fdvUsd:nn(p.fdv)||null,marketCapUsd:nn(p.marketCap)||null,
   pairCreatedAt:created!==null&&created>0?new Date(created).toISOString():null,logo:logoUrl(p.info?.imageUrl),
   // Additive (#279 V5): provider-declared base identity and activity windows of THIS pair. Never used for price/liquidity.
   quoteAddress:ADDR.test(quote)?quote:null,
   baseSymbol:typeof p.baseToken?.symbol==='string'?p.baseToken.symbol.slice(0,40):null,baseName:typeof p.baseToken?.name==='string'?p.baseToken.name.slice(0,80):null,
   volumeWindows:{h1:nn(p.volume?.h1),h6:nn(p.volume?.h6),h24:nn(p.volume?.h24)},
   // V6 (#279): creator-submitted profile links. Used ONLY to find a site to check for the exact contract; never identity by itself.
   links:{websites:(Array.isArray(p.info?.websites)?p.info.websites:[]).map(w=>typeof w?.url==='string'?w.url.slice(0,200):null).filter(u=>u&&/^https:\/\//.test(u)).slice(0,3),
    socials:(Array.isArray(p.info?.socials)?p.info.socials:[]).map(x=>({type:String(x?.type||'').slice(0,20),url:typeof x?.url==='string'?x.url.slice(0,200):null})).filter(x=>x.url&&/^https:\/\//.test(x.url)).slice(0,4)},
   txnWindows:Object.fromEntries(['h1','h6','h24'].map(w=>[w,{buys:nn(p.txns?.[w]?.buys),sells:nn(p.txns?.[w]?.sells)}]))};
  row.poolCreatedAt=row.pairCreatedAt;
  if(!byToken.has(base))byToken.set(base,[]);
  byToken.get(base).push(row);
  // The same pair also trades the quote token: it counts toward that token's volume/liquidity, never toward its price, cap or logo.
  if(ADDR.test(quote)&&quote!==base){if(!byToken.has(quote))byToken.set(quote,[]);byToken.get(quote).push({...row,token:quote,side:'quote',priceUsd:null,fdvUsd:null,marketCapUsd:null,change24hPct:null,logo:null,baseSymbol:null,baseName:null});}
 }
 return byToken;
}
async function tokens(network,addresses,{fetcher,now}){
 const list=[...new Set(addresses.filter(a=>ADDR.test(a)).map(a=>a.toLowerCase()))].slice(0,SOURCES.dexscreener.batch);
 if(!list.length)return new Map();
 const url=SOURCES.dexscreener.host+'/tokens/v1/'+NETWORKS[network].dex+'/'+list.join(',');
 return parse(await http.request('dexscreener',url,{fetcher,now}),network);
}
// V5 (#279): every pool of ONE token (documented /token-pairs/v1/{chainId}/{tokenAddress}). The batched /tokens endpoint returns a
// limited pair set per call, which under-counts the liquidity and volume of large tokens with many pools. Builder use only.
async function tokenPairs(network,address,{fetcher,now}){
 const a=String(address||'').toLowerCase();if(!ADDR.test(a))return new Map();
 return parse(await http.request('dexscreener',SOURCES.dexscreener.host+'/token-pairs/v1/'+NETWORKS[network].dex+'/'+a,{fetcher,now}),network);
}
module.exports={parse,tokens,tokenPairs};
