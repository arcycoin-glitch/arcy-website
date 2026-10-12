'use strict';
// Robinhood-only read-only market source. DEX values are market-provider reports,
// never onchain proofs, and only selected-source pool coverage.
const {readJson}=require('./http');
const {chain}=require('./chains');
const {ADDRESS}=require('./eth');
const cfg=chain('robinhood'),API='https://api.dexscreener.com/latest/dex/tokens/';
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const unknown=(reason)=>({value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',reason,source:null});
function field(value,address,notes,kind=null){
 return {value,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  chainId:cfg.chainId,network:cfg.id,source:'DexScreener',
  evidence:[{chainId:cfg.chainId,network:cfg.id,address,provider:'DexScreener',scope:notes}],
  ...(kind?{kind}:{})};
}
function parse(payload,address){
 const seen=new Set(),matches=[];
 for(const p of Array.isArray(payload)?payload:[]){
  if(p?.chainId!==cfg.dexScreenerChainId)continue;
  if(![p.baseToken?.address,p.quoteToken?.address].some(a=>String(a||'').toLowerCase()===address))continue;
  const pairAddress=String(p.pairAddress||'').toLowerCase();
  if(!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pairAddress)||seen.has(pairAddress))continue;
  seen.add(pairAddress);matches.push(p);
 }
 matches.sort((a,b)=>(num(b.liquidity?.usd)?b.liquidity.usd:0)-(num(a.liquidity?.usd)?a.liquidity.usd:0));
 const scope='Exact Robinhood Chain token and source-returned pairs only; not total network liquidity or guaranteed exit volume.';
 const sum=fn=>matches.length&&matches.every(p=>num(fn(p)))?matches.reduce((n,p)=>n+fn(p),0):null;
 const liquidity=sum(p=>p.liquidity?.usd),volume=sum(p=>p.volume?.h24);
 const dexes=new Set(matches.map(p=>typeof p.dexId==='string'?p.dexId:'').filter(Boolean));
 const primary=matches.find(p=>String(p.baseToken?.address||'').toLowerCase()===address&&
   Number.isFinite(Number(p.priceUsd))&&Number(p.priceUsd)>0);
 const price=primary?String(primary.priceUsd):null;
 const cap=primary&&num(primary.marketCap)&&primary.marketCap>0?primary.marketCap:null;
 const fdv=primary&&num(primary.fdv)&&primary.fdv>0?primary.fdv:null;
 const change=primary?.priceChange?.h24;
 const source=(v,missing,kind=null)=>v===null?unknown(missing):field(v,address,scope,kind);
 return {liquidityUsd:source(liquidity,'Liquidity not returned for all matched pairs.'),
  volume24h:source(volume,'24H volume not returned for all matched pairs.'),
  dexPairCount:source(matches.length&&dexes.size?dexes.size+' DEX · '+matches.length+' pairs':null,'No exact matched DEX pairs.'),
  lpStatus:unknown('LP lock/ownership is not demonstrated by a pool listing.'),
  priceUsd:source(price,'No contract-matched base-token DEX price.'),
  valuation:cap!==null?source(cap,'','MARKET_CAP'):source(fdv,'Market cap and FDV unavailable.',fdv===null?null:'FDV'),
  change24h:source(typeof change==='number'&&Number.isFinite(change)?change:null,'No exact base-token 24H change.')};
}
async function inspect(address){
 if(!ADDRESS.test(address))throw Error('Invalid contract');
 const res=await fetch(API+address.toLowerCase(),{headers:{accept:'application/json'},signal:AbortSignal.timeout(8500)});
 if(!res.ok)throw Error('Robinhood DexScreener not available');
 const body=await readJson(res,2*1024*1024);
 if(!body||typeof body!=='object'||!('pairs'in body)||body.pairs!==null&&!Array.isArray(body.pairs))
  throw Error('Malformed DexScreener response');
 return parse(body.pairs||[],address.toLowerCase());
}
module.exports={parse,inspect};
