'use strict';
// Locally stored CC0 artwork mapped by EXACT network + contract.
// Token pictures are decorative and never establish issuer authenticity.
// Source: spothq/cryptocurrency-icons (CC0-1.0).
const LOCAL=Object.freeze({
 arc:Object.freeze({
  '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b':'/assets/hero-arcy.png',
  '0x3600000000000000000000000000000000000000':'/search/assets/token-icons/usdc.svg',
  '0x76a443768a5e3b8d1aed0105fc250877841deb40':'/search/assets/token-icons/link.svg'
 }),
 ethereum:Object.freeze({
  '0xc944e90c64b2c07662a292be6244bdf05cda44a7':'/search/assets/token-icons/grt.svg',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2':'/search/assets/token-icons/eth.svg',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9':'/search/assets/token-icons/aave.svg',
  '0x0d8775f648430679a709e98d2b0cb6250d2887ef':'/search/assets/token-icons/bat.svg',
  '0xd533a949740bb3306d119cc777fa900ba034cd52':'/search/assets/token-icons/crv.svg',
  '0xc00e94cb662c3520282e6f5717214004a7f26888':'/search/assets/token-icons/comp.svg',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':'/search/assets/token-icons/usdc.svg',
  '0xdac17f958d2ee523a2206206994597c13d831ec7':'/search/assets/token-icons/usdt.svg',
  '0x514910771af9ca656af840dff83e8264ecf986ca':'/search/assets/token-icons/link.svg',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984':'/search/assets/token-icons/uni.svg',
  '0x6b175474e89094c44da98b954eedeac495271d0f':'/search/assets/token-icons/dai.svg',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599':'/search/assets/token-icons/wbtc.svg',
  '0x45804880de22913dafe09f4980848ece6ecbaf78':'/search/assets/token-icons/paxg.svg'
 }),
 robinhood:Object.freeze({'0x492641f648a4986844848e0befe66d14817bce34':'/search/assets/token-icons/link.svg'})
});
function localLogo(network,address){
 if(typeof network!=='string'||typeof address!=='string'||!/^0x[0-9a-f]{40}$/i.test(address))return null;
 return LOCAL[network]?.[address.toLowerCase()]||null;
}
const {safeLogoUrl}=require('./token-image');
const {readJson}=require('./http');
const {chain}=require('./chains');
const CACHE=new Map(), PENDING=new Map();
const POSITIVE_TTL=15*60*1000, NEGATIVE_TTL=90*1000;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
function marketArtwork(pairs,network,addresses){
 const wanted=new Set(addresses),found=new Map();
 if(!Array.isArray(pairs))return found;
 // A DEX image is for the BASE token only. Quotes, other networks, and
 // same-symbol tokens must never inherit it.
 const sorted=pairs.slice(0,200).filter(p=>p&&p.chainId===network)
  .sort((a,b)=>(Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));
 for(const pair of sorted){
  const address=String(pair.baseToken?.address||'').toLowerCase();
  const logo=safeLogoUrl(pair.info?.imageUrl);
  if(wanted.has(address)&&logo&&!found.has(address))found.set(address,logo);
 }
 return found;
}
async function marketBatch(network,addresses,{fetchImpl=global.fetch,now=Date.now()}={}){
 const found=new Map();
 if(!['arc','ethereum','robinhood'].includes(network)||!addresses.length)return found;
 const outstanding=[];
 for(const address of addresses){
  const key=network+':'+address, cached=CACHE.get(key);
  if(cached&&cached.expires>now){if(cached.logo)found.set(address,cached.logo);}
  else outstanding.push(address);
 }
 if(!outstanding.length)return found;
 // Only one short request per discovery; Vercel's per-process memory cache
 // prevents repeated lookups for the same contract while typing.
 const key=network+':'+outstanding.slice().sort().join(',');
 let task=PENDING.get(key);
 if(!task){
  task=(async()=>{
   let resolved=new Map(),failed=false;
   try{
    const url='https://api.dexscreener.com/tokens/v1/'+network+'/'+outstanding.join(',');
    const response=await fetchImpl(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(2500)});
    if(!response?.ok)throw Error('token-art HTTP unavailable');
    const body=await readJson(response,2*1024*1024);
    resolved=marketArtwork(body,network,outstanding);
   }catch(_){failed=true;}
   const expires=Date.now()+(failed?30*1000:NEGATIVE_TTL);
   for(const address of outstanding){
    const logo=resolved.get(address)||null;
    CACHE.set(network+':'+address,{logo,expires:logo?Date.now()+POSITIVE_TTL:expires});
   }
   while(CACHE.size>1200)CACHE.delete(CACHE.keys().next().value);
   return resolved;
  })();
  PENDING.set(key,task);
  task.finally(()=>{if(PENDING.get(key)===task)PENDING.delete(key)}).catch(()=>{});
 }
 for(const [address,logo] of await task)found.set(address,logo);
 return found;
}
async function enhance(network,items,{fetchImpl=global.fetch,now=Date.now()}={}){
 if(!Array.isArray(items))return [];
 const scoped=items.slice(0,24);
 const cfg=chain(network);
 // Local first-party/CC0 art or the Robinhood stock registry always takes precedence.
 const needs=scoped.filter(item=>item&&item.network===network&&(item.chainId===undefined||item.chainId===cfg.chainId)&&
  ADDRESS.test(item.address||'')&&!localLogo(network,item.address)&&!safeLogoUrl(item.logoUrl)&&
  !(network==='robinhood'&&item.registryMatched===true));
 const addresses=[...new Set(needs.map(item=>item.address.toLowerCase()))];
 // Unit-test runs do not contact public services implicitly; mocks can be injected.
 const remote=(fetchImpl!==global.fetch||process.env.VERCEL==='1')?
  await marketBatch(network,addresses,{fetchImpl,now}):new Map();
 const decorated=scoped.map(item=>{
  const matched=item&&item.network===network&&(item.chainId===undefined||item.chainId===cfg.chainId)&&ADDRESS.test(item.address||'');
  const local=matched?localLogo(network,item.address):null;
  const registry=matched&&network==='robinhood'&&item.registryMatched===true&&
   item.source==='Robinhood official asset registry'?
    require('./robinhood-assets').registryLogo(item.logoUrl,item.address):null;
  const thirdParty=matched&&(network!=='robinhood'||item.registryMatched!==true);
  const indexed=thirdParty?safeLogoUrl(item.logoUrl):null;
  const provider=thirdParty?(indexed||remote.get(item.address.toLowerCase())):null;
  const logo=local||registry||provider||null;
  const logoSource=local?(local.endsWith('/hero-arcy.png')?'ARCY site-owned mascot':'CC0 cryptocurrency-icons; exact contract'):
   registry?'Robinhood official asset registry (chain 4663); artwork only':
   provider?'Source-indexed decorative token image; NOT issuer verification':null;
  return {...item,logoUrl:logo,logoSource};
 });
 // Optional art is bounded independently; slow thumbnails cannot hold data
 // for an unbounded period. Exact-contract local CC0 files need no hotlink.
 const deadline=Date.now()+1000;let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,decorated.length)},async()=>{
  for(;;){const i=cursor++;if(i>=decorated.length)return;const item=decorated[i];
   if(!item.logoUrl||item.logoUrl.startsWith('/'))continue;
   const remaining=deadline-Date.now();
   const valid=remaining>0?await require('./logo-validation').validate(item.logoUrl,{
    address:item.address,registry:item.logoSource?.startsWith('Robinhood official')===true,
    fetcher:fetchImpl,now,timeoutMs:remaining}):null;
   if(!valid){item.logoUrl=null;item.logoSource=null;}
  }
 }));
 return decorated;
}
module.exports={imageFromPairs:()=>null,contractLogo:async(network,address)=>localLogo(network,address),
 localLogo,marketArtwork,marketBatch,enhance};
