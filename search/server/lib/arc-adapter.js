'use strict';
// Arc mainnet read-only intelligence adapter. Unsupported assertions fail closed.
// Do not confuse this lightweight lab adapter with the production durable holder worker.
const {chain}=require('./chains');
const {ADDRESS}=require('./eth');
const rpcClient=require('./arc-rpc');
const market=require('./arc-market');
const original=require('./arc-legacy-evidence');
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
async function supply(base){
 const details={address:base.address,block:base.block,method:'pinned ERC-20 calls'};
 const total=BigInt(base.totalSupplyRaw);
 const burned=base.burnAddressRaw===null?null:BigInt(base.burnAddressRaw);
 const valid=burned!==null&&total>0n&&burned>=0n&&burned<=total;
 const precision=10n**80n;
 const pct=valid?Number((burned*100n*precision+total/2n)/total)/1e80:null;
 let circ=NO('Circulating supply needs a contract-matched verified source. Total supply is not circulating supply.','CIRCULATION_NOT_VERIFIED');
 try{
  const legacy=await original.callOriginal('market',base.address);
  const verified=original.circulation(legacy,base.address);
  if(verified.dataState==='DATA_FOUND')circ=verified;
 }catch{} // Preserve pinned Arc supply when a separate market provider fails.
 return {description:'Pinned Arc RPC; circulating supply remains unverified because total supply is not circulating supply.',fields:{
  totalSupply:proof(base.totalSupply,'Arc RPC',{...details,method:'totalSupply()'},'ON_CHAIN'),
  circulatingSupply:circ,
  burnAddressBalance:burned===null?NO('Pinned zero/dead address reads failed.','BURN_BALANCE_READ_FAILED'):
   proof(base.burnAddressBalance,'Arc RPC',{...details,method:'balanceOf(0x0,0xdead)'},'ON_CHAIN'),
  burnAddressPct:pct===null?NO('Cannot reconcile current burn-address custody to supply.','BURN_SHARE_UNAVAILABLE'):
   proof(pct,'Arc RPC',{...details,method:'burn balance / totalSupply()',scope:'Current address custody only, not total historical burn.'},'ON_CHAIN_DERIVED')
 }};
}
async function holders({address}={}){
 const signed=await require('./arc-holder-publication').load(address);
 if(signed.fields?.holderCount?.dataState==='DATA_FOUND')return signed;
 // Preserve the original site's durable COMPLETE Arc holder worker/read path.
 const prior=await original.callOriginal('holders',address,{action:'published'}).then(data=>({
  fields:original.holders(data,address),completedAt:data.snapshot?.completedAt||null
 })).catch(()=>null);
 if(prior&&Object.values(prior.fields).some(v=>v.dataState==='DATA_FOUND'))
  return {description:'Original Arc reconciled COMPLETE holder snapshot as of '+
   prior.completedAt+'. Historical evidence, not current wallet-balance proof. Publication signature is not asserted.',
   fields:prior.fields};
 // Explorer-reported count is separately sourced, never presented as full whale proof.
 const reported=await require('./arc-holder-count').fetchCount(address);
 if(reported)return {...signed,
  description:'Arc Blockscout current holder count; whale metrics require signed, reconciled COMPLETE publication.',
  fields:{...signed.fields,holderCount:reported}};
 // Arc Blockscout can return 403. GoPlus explicitly supports chain 5042,
 // but its limited ranked sample must NEVER be called an on-chain verified census.
 const detected=await require('./goplus-evidence').inspectHolders('arc',address);
 const backed=Object.fromEntries(Object.entries(detected).filter(([,f])=>f.dataState==='DATA_FOUND'));
 if(!Object.keys(backed).length)return signed;
 return {...signed,
  description:'GoPlus exact-contract Arc holder count and limited ranked sample; source-reported, not complete pinned-wallet proof.',
  fields:{...signed.fields,...backed}};
}
async function activity({address},cardId){
 const keys=cardId==='liquidity'?['liquidityUsd','volume24h','dexPairCount','lpStatus']:
  ['priceUsd','valuation','change24h','volume24h'];
 let restored={};
 try{
  const route=cardId==='liquidity'?'liquidity':'activity';
  const legacy=await original.callOriginal(route,address,cardId==='liquidity'?{summary:'1'}:{});
  const from=legacy.fields||{};
  const mapping=cardId==='liquidity'?{
   liquidityUsd:'liquidityUsd',volume24h:'volume24h',dexPairCount:'pairCount',lpStatus:'lpStatus'
  }:{priceUsd:'priceUsd',valuation:'valuation',change24h:'change24h',volume24h:'volume24h'};
  restored=Object.fromEntries(keys.map(k=>[k,original.sourceField(from[mapping[k]],address,
   'Existing Arc SEARCH exact-contract '+route+' evidence; source-reported, not independently audited.')]));
 }catch{} // The original Arc endpoints are optional; never poison all cards on a source outage.
 const fallback=await marketFor(address);
 const fields=Object.fromEntries(keys.map(k=>[k,
  restored[k]?.dataState==='DATA_FOUND'?restored[k]:
  fallback[k]||NO('Exact-contract evidence unavailable.','MARKET_SOURCE_NOT_VERIFIED')]));
 return {description:'Restored original Arc SEARCH source-backed '+cardId+
  ' evidence. Provider timestamps and pool scope remain source-reported.',fields};
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
 const preliminary={
  tradingTaxes:NO('Taxes need source-reviewed contract getter or exact-chain security evidence.','TAX_NOT_VERIFIED'),
  mintCapability:NO('A generic getter cannot establish mint privileges.','MINT_NOT_VERIFIED'),
  ownerAdmin:owner?proof('owner() getter: '+owner,'Arc RPC',
   {...context,method:'owner()',scope:'Getter-reported; other roles may exist.'},'GETTER_REPORTED'):
   NO('No reliable owner or admin getter established.','OWNER_ADMIN_NOT_VERIFIED'),
  contractArchitecture:implementation?proof('EIP-1967 implementation: '+implementation,'Arc RPC',
   {...context,method:'EIP-1967 implementation slot',
    scope:'Observed implementation only; upgrade authority separately unverified.'},'ON_CHAIN'):
   NO('EIP-1967 slot alone does not establish immutable or non-proxy architecture.','PROXY_NOT_VERIFIED')
 };
 let fields=preliminary;
 try{
  const legacy=await original.callOriginal('mechanics',address);
  const past=original.contract(legacy,address);
  fields=Object.fromEntries(Object.entries(preliminary).map(([key,value])=>[
   key,past[key]?.dataState==='DATA_FOUND'?past[key]:value
  ]));
 }catch{} // Keep safe on-chain getter observations if legacy mechanics source times out.
 if(Object.values(fields).some(f=>f.dataState!=='DATA_FOUND')){
  const detected=await require('./goplus-evidence').inspect('arc',address);
  const isARCY=address==='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
  fields=Object.fromEntries(Object.entries(fields).map(([key,existing])=>[
   key,existing.dataState==='DATA_FOUND'?existing:
    // GoPlus currently reports 0% taxes for ARCY, contrary to the project's
    // reviewed 3%/3% source. Never silently overwrite with conflicting claims.
    isARCY&&key==='tradingTaxes'?existing:
    detected[key]?.dataState==='DATA_FOUND'?detected[key]:existing
  ]));
 }
 return {description:'Verified Arc contract mechanics with pinned-RPC/GoPlus-source fallback; external detection never overrides stronger first-party evidence.',fields};
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
 return [];
}
module.exports={inspectToken,inspectCard,supply,holders,activity,mechanics,discover,addressWord,marketFor};
