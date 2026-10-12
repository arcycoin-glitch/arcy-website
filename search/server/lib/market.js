'use strict';
const {found,unknown,card,error}=require('./evidence');
const {readJson}=require('./http');
const API='https://api.dexscreener.com/latest/dex/tokens/';
const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
function parse(pairs,token){
  const seen=new Set();
  const matching=(Array.isArray(pairs)?pairs:[]).filter(p=>{
    if(p?.chainId!=='ethereum')return false;
    if(![p.baseToken?.address,p.quoteToken?.address].some(x=>String(x||'').toLowerCase()===token))return false;
    const id=String(p.pairAddress||'').trim();
    // DexScreener can return either an EVM pair address/bytes32 pool ID or a
    // composite v4 pool key of factory-token0-token1. Match hex case-insensitively.
    const validId=/^(?:0x[0-9a-f]{40}|0x[0-9a-f]{64}|(?:0x[0-9a-f]{40}-){2}0x[0-9a-f]{40})$/i.test(id);
    const normalized=id.toLowerCase();
    if(!validId||seen.has(normalized))return false;
    seen.add(normalized);return true;
  }).sort((a,b)=>(numeric(b.liquidity?.usd)?b.liquidity.usd:0)-(numeric(a.liquidity?.usd)?a.liquidity.usd:0));
  const evidence=[{source:'DexScreener',chainId:'ethereum',token,matchedPairs:matching.map(p=>p.pairAddress),scope:'Subset of source-returned, exact-contract Ethereum pairs; NOT Ethereum-wide liquidity, volume, or pair count. DexScreener responses may omit pools.'}];
  const sum=get=>matching.length&&matching.every(p=>numeric(get(p)))?matching.reduce((n,p)=>n+get(p),0):null;
  const liquid=sum(p=>p.liquidity?.usd);
  const volume=sum(p=>p.volume?.h24);
  // DexScreener priceUsd and priceChange describe the BASE token only.
  // The most-liquid matched pool may list our token as the QUOTE asset.
  // Search all matched pools for a valid exact-base-token price rather than
  // hiding a usable price or misattributing the quote asset's base price.
  const pricePool=matching.find(p=>String(p.baseToken?.address||'').toLowerCase()===token
    &&Number.isFinite(Number(p.priceUsd))&&Number(p.priceUsd)>0);
  const price=pricePool?Number(pricePool.priceUsd):NaN;
  const priceValue=Number.isFinite(price)&&price>0?String(pricePool.priceUsd):null;
  const change=pricePool?.priceChange?.h24;
  const cap=pricePool&&Number.isFinite(pricePool.marketCap)&&pricePool.marketCap>0?pricePool.marketCap:null;
  const fdv=pricePool&&Number.isFinite(pricePool.fdv)&&pricePool.fdv>0?pricePool.fdv:null;
  const valuation=cap!==null?{value:cap,kind:'MARKET_CAP'}:fdv!==null?{value:fdv,kind:'FDV'}:null;
  const changeValid=typeof change==='number'&&Number.isFinite(change);
  const pairCount=matching.length;
  const dexCount=pairCount?new Set(matching.map(p=>p.dexId).filter(x=>typeof x==='string'&&x.length>0)).size:null;
  const pairSummary=pairCount&&dexCount?dexCount+' DEX · '+pairCount+' pairs':null;
  const fields={
    liquidityUsd:liquid===null?unknown('No complete exact-pool liquidity dataset.','LIQUIDITY_NOT_VERIFIED'):found(liquid,'DexScreener',evidence),
    volume24h:volume===null?unknown('No complete exact-pool volume dataset.','VOLUME_NOT_VERIFIED'):found(volume,'DexScreener',evidence),
    dexPairCount:pairSummary===null?unknown('Exact-matched DEX and pair counts unavailable.','PAIR_COUNT_NOT_VERIFIED'):found(pairSummary,'DexScreener',evidence),
    lpStatus:unknown('Pool liquidity does not establish LP ownership, lock or withdrawal permissions.','LP_STATUS_NOT_VERIFIED'),
    priceUsd:priceValue===null?unknown('No exact base-token-matched pool price.','PRICE_NOT_VERIFIED'):found(priceValue,'DexScreener',evidence),
    valuation:valuation===null?unknown('No exact base-token-matched market cap or FDV.','VALUATION_NOT_VERIFIED'):{...found(valuation.value,'DexScreener',evidence),kind:valuation.kind},
    change24h:!changeValid?unknown('No exact base-token-matched 24h price change.','CHANGE_NOT_VERIFIED'):found(change,'DexScreener',evidence)
  };
  return {...card(fields,'Source-returned matched Ethereum pools only; partial coverage is not total market liquidity or guaranteed exit liquidity.'),primaryPair:pricePool?.pairAddress||matching[0]?.pairAddress||null,matches:pairCount};
}
async function inspect(address){
 const response=await fetch(API+address,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Market API HTTP '+response.status);
 const body=await readJson(response,2*1024*1024);
 if(!body||typeof body!=='object'||(body.pairs!==null&&!Array.isArray(body.pairs)))throw Error('Invalid market API response');
 return parse(body.pairs||[],address.toLowerCase());
}
function failure(e){
 const failed=()=>error(e,'DexScreener');
 return card({liquidityUsd:failed(),volume24h:failed(),dexPairCount:failed(),lpStatus:unknown('LP status never inferred from market listing.'),priceUsd:failed(),valuation:failed(),change24h:failed()},'Ethereum market API was unavailable.');
}
module.exports={parse,inspect,failure};
