'use strict';
// GeckoTerminal / CoinGecko Onchain adapter. Strict, contract-keyed parsing: a row exists only if the pool id, the base-token id
// and the token's own stated address all agree with the requested network. Everything else is dropped, never repaired.
const {NETWORKS}=require('./sources');
const http=require('./http');
const ADDR=/^0x[0-9a-f]{40}$/i,POOL=/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const num=v=>{if(v===null||v===undefined||typeof v==='boolean'||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null;};
// Logos: only https images from the providers' own CDNs. Any other host, a "missing" placeholder or an odd URL is dropped, never replaced.
const IMG_HOSTS=new Set(['coin-images.coingecko.com','assets.coingecko.com','assets.geckoterminal.com','cdn.dexscreener.com','dd.dexscreener.com']);
function logoUrl(v){
 if(typeof v!=='string'||v.length>300||/[\s"'<>]/.test(v))return null;
 let u;try{u=new URL(v);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||!IMG_HOSTS.has(u.hostname)||/missing|placeholder/i.test(u.pathname))return null;
 return u.href;
}
const text=(v,max)=>typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,max):'';
function pathFor(network,kind,page){
 const id=NETWORKS[network].gecko;
 const inc='include=base_token,quote_token,dex';
 return kind==='new'?`/networks/${id}/new_pools?page=${page}&${inc}`:`/networks/${id}/pools?page=${page}&sort=h24_volume_usd_desc&${inc}`;
}
function parse(body,network){
 const geckoId=NETWORKS[network].gecko;
 if(!body||!Array.isArray(body.data)||body.data.length>100||(body.included!==undefined&&(!Array.isArray(body.included)||body.included.length>600)))throw http.fail('RADAR_INVALID_PROVIDER_RESPONSE',{provider:'geckoterminal'});
 const prefix=geckoId+'_',tokens=new Map(),dexes=new Map();
 for(const item of body.included||[]){
  if(item?.type==='dex'&&typeof item.id==='string'){dexes.set(item.id,text(item.attributes?.name,60)||item.id);continue;}
  if(item?.type!=='token'||typeof item.id!=='string'||!item.id.toLowerCase().startsWith(prefix))continue;
  const address=item.id.slice(prefix.length).toLowerCase();
  if(!ADDR.test(address))continue;
  const stated=item.attributes?.address;
  if(stated!==undefined&&stated!==null&&String(stated).toLowerCase()!==address)continue;
  const symbol=text(item.attributes?.symbol,20);
  if(!symbol)continue;
  tokens.set(item.id.toLowerCase(),{address,symbol,name:text(item.attributes?.name,70)||symbol,logo:logoUrl(item.attributes?.image_url),coinId:text(item.attributes?.coingecko_coin_id,80)||null});
 }
 const rows=[];
 for(const pool of body.data){
  if(pool?.type!=='pool'||typeof pool.id!=='string')continue;
  const a=pool.attributes||{},pa=typeof a.address==='string'?a.address.toLowerCase():'';
  if(!POOL.test(pa)||pool.id.toLowerCase()!==prefix+pa)continue;
  const baseRef=pool.relationships?.base_token?.data,quoteRef=pool.relationships?.quote_token?.data;
  if(baseRef?.type!=='token'||typeof baseRef.id!=='string')continue;
  const base=tokens.get(baseRef.id.toLowerCase());
  if(!base)continue;
  const quote=quoteRef&&typeof quoteRef.id==='string'?tokens.get(quoteRef.id.toLowerCase()):null;
  if(quote&&quote.address===base.address)continue;
  const nonneg=v=>{const n=num(v);return n!==null&&n>=0?n:null;},pos=v=>{const n=num(v);return n!==null&&n>0?n:null;};
  const change=num(a.price_change_percentage?.h24);
  const created=typeof a.pool_created_at==='string'&&Number.isFinite(Date.parse(a.pool_created_at))?new Date(a.pool_created_at).toISOString():null;
  const tx=a.transactions?.h24;
  const dexId=pool.relationships?.dex?.data?.id;
  rows.push({
   ...base,network,chainId:NETWORKS[network].chainId,pool:pa,
   dexId:typeof dexId==='string'?text(dexId,60):null,dex:typeof dexId==='string'?(dexes.get(dexId)||text(dexId,60)):null,
   quote:quote?{address:quote.address,symbol:quote.symbol}:null,
   priceUsd:nonneg(a.base_token_price_usd),volume24hUsd:nonneg(a.volume_usd?.h24),liquidityUsd:nonneg(a.reserve_in_usd),
   change24hPct:change!==null&&Math.abs(change)<1e9?change:null,
   buys24h:Number.isSafeInteger(num(tx?.buys))?num(tx.buys):null,sells24h:Number.isSafeInteger(num(tx?.sells))?num(tx.sells):null,
   fdvUsd:pos(a.fdv_usd),marketCapUsd:pos(a.market_cap_usd),poolCreatedAt:created
  });
 }
 return {rows,inspected:body.data.length};
}
async function fetchPage(access,network,kind,page,{fetcher,now}){
 const url=access.host+pathFor(network,kind,page);
 const headers=access.key?{[access.header]:access.key}:{};
 return http.request('geckoterminal',url,{headers,fetcher,now});
}
// tokens/multi (<=30 contracts per call): token-level facts keyed by exact address. Every field is nullable; nothing is derived.
// market_cap_usd is passed through only when the provider states it. FDV is NEVER substituted for it.
async function fetchMulti(access,network,addresses,{fetcher,now}){
 const list=[...new Set(addresses.filter(a=>ADDR.test(a)).map(a=>a.toLowerCase()))].slice(0,30);
 const out=new Map();if(!list.length)return out;
 const body=await http.request('geckoterminal',access.host+`/networks/${NETWORKS[network].gecko}/tokens/multi/${list.join(',')}`,{headers:access.key?{[access.header]:access.key}:{},fetcher,now});
 if(!body||!Array.isArray(body.data)||body.data.length>30)throw http.fail('RADAR_INVALID_PROVIDER_RESPONSE',{provider:'geckoterminal'});
 const prefix=NETWORKS[network].gecko+'_',pos=v=>{const n=num(v);return n!==null&&n>0?n:null;},nonneg=v=>{const n=num(v);return n!==null&&n>=0?n:null;};
 for(const d of body.data){
  const a=d?.attributes,addr=typeof a?.address==='string'?a.address.toLowerCase():'';
  if(d?.type!=='token'||!ADDR.test(addr)||!list.includes(addr)||(typeof d.id==='string'&&d.id.toLowerCase()!==prefix+addr))continue;
  out.set(addr,{logo:logoUrl(a.image_url),coinId:text(a.coingecko_coin_id,80)||null,priceUsd:nonneg(a.price_usd),fdvUsd:pos(a.fdv_usd),marketCapUsd:pos(a.market_cap_usd),
   liquidityUsd:nonneg(a.total_reserve_in_usd),volume24hUsd:nonneg(a.volume_usd?.h24),totalSupply:nonneg(a.normalized_total_supply)});
 }
 return out;
}
// Ranking = each base token's single highest-volume pool. Never a sum over pools (providers return overlapping pools).
function rankTop(pageResults,limit=10){
 const best=new Map();let inspected=0;
 for(const r of pageResults){inspected+=r.inspected;for(const row of r.rows){if(!(row.volume24hUsd>0))continue;const cur=best.get(row.address);if(!cur||row.volume24hUsd>cur.volume24hUsd)best.set(row.address,row);}}
 const tokens=[...best.values()].sort((a,b)=>b.volume24hUsd-a.volume24hUsd||a.address.localeCompare(b.address)).slice(0,limit);
 return {tokens,inspected,unique:best.size};
}
module.exports={pathFor,parse,fetchPage,fetchMulti,logoUrl,rankTop};
