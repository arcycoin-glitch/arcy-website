'use strict';
const {readJson}=require('./http');
const {safeLogoUrl}=require('./token-image');
const SOURCE='https://api.dexscreener.com/latest/dex/search/';
const ADDRESS=/^0x[0-9a-f]{40}$/i;
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
function normalizeQuery(raw){
 if(typeof raw!=='string')return null;
 const q=raw.normalize('NFKC').trim().replace(/\s+/g,' ');
 return SEARCH.test(q)&&!ADDRESS.test(q)?q:null;
}
function parse(pairs,rawQuery){
 const query=normalizeQuery(rawQuery);
 if(!query)return [];
 const q=query.toLocaleLowerCase('en-US'),found=new Map();
 for(const pair of Array.isArray(pairs)?pairs.slice(0,400):[]){
  if(pair?.chainId!=='ethereum')continue;
  for(const token of [pair.baseToken,pair.quoteToken]){
   if(!token||typeof token!=='object')continue;
   const address=String(token.address||'').trim().toLowerCase();
   if(!ADDRESS.test(address))continue;
   const name=String(token.name||'').trim().slice(0,90),symbol=String(token.symbol||'').trim().slice(0,30);
   if(!name&&!symbol)continue;
   const lowerName=name.toLocaleLowerCase('en-US'),lowerSymbol=symbol.toLocaleLowerCase('en-US');
   if(!lowerName.includes(q)&&!lowerSymbol.includes(q))continue;
   const relevance=lowerSymbol===q?0:lowerName===q?1:lowerSymbol.startsWith(q)?2:lowerName.startsWith(q)?3:4;
   const amount=Number(pair.liquidity?.usd),liquidity=Number.isFinite(amount)&&amount>=0?amount:0;
   // DexScreener pair artwork identifies the base token only, never its quote asset.
   const logoUrl=token===pair.baseToken?safeLogoUrl(pair.info?.imageUrl):null;
   const prev=found.get(address);
   if(!prev||relevance<prev.relevance||relevance===prev.relevance&&liquidity>prev.liquidity){
    found.set(address,{name,symbol,address,chainId:1,network:'Ethereum',source:'DexScreener',identityVerified:false,relevance,liquidity,logoUrl:logoUrl||prev?.logoUrl||null});
   }
  }
 }
 return [...found.values()].sort((a,b)=>a.relevance-b.relevance||b.liquidity-a.liquidity||a.address.localeCompare(b.address)).slice(0,12).map(({name,symbol,address,chainId,network,source,identityVerified,logoUrl})=>({name,symbol,address,chainId,network,source,identityVerified,logoUrl}));
}
const COINGECKO_SEARCH='https://api.coingecko.com/api/v3/search?query=';
const COINGECKO_DETAIL='https://api.coingecko.com/api/v3/coins/';
async function coinGeckoFallback(query){
 const q=query.toLocaleLowerCase('en-US');
 const search=await fetch(COINGECKO_SEARCH+encodeURIComponent(query),{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
 if(!search.ok)throw Error('CoinGecko discovery search HTTP '+search.status);
 const body=await readJson(search,512*1024);
 if(!Array.isArray(body?.coins))throw Error('Invalid CoinGecko discovery response');
 const relevant=body.coins.filter(x=>{
  const name=String(x?.name||'').toLocaleLowerCase('en-US'),symbol=String(x?.symbol||'').toLocaleLowerCase('en-US');
  return /^[a-z0-9-]{2,100}$/.test(String(x?.id||''))&&(name.includes(q)||symbol.includes(q));
 }).slice(0,3);
 const details=await Promise.allSettled(relevant.map(async coin=>{
  const url=COINGECKO_DETAIL+encodeURIComponent(coin.id)+'?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false';
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw Error('CoinGecko detail HTTP '+response.status);
  const detail=await readJson(response,512*1024);
  if(detail?.id!==coin.id)return null;
  const address=String(detail.platforms?.ethereum||'').toLowerCase();
  if(!ADDRESS.test(address))return null;
  return {name:String(coin.name||'').slice(0,90),symbol:String(coin.symbol||'').slice(0,30),address,chainId:1,network:'Ethereum',source:'CoinGecko',catalogCoinId:coin.id,identityVerified:false,
   logoUrl:safeLogoUrl(detail.image?.small||detail.image?.thumb||detail.image?.large)||null};
 }));
 const result=[],seen=new Set();
 for(const detail of details)if(detail.status==='fulfilled'&&detail.value&&!seen.has(detail.value.address)){
  seen.add(detail.value.address);result.push(detail.value);
 }
 return result;
}
async function discover(rawQuery){
 const q=normalizeQuery(rawQuery);
 if(!q)throw Error('Invalid discovery query');
 // Consult CoinGecko even when DexScreener returns many tickers; otherwise
 // spoofed names on DEX pairs can hide the indexed main contract.
 // Independent providers remain optional and failures never create fake proof.
 const marketWork=(async()=>{
  const response=await fetch(SOURCE+'?q='+encodeURIComponent(q),{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Token discovery source HTTP '+response.status);
  const json=await readJson(response,2*1024*1024);
  if(!json||typeof json!=='object'||(json.pairs!==null&&!Array.isArray(json.pairs)))throw Error('Malformed token discovery response');
  return parse(json.pairs||[],q);
 })();
 const [marketResult,catalogResult]=await Promise.allSettled([marketWork,coinGeckoFallback(q)]);
 if(marketResult.status==='rejected'&&catalogResult.status==='rejected')
  throw Error('All discovery providers unavailable');
 const market=marketResult.status==='fulfilled'?marketResult.value:[];
 const catalog=catalogResult.status==='fulfilled'?catalogResult.value:[];
 const seen=new Set();
 return [...catalog,...market].filter(x=>{
  if(seen.has(x.address))return false;
  seen.add(x.address);return true;
 }).slice(0,12);
}
module.exports={normalizeQuery,parse,coinGeckoFallback,discover};
