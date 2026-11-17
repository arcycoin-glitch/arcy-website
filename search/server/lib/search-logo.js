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
// Additional exact-contract explorer metadata fallback, strictly limited.
// Explorer search p50 ~2.7s and p95 ~6.4s in existing CI observations:
// a 1.4s logo-only timeout discarded viable responses. Four bounded calls
// may run concurrently without delaying the primary 350ms search response.
// A logo is display-only; metadata neither verifies the issuer nor the token.
const EXPLORER_CACHE=new Map(), EXPLORER_PENDING=new Map();
const POSITIVE_TTL=15*60*1000, NEGATIVE_TTL=90*1000;
const EXPLORER_MAX_PER_BATCH=4, EXPLORER_CONCURRENCY=4;
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
// Blockscout /api/v2/tokens/:address is an exact-contract record. Fetch only
// already validated addresses against the explorer origin fixed in chains.js.
// We deliberately DO NOT follow token metadata image URLs outside the current
// safeLogoUrl allowlist; third-party logos do not authenticate project identity.
async function explorerArtwork(network,addresses,{fetchImpl=global.fetch,now=Date.now()}={}){
 const found=new Map();
 if(!['arc','ethereum','robinhood'].includes(network)||!Array.isArray(addresses))return found;
 const wanted=[...new Set(addresses.map(a=>typeof a==='string'?a.toLowerCase():''))]
  .filter(a=>ADDRESS.test(a)).slice(0,EXPLORER_MAX_PER_BATCH);
 if(!wanted.length)return found;
 const base=new URL(chain(network).explorer);
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(EXPLORER_CONCURRENCY,wanted.length)},async()=>{
  for(;;){
   const i=cursor++;if(i>=wanted.length)return;
   const address=wanted[i],key=network+':'+address;
   const hit=fetchImpl===global.fetch?EXPLORER_CACHE.get(key):null;
   if(hit&&hit.until>now){if(hit.url)found.set(address,hit.url);continue;}
   let task=fetchImpl===global.fetch?EXPLORER_PENDING.get(key):null;
   if(!task){
    task=(async()=>{
     let url=null,failed=false;
     try{
      const endpoint=new URL('/api/v2/tokens/'+address,base);
      const r=await fetchImpl(endpoint.href,{headers:{accept:'application/json'},
       credentials:'omit',redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!r?.ok||r.redirected||r.url&&r.url!==endpoint.href)throw Error('Explorer token unavailable');
      const body=await readJson(r,96*1024);
      if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid explorer token');
      const rawAddress=body.address_hash||body.address?.hash||body.address;
      // Some Blockscout versions omit the address in the token-details body;
      // the request URL is already bound to this exact contract. If supplied,
      // however, its address MUST match.
      if(rawAddress!==undefined&&String(rawAddress).toLowerCase()!==address)throw Error('Wrong-contract token metadata');
      const kind=String(body.type||body.token_type||'ERC-20').toUpperCase();
      if(!['ERC-20','ERC-8056'].includes(kind))throw Error('Not a fungible token');
      url=safeLogoUrl(body.icon_url);
     }catch{failed=true;}
     const value={url,until:Date.now()+(url?POSITIVE_TTL:failed?30000:5*60*1000)};
     if(fetchImpl===global.fetch){
      EXPLORER_CACHE.set(key,value);
      while(EXPLORER_CACHE.size>1000)EXPLORER_CACHE.delete(EXPLORER_CACHE.keys().next().value);
     }
     return url;
    })();
    if(fetchImpl===global.fetch){
     EXPLORER_PENDING.set(key,task);
     task.finally(()=>{if(EXPLORER_PENDING.get(key)===task)EXPLORER_PENDING.delete(key)}).catch(()=>{});
    }
   }
   const url=await task;
   if(url)found.set(address,url);
  }
 }));
 return found;
}
async function enhance(network,items,{fetchImpl=global.fetch,now=Date.now(),
 enableExplorer=process.env.VERCEL==='1'}={}){
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
 // Query Blockscout only for contracts still missing DEX/indexed artwork.
 // No ticker-based joins, price-based logos, arbitrary hosts, extra Vercel
 // functions or uncapped explorer scans.
 const missing=addresses.filter(address=>!remote.has(address));
 const extra=enableExplorer&&missing.length?
  await explorerArtwork(network,missing,{fetchImpl,now}):new Map();
 const decorated=scoped.map(item=>{
  const matched=item&&item.network===network&&(item.chainId===undefined||item.chainId===cfg.chainId)&&ADDRESS.test(item.address||'');
  const local=matched?localLogo(network,item.address):null;
  const registry=matched&&network==='robinhood'&&item.registryMatched===true&&
   item.source==='Robinhood official asset registry'?
    require('./robinhood-assets').registryLogo(item.logoUrl,item.address):null;
  const thirdParty=matched&&(network!=='robinhood'||item.registryMatched!==true);
  const indexed=thirdParty?safeLogoUrl(item.logoUrl):null;
  const address=item?.address?.toLowerCase?.()||'';
  const fromExplorer=thirdParty&&!indexed&&!remote.has(address)&&extra.has(address);
  const provider=thirdParty?(indexed||remote.get(address)||extra.get(address)):null;
  const logo=local||registry||provider||null;
  const logoSource=local?(local.endsWith('/hero-arcy.png')?'ARCY site-owned mascot':'CC0 cryptocurrency-icons; exact contract'):
   registry?'Robinhood official asset registry (chain 4663); artwork only':
   fromExplorer?'Blockscout exact-contract metadata artwork; NOT issuer verification':
   provider?'Source-indexed decorative token image; NOT issuer verification':null;
  return {...item,logoUrl:logo,logoSource};
 });
 // Data Engine V2 identity rule: logo identity is chainId + normalized contract. A third-party image URL that this result set
 // assigns to MORE THAN ONE distinct contract (e.g. several "POLL" contracts on Ethereum) is a copy-cat signal: it is removed from
 // all of them. A wrong logo is worse than no logo; the UI falls back to the ticker letter. Local exact-contract art is exempt.
 const owners=new Map();
 for(const item of decorated){if(!item.logoUrl||item.logoUrl.startsWith('/')||!ADDRESS.test(item.address||''))continue;
  const k=item.logoUrl;if(!owners.has(k))owners.set(k,new Set());owners.get(k).add((item.chainId??cfg.chainId)+':'+item.address.toLowerCase());}
 for(const item of decorated)if(item.logoUrl&&!item.logoUrl.startsWith('/')&&owners.get(item.logoUrl)?.size>1){item.logoUrl=null;item.logoSource=null;item.logoWithheld='SHARED_BY_MULTIPLE_CONTRACTS';}
 // Optional art is bounded independently; slow thumbnails cannot hold data
 // for an unbounded period. Exact-contract local CC0 files need no hotlink.
 // In an 8-token deferred batch a ONE-second aggregate window with only
 // three concurrent validations could silently skip five eligible images.
 // Preserve the fast first Search response (separate 350ms cap) and permit
 // four concurrent bounded raster checks with 2.7s aggregate deadline here.
 const deadline=Date.now()+2700;let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,decorated.length)},async()=>{
  for(;;){const i=cursor++;if(i>=decorated.length)return;const item=decorated[i];
   if(!item.logoUrl||item.logoUrl.startsWith('/'))continue;
   const images=require('./logo-validation'),options={address:item.address,
    registry:item.logoSource?.startsWith('Robinhood official')===true,now};
   // A slow earlier thumbnail must not discard an already validated warm hit.
   // Expired/unknown images still require validation within the original budget.
   const warm=fetchImpl===global.fetch?images.cached(item.logoUrl,options):undefined;
   const remaining=deadline-Date.now();
   const valid=warm!==undefined?warm:remaining>0?await images.validate(item.logoUrl,{
    ...options,fetcher:fetchImpl,timeoutMs:Math.min(1500,remaining)}):null;
   if(!valid){item.logoUrl=null;item.logoSource=null;}
  }
 }));
 return decorated;
}
module.exports={imageFromPairs:()=>null,contractLogo:async(network,address)=>localLogo(network,address),
 localLogo,marketArtwork,marketBatch,explorerArtwork,enhance};
