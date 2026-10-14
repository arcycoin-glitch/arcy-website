'use strict';
const {readJson}=require('./http');
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
 const [count,reported]=await Promise.all([
  require('./robinhood-holder-count').fetchCount(address),
  require('./goplus-evidence').inspectHolders('robinhood',address)
 ]);
 if(count)fields.holderCount=count;
 else if(reported.holderCount?.dataState==='DATA_FOUND')
  fields.holderCount=reported.holderCount;
 for(const key of ['largestWalletPct','top10Pct']){
  if(reported[key]?.dataState==='DATA_FOUND')fields[key]=reported[key];
 }
 const sourceRank=fields.top10Pct.dataState==='DATA_FOUND';
 return {description:sourceRank?
  'GoPlus source-reported top-wallet sample, not a complete pinned-chain ranking. Contract-matched holder counts may come from Blockscout or GoPlus. Top 20 remains NOT VERIFIED.':
  'Holder count is source-reported where available; complete whale concentration is NOT VERIFIED.',fields};
}
async function activity({address},cardId){
 const fields=await inspectMarket(address);
 const keys=cardId==='liquidity'?['liquidityUsd','volume24h','dexPairCount','lpStatus']:
  ['priceUsd','valuation','change24h','volume24h'];
 return {description:'Market observations are source-reported from exact-contract Robinhood Chain pools and may cover only a subset of pools. They do not represent the underlying company share price; unsupported fields remain NOT VERIFIED.',
  fields:Object.fromEntries(keys.map(k=>[k,fields[k]??NO('Market source missing field.')]))};
}
const PROXY='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
function addressOf(word){
 return typeof word==='string'&&/^0x[0-9a-f]{64}$/i.test(word)&&!/^0+$/.test(word.slice(-40))?'0x'+word.slice(-40).toLowerCase():null;
}
async function mechanics({address,base}){
 let cloneArchitecture=null;
 if(typeof base.proxyImplementation==='string'){
  try{
   const code=await rpc('eth_getCode',[base.proxyImplementation,base.block]);
   if(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(code)&&code!=='0x')
    cloneArchitecture=evidence('EIP-1167 minimal proxy → '+base.proxyImplementation,'Robinhood RPC',{
     address,block:base.block,method:'exact EIP-1167 runtime bytecode + eth_getCode(implementation)',
     implementation:base.proxyImplementation,scope:'Implementation bytecode exists at the same pinned Robinhood block. This does not establish whether implementation behavior or control can change.'
    },'ON_CHAIN');
  }catch{} // A missing implementation read leaves architecture unverified.
 }
 const result=await Promise.allSettled([
  rpc('eth_call',[{to:address,data:'0x8da5cb5b'},base.block]),
  rpc('eth_getStorageAt',[address,PROXY,base.block]),
  require('./goplus-evidence').inspect('robinhood',address)
 ]);
 const owner=result[0].status==='fulfilled'?addressOf(result[0].value):null;
 const implementation=result[1].status==='fulfilled'?addressOf(result[1].value):null;
 const observed=result[2].status==='fulfilled'?result[2].value:{};
 const proof={address,block:base.block};
 let extra={};
 if(!owner||!implementation){
  try{extra=await require('./admin-getters').inspect({
   network:'robinhood',address,block:base.block,rpc,
   needAdmin:!owner,needImplementation:!implementation
  })}catch{} // Optional fallback never replaces known on-chain evidence.
 }
 return {description:'On-chain getters and chain-specific GoPlus security observations; not a complete privilege or upgradeability audit.',
  fields:{
   tradingTaxes:observed.tradingTaxes?.dataState==='DATA_FOUND'?observed.tradingTaxes:
    NO('No contract-matched trading-tax report.'),
   mintCapability:observed.mintCapability?.dataState==='DATA_FOUND'?observed.mintCapability:
    NO('Mint permission is unverified; absent getter does not prove no minting.'),
   ownerAdmin:owner?evidence('owner() getter: '+owner,'Robinhood RPC',{...proof,method:'owner()'},'GETTER_REPORTED'):
    extra.ownerAdmin?.dataState==='DATA_FOUND'?extra.ownerAdmin:
    observed.ownerAdmin?.dataState==='DATA_FOUND'?observed.ownerAdmin:
    NO('No source-confirmed owner/admin model; absence of owner getter does not prove renouncement.'),
   contractArchitecture:implementation?evidence('EIP-1967 implementation: '+implementation,'Robinhood RPC',{
    ...proof,method:'EIP-1967 implementation storage',scope:'Does not prove all upgrade permissions.'},'ON_CHAIN'):
    cloneArchitecture?cloneArchitecture:
    extra.contractArchitecture?.dataState==='DATA_FOUND'?extra.contractArchitecture:
    observed.contractArchitecture?.dataState==='DATA_FOUND'?observed.contractArchitecture:
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
 if(!responsive)throw Error('Robinhood discovery providers unavailable');
 const seen=new Set();
 return candidates.filter(x=>{if(seen.has(x.address))return false;seen.add(x.address);return true}).slice(0,12);
}
module.exports={inspectToken,inspectCard,inspectStock,discover,officialAssets,supply,holder,mechanics,addressOf,inspectMarket};

