'use strict';
// Only artwork tied to the exact chain+contract may decorate token search results.
// Source image is NOT an issuer-verification signal.
const {chain}=require('./chains');
const {safeLogoUrl}=require('./token-image');
const {readJson}=require('./http');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const CACHE_MS=10*60*1000;
const cached=new Map(),pending=new Map();
function imageFromPairs(raw,network,address){
 const cfg=chain(network),pairs=Array.isArray(raw)?raw:[];
 const sorted=pairs.filter(p=>
  p?.chainId===cfg.dexScreenerChainId&&
  String(p.baseToken?.address||'').toLowerCase()===address &&
  String(p.baseToken?.address||'').match(/^0x[0-9a-f]{40}$/i)
 ).sort((a,b)=>(Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));
 for(const pair of sorted){
  const logo=safeLogoUrl(pair.info?.imageUrl);
  if(logo)return logo;
 }
 return null;
}
async function contractLogo(network,address,{fetcher=fetch,now=Date.now()}={}){
 if(typeof address!=='string'||!ADDRESS.test(address))return null;
 const cfg=chain(network),key=cfg.id+':'+address;
 const entry=cached.get(key);
 if(entry&&entry.at+ CACHE_MS>now)return entry.url;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  let logo=null;
  try{
   const url='https://api.dexscreener.com/token-pairs/v1/'+cfg.dexScreenerChainId+'/'+address;
   const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(4800)});
   if(response.ok){
    const data=await readJson(response,1024*1024);
    logo=imageFromPairs(data,network,address);
   }
  }catch{}
  cached.set(key,{at:now,url:logo});
  if(cached.size>200)cached.delete(cached.keys().next().value);
  return logo;
 })();
 pending.set(key,task);
 try{return await task}finally{if(pending.get(key)===task)pending.delete(key)}
}
async function enhance(network,items,{lookup=contractLogo,max=4}={}){
 if(!Array.isArray(items))return [];
 const safe=items.slice(0,12);
 const candidates=safe.filter(x=>!safeLogoUrl(x.logoUrl)&&x.network===network&&ADDRESS.test(x.address||'')).slice(0,max);
 const responses=await Promise.allSettled(candidates.map(async x=>({address:x.address,logo:await lookup(network,x.address)})));
 const map=new Map(responses.filter(x=>x.status==='fulfilled'&&safeLogoUrl(x.value.logo))
  .map(x=>[x.value.address,x.value.logo]));
 return safe.map(x=>map.has(x.address)?{...x,logoUrl:map.get(x.address),logoSource:'DexScreener exact-chain base-token pair'}:x);
}
module.exports={imageFromPairs,contractLogo,enhance};
