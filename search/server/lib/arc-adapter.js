'use strict';
// Arc mainnet read-only intelligence adapter. Unsupported assertions fail closed.
// Do not confuse this lightweight lab adapter with the production durable holder worker.
const {chain}=require('./chains');
const {ADDRESS}=require('./eth');
const {readJson}=require('./http');
const {safeLogoUrl}=require('./token-image');
const rpcClient=require('./arc-rpc');
const market=require('./arc-market');
const cfg=chain('arc');
const NO=(reason,reasonCode='INSUFFICIENT_EVIDENCE')=>({
 value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED',
 reason,reasonCode,source:null,evidence:[],chainId:cfg.chainId,network:cfg.id
});
const proof=(value,source,evidence,status='SOURCE_REPORTED')=>({
 value,source,evidence:[{chainId:cfg.chainId,network:cfg.id,...evidence}],
 status,dataState:'DATA_FOUND',chainId:cfg.chainId,network:cfg.id
});
const marketPending=new Map();
function marketFor(address){
 if(marketPending.has(address))return marketPending.get(address);
 const work=market.inspect(address);
 marketPending.set(address,work);
 const done=()=>{if(marketPending.get(address)===work)marketPending.delete(address)};
 work.then(done,done);
 return work;
}
async function inspectToken({address}){return rpcClient.inspectToken({address})}
function supply(base){
 const details={address:base.address,block:base.block,method:'pinned ERC-20 calls'};
 const total=BigInt(base.totalSupplyRaw);
 const burned=base.burnAddressRaw===null?null:BigInt(base.burnAddressRaw);
 const valid=burned!==null&&total>0n&&burned>=0n&&burned<=total;
 const precision=10n**80n;
 const pct=valid?Number((burned*100n*precision+total/2n)/total)/1e80:null;
 return {description:'Pinned Arc RPC: token supply and current zero/dead address holdings, not lifetime burns.',fields:{
  totalSupply:proof(base.totalSupply,'Arc RPC',{...details,method:'totalSupply()'},'ON_CHAIN'),
  circulatingSupply:NO('No positive contract-matched verified circulating supply for this Arc token.','CIRCULATION_NOT_VERIFIED'),
  burnAddressBalance:burned===null?NO('Pinned zero/dead address reads failed.','BURN_BALANCE_READ_FAILED'):
   proof(base.burnAddressBalance,'Arc RPC',{...details,method:'balanceOf(0x0,0xdead)'},'ON_CHAIN'),
  burnAddressPct:pct===null?NO('Cannot reconcile current burn-address custody to supply.','BURN_SHARE_UNAVAILABLE'):
   proof(pct,'Arc RPC',{...details,method:'burn balance / totalSupply()',scope:'Current address custody only, not total historical burn.'},'ON_CHAIN_DERIVED')
 }};
}
async function holders({address}={}){
 // Cryptographically signed COMPLETE snapshots always take precedence.
 // When none is available, a current explorer count may be shown, but
 // whale percentages remain NOT VERIFIED (never derived from a partial list).
 const signed=await require('./arc-holder-publication').load(address);
 if(signed.fields?.holderCount?.dataState==='DATA_FOUND')return signed;
 const reported=await require('./arc-holder-count').fetchCount(address);
 if(!reported)return signed;
 return {...signed,
  description:'Arc Blockscout current holder count; whale metrics require signed, reconciled COMPLETE publication.',
  fields:{...signed.fields,holderCount:reported}};
}
async function activity({address},cardId){
 const response=await marketFor(address);
 const keys=cardId==='liquidity'?['liquidityUsd','volume24h','dexPairCount','lpStatus']:
  ['priceUsd','valuation','change24h','volume24h'];
 return {description:'Exact Arc-chain token and returned DEX pairs only. Values are source-reported.',
  fields:Object.fromEntries(keys.map(k=>[k,response[k]||NO('Matching market evidence unavailable.')]))};
}
const IMPLEMENTATION='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
function addressWord(raw){
 return typeof raw==='string'&&/^0x[0-9a-f]{64}$/i.test(raw)&&
  !/^0{40}$/.test(raw.slice(-40))?'0x'+raw.slice(-40).toLowerCase():null;
}
async function mechanics({address,base}){
 const results=await Promise.allSettled([
  rpcClient.rpc('eth_call',[{to:address,data:'0x8da5cb5b'},base.block]),
  rpcClient.rpc('eth_getStorageAt',[address,IMPLEMENTATION,base.block])
 ]);
 const owner=results[0].status==='fulfilled'?addressWord(results[0].value):null;
 const implementation=results[1].status==='fulfilled'?addressWord(results[1].value):null;
 const context={address,block:base.block};
 return {description:'Read-only pinned-block observations; not a complete contract authority audit.',fields:{
  tradingTaxes:NO('Tax percentages need reviewed contract or exact-chain security evidence.','TAX_NOT_VERIFIED'),
  mintCapability:NO('Mint capability cannot be established from a generic getter.','MINT_NOT_VERIFIED'),
  ownerAdmin:owner?proof('owner() getter: '+owner,'Arc RPC',{...context,method:'owner()',scope:'Getter-reported; other roles may exist.'},'GETTER_REPORTED'):
   NO('No reliable owner or admin getter established.','OWNER_ADMIN_NOT_VERIFIED'),
  contractArchitecture:implementation?proof('EIP-1967 implementation: '+implementation,'Arc RPC',
   {...context,method:'EIP-1967 implementation slot',scope:'Upgrade authority remains independently unverified.'},'ON_CHAIN'):
   NO('EIP-1967 slot alone does not establish immutable or non-proxy architecture.','PROXY_NOT_VERIFIED')
 }};
}
async function inspectCard({base,address,cardId}){
 switch(cardId){
 case 'supply':return supply(base);
 case 'holders':return holders({address});
 case 'liquidity':case 'activity':return activity({address},cardId);
 case 'mechanics':return mechanics({address,base});
 default:throw Error('Invalid Arc card ID');
 }
}
const SEARCH=/^[\p{L}\p{N}\s.$_+\-&]{2,48}$/u;
async function discover({query}){
 if(typeof query!=='string')throw Error('Invalid search query');
 const normalized=query.normalize('NFKC').trim().replace(/\s+/g,' ');
 if(!SEARCH.test(normalized)||ADDRESS.test(normalized))throw Error('Invalid search query');
 const response=await fetch('https://api.dexscreener.com/latest/dex/search/?q='+encodeURIComponent(normalized),{
  headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw Error('Arc token discovery provider unavailable');
 const body=await readJson(response,2*1024*1024);
 if(!body||typeof body!=='object'||body.pairs!==null&&!Array.isArray(body.pairs))
  throw Error('Unexpected search provider response');
 const q=normalized.toLocaleLowerCase('en-US'),seen=new Set(),matches=[];
 for(const pair of Array.isArray(body.pairs)?body.pairs.slice(0,400):[]){
  if(pair?.chainId!==cfg.dexScreenerChainId)continue;
  for(const token of [pair.baseToken,pair.quoteToken]){
   const address=typeof token?.address==='string'?token.address.toLowerCase():'';
   const symbol=typeof token?.symbol==='string'?token.symbol.slice(0,30):'';
   const name=typeof token?.name==='string'?token.name.slice(0,90):'';
   if(!ADDRESS.test(address)||seen.has(address)||
    !(symbol.toLocaleLowerCase('en-US').includes(q)||name.toLocaleLowerCase('en-US').includes(q)))continue;
   seen.add(address);
   matches.push({network:cfg.id,chainId:cfg.chainId,address,name,symbol,
    source:'DexScreener',registryMatched:false,
    logoUrl:token===pair.baseToken?safeLogoUrl(pair.info?.imageUrl):null});
   if(matches.length===12)return matches;
  }
 }
 return matches;
}
module.exports={inspectToken,inspectCard,supply,holders,activity,mechanics,discover,addressWord,marketFor};
