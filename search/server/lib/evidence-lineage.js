'use strict';
// Dependency-aware provenance. A DERIVED field (status ON_CHAIN_DERIVED) is only as strong as the WEAKEST of its essential inputs:
//   ONCHAIN      read from chain state at an identified block (RPC/getter/pinned snapshot)  -> may support ON_CHAIN_VERIFIED
//   MARKET_API   reported by an off-chain indexer/API (GeckoTerminal, DEX Screener, CoinGecko ...) -> caps the result at SINGLE_SOURCE
//   UNKNOWN      an input the evidence does not identify                                       -> cannot be claimed as verified
// Example: FDV = on-chain totalSupply x market price. The supply is ONCHAIN but the price is MARKET_API, so the FDV is SINGLE_SOURCE,
// never ON_CHAIN_VERIFIED. FDV from a price that is itself read on-chain keeps ON_CHAIN_VERIFIED. Pure function; never mutates the field.
const DERIVED=new Set(['ON_CHAIN_DERIVED']);
const MARKET_WORD=/gecko|dex ?screener|coingecko|coinmarketcap|defillama|market ?api|indexer|explorer|oracle api|birdeye|moralis/i;
const flat=(f)=>{
 const out=[];
 const walk=(e,depth)=>{
  if(!e||typeof e!=='object'||depth>2)return;
  out.push(e);
  for(const k of ['priceEvidence','inputs'])if(Array.isArray(e[k]))for(const x of e[k])walk(x,depth+1);
 };
 for(const e of Array.isArray(f.evidence)?f.evidence:[])walk(e,0);
 return out;
};
function originOf(e){
 if(typeof e.provider==='string'&&e.provider&&!/rpc|on-?chain/i.test(e.provider))return 'MARKET_API';
 if(typeof e.sourceUrl==='string'||typeof e.legacySource==='string')return 'MARKET_API';
 if(typeof e.url==='string'&&(e.block===undefined||e.block===null))return 'MARKET_API';   // provider endpoint without a chain block (observed: api.dexscreener.com / api.geckoterminal.com)
 if(typeof e.primaryPair==='string'||Array.isArray(e.pairs))return 'MARKET_API';
 if(typeof e.source==='string'&&MARKET_WORD.test(e.source))return 'MARKET_API';
 if(e.block!==undefined&&e.block!==null&&(e.method||e.address||e.token))return 'ONCHAIN';
 return 'UNKNOWN';
}
function roleOf(e,f){
 const m=String(e.method||'');
 if(/totalSupply|balanceOf|getter|decimals/i.test(m)&&!e.provider&&!e.url)return 'supply';   // a combined "totalSupply x price" method still READS the supply on-chain; the price part is a separate nested/sibling input
 if(/price|fdv|market|pool|pair/i.test(m)||e.provider)return 'price';
 return f.kind==='FDV'?'price':'input';
}
// Text fallback when evidence is thin: "<chain> RPC totalSupply x GeckoTerminal ..." names its own off-chain input.
function sourceTermsOffchain(f){
 if(typeof f.source!=='string'||!/[×x*]/.test(f.source))return false;
 return f.source.split(/[×*]|\sx\s/).some(p=>MARKET_WORD.test(p));
}
function lineage(f){
 if(!f||typeof f!=='object'||!DERIVED.has(f.status))return null;
 const inputs=flat(f).map(e=>({role:roleOf(e,f),origin:originOf(e),provider:typeof e.provider==='string'?e.provider:null,
  block:e.block??null,asOf:e.checkedAt||e.fetchedAt||null,method:typeof e.method==='string'?e.method.slice(0,120):null}))
  .filter(i=>i.origin!=='UNKNOWN'||i.method);
 const market=inputs.filter(i=>i.origin==='MARKET_API'),unknown=inputs.filter(i=>i.origin==='UNKNOWN'),onchain=inputs.filter(i=>i.origin==='ONCHAIN');
 const textOff=sourceTermsOffchain(f);
 const isFdv=f.kind==='FDV';
 let weakest='ONCHAIN',reason='all identified essential inputs are read on-chain';
 if(market.length||textOff){weakest='MARKET_API';reason='an essential input is an off-chain market-data value'+(market[0]?.provider?' ('+market[0].provider+')':'');}
 else if(isFdv&&(!onchain.some(i=>i.role==='supply')||!inputs.some(i=>i.role==='price'))){weakest='UNKNOWN';reason='FDV needs both a supply input and a price input; the evidence does not identify both';}
 else if(unknown.length){weakest='UNKNOWN';reason='an essential input is not identified by the evidence';}
 return {rule:'WEAKEST_ESSENTIAL_INPUT',derived:true,weakest,onchainOnly:weakest==='ONCHAIN',reason,inputs:inputs.slice(0,8)};
}
module.exports={lineage,originOf};
