'use strict';
const {readJson}=require('./http');
const {safeLogoUrl}=require('./token-image');
const {chain}=require('./chains');
const {ADDRESS}=require('./eth');
const {uint,units}=require('./eth');
const {rpc,inspectToken}=require('./robinhood-rpc');
const market=require('./robinhood-market');
const stocks=require('./robinhood-assets');
const cfg=chain('robinhood');
const NO=(reason,reasonCode='INSUFFICIENT_EVIDENCE')=>({value:null,status:'NOT_VERIFIED',
 dataState:'NOT_VERIFIED',reason,reasonCode,source:null,evidence:[]});
function evidence(value,source,proof,status='SOURCE_REPORTED'){
 return {value,status,dataState:'DATA_FOUND',chainId:cfg.chainId,network:cfg.id,
  source,evidence:[{chainId:cfg.chainId,network:cfg.id,...proof}]};
}
let assetsCache=null,assetsPromise=null;
const marketInflight=new Map();
function inspectMarket(address){
 const existing=marketInflight.get(address);
 if(existing)return existing;
 const request=market.inspect(address);
 marketInflight.set(address,request);
 const clear=()=>{if(marketInflight.get(address)===request)marketInflight.delete(address)};
 request.then(clear,clear);
 return request;
}
async function officialAssets(){
 if(assetsCache&&Date.now()-assetsCache.at<600000)return assetsCache.body;
 if(assetsPromise)return assetsPromise;
 assetsPromise=(async()=>{
  const res=await fetch(cfg.stockTokenRegistry,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Official Robinhood registry unavailable');
  const body=await readJson(res,5*1024*1024);
  stocks.parseAssets(body); // Validate format before caching anything.
  assetsCache={at:Date.now(),body};
  return body;
 })();
 try{return await assetsPromise}finally{assetsPromise=null}
}
async function inspectStock({address}){
 try{return stocks.byContract(await officialAssets(),address)}
 catch{return null} // Cannot claim it is a non-stock; identity remains NOT VERIFIED.
}
async function supply(base){
 const proof={address:base.address,block:base.block,source:'Robinhood RPC',method:'ERC-20 pinned-block call'};
 const raw=BigInt(base.totalSupplyRaw);
 const precision=10n**80n;
 const share=base.burnAddressRaw===null||raw<=0n||BigInt(base.burnAddressRaw)>raw?null:
  Number((BigInt(base.burnAddressRaw)*100n*precision+raw/2n)/raw)/1e80;
 return {description:'Pinned Robinhood mainnet ERC-20 total supply and current zero/dead holdings.',
 fields:{
  totalSupply:evidence(base.totalSupply,'Robinhood RPC',{...proof,method:'totalSupply()'},'ON_CHAIN'),
  circulatingSupply:NO('No source-confirmed, contract-matched circulating supply for Robinhood Chain.'),
  burnAddressBalance:base.burnAddressBalance===null?NO('Burn-address balance unavailable.'):
   evidence(base.burnAddressBalance,'Robinhood RPC',{...proof,method:'balanceOf(0x0/0xdead)'},'ON_CHAIN'),
  burnAddressPct:share===null?NO('Burn share cannot be reconciled.'):
   evidence(share,'Robinhood RPC',{...proof,method:'current zero/dead balances divided by totalSupply()',scope:'Current balances only; not lifetime burned.'},'ON_CHAIN_DERIVED')
 }};
}
async function holder({address}){
 const fields={
  holderCount:NO('No contract-scoped Blockscout holder count available; optional PRO source not configured or unavailable.'),
  largestWalletPct:NO('No complete pinned-block holder ranking with supply reconciliation.'),
  top10Pct:NO('No complete pinned-block holder ranking with supply reconciliation.'),
  top20Pct:NO('No complete pinned-block holder ranking with supply reconciliation.')
 };
 const count=await require('./robinhood-holder-count').fetchCount(address);
 if(count)fields.holderCount=count;
 return {description:count?
  'Contract-matched current explorer holder count; whale percentages need a complete reconciled snapshot.':
  'No verifiable holder population; whale concentration is NOT VERIFIED.',fields};
}
async function activity({address},cardId){
 const fields=await inspectMarket(address);
 const keys=cardId==='liquidity'?['liquidityUsd','volume24h','dexPairCount','lpStatus']:
  ['priceUsd','valuation','change24h','volume24h'];
 return {description:'Source-reported exact Robinhood DEX pairs only; unlisted pools are excluded.',
  fields:Object.fromEntries(keys.map(k=>[k,fields[k]??NO('Market source missing field.')]))};
}
const PROXY='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
function addressOf(word){
 return typeof word==='string'&&/^0x[0-9a-f]{64}$/i.test(word)&&!/^0+$/.test(word.slice(-40))?'0x'+word.slice(-40).toLowerCase():null;
}
async function mechanics({address,base}){
 const result=await Promise.allSettled([
  rpc('eth_call',[{to:address,data:'0x8da5cb5b'},base.block]),
  rpc('eth_getStorageAt',[address,PROXY,base.block])
 ]);
 const owner=result[0].status==='fulfilled'?addressOf(result[0].value):null;
 const implementation=result[1].status==='fulfilled'?addressOf(result[1].value):null;
 const proof={address,block:base.block};
 return {description:'Read-only contract getter/storage signals, not a complete privilege audit.',
  fields:{
   tradingTaxes:NO('No verified Robinhood chain-specific trading-tax provider.'),
   mintCapability:NO('Mint ability cannot be proven by an absent getter or unsupported source.'),
   ownerAdmin:owner?evidence('owner() getter: '+owner,'Robinhood RPC',{...proof,method:'owner()'},'GETTER_REPORTED'):
    NO('Owner getter unavailable; absence does not prove renouncement.'),
   contractArchitecture:implementation?evidence('EIP-1967 implementation: '+implementation,'Robinhood RPC',{
    ...proof,method:'EIP-1967 implementation storage',scope:'Does not prove all upgrade permissions.'},'ON_CHAIN'):
    NO('EIP-1967 implementation not established; other proxy designs may exist.')
  }};
}
async function inspectCard({base,cardId,address}){
 switch(cardId){
  case 'supply':return supply(base);
  case 'holders':return holder({address});
  case 'liquidity':case 'activity':return activity({address},cardId);
  case 'mechanics':return mechanics({address,base});
  default:throw Error('Unexpected card');
 }
}
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
async function discover({query}){
 const q=query.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!SEARCH.test(q)||ADDRESS.test(q))throw Error('Invalid search');
 let responsive=false;
 const candidates=[];
 try{const registry=await officialAssets();responsive=true;candidates.push(...stocks.search(registry,q).map(x=>({...x,network:cfg.id,chainId:cfg.chainId})))}catch{}
 try{
  const res=await fetch('https://api.dexscreener.com/latest/dex/search/?q='+encodeURIComponent(q),{
   headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
  });
  if(res.ok){
   const body=await readJson(res,2*1024*1024);
   if(!body||typeof body!=='object'||(body.pairs!==null&&!Array.isArray(body.pairs)))throw Error('Invalid search source');
   responsive=true;
   const lower=q.toLocaleLowerCase('en-US');
   for(const pair of Array.isArray(body?.pairs)?body.pairs.slice(0,400):[]){
    if(pair?.chainId!==cfg.dexScreenerChainId)continue;
    for(const token of [pair.baseToken,pair.quoteToken]){
     const address=String(token?.address||'').toLowerCase();
     const symbol=typeof token?.symbol==='string'?token.symbol.slice(0,30):'';
     const name=typeof token?.name==='string'?token.name.slice(0,90):'';
     if(!ADDRESS.test(address)||!(
      symbol.toLocaleLowerCase('en-US').includes(lower)||name.toLocaleLowerCase('en-US').includes(lower)))continue;
     candidates.push({chainId:cfg.chainId,network:cfg.id,address,symbol,name,
      source:'DexScreener',registryMatched:false,
      logoUrl:token===pair.baseToken?safeLogoUrl(pair.info?.imageUrl):null});
    }
   }
  }
 }catch{}
 if(!responsive)throw Error('Robinhood discovery providers unavailable');
 const seen=new Set();
 return candidates.filter(x=>{if(seen.has(x.address))return false;seen.add(x.address);return true}).slice(0,12);
}
module.exports={inspectToken,inspectCard,inspectStock,discover,officialAssets,supply,holder,mechanics,addressOf,inspectMarket};
