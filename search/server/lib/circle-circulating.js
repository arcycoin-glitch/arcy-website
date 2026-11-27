'use strict';
// Circle publishes per-chain circulation; never substitute its global total.
const {unknown,found}=require('./evidence');
const reader=require('./source-request').createReader({ttlMs:60000,maxEntries:1});
const TOKEN='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const URL='https://api.circle.com/v1/stablecoins';
const IDENTITY='https://developers.circle.com/stablecoins/usdc-contract-addresses';
const EURC_IDENTITY='https://developers.circle.com/stablecoins/eurc-contract-addresses';
const METHODOLOGY='https://www.circle.com/blog/circle-api-update-stabilizing-usdc-supply-data';
// Exact reviewed mappings: (network, chainId, contract) -> one Circle currency row and one Circle chain code.
// Identity: Circle's own contract-address tables (mainnet section), re-read by scripts/probe-issuer-circulation.cjs
// in CI run 45973.. (#335) together with eth_chainId, symbol() and decimals() at a pinned block on each chain.
const MAPPINGS=Object.freeze([
 {symbol:'USDC',name:'USD Coin',chain:'ETH',network:'ethereum',chainId:1,address:TOKEN,identity:IDENTITY},
 {symbol:'EURC',name:'Euro Coin',chain:'ETH',network:'ethereum',chainId:1,address:'0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',identity:EURC_IDENTITY},
 {symbol:'USDC',name:'USD Coin',chain:'ARC',network:'arc',chainId:5042,address:'0x3600000000000000000000000000000000000000',identity:IDENTITY},
 {symbol:'EURC',name:'Euro Coin',chain:'ARC',network:'arc',chainId:5042,address:'0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1',identity:EURC_IDENTITY}
].map(Object.freeze));
const mappingFor=(address,network,chainId)=>MAPPINGS.find(m=>typeof address==='string'&&address.toLowerCase()===m.address&&m.network===network&&m.chainId===chainId)||null;
const knownAddress=address=>typeof address==='string'&&MAPPINGS.some(m=>m.address===address.toLowerCase());
function raw(value){
 if(typeof value!=='string'||value.length>90||!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))throw Error('INVALID_AMOUNT');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
}
function parse(body,{address,totalSupply,block,network='ethereum',chainId=1,now=Date.now()}={}){
 const fail=()=>unknown('Circle per-chain publication is missing, stale, ambiguous or incompatible with this token scan.','CIRCLE_CIRCULATION_UNVERIFIED');
 const map=mappingFor(address,network,chainId);
 if(!map||!/^0x[0-9a-f]+$/i.test(block||''))return fail();
 try{
  const currencies=body?.data?.filter(x=>x?.symbol===map.symbol);
  if(currencies?.length!==1||currencies[0].name!==map.name)return fail();
  const rows=currencies[0].chains?.filter(x=>x?.chain===map.chain);
  if(rows?.length!==1)return fail();
  const row=rows[0],published=Date.parse(row.updateDate);
  if(typeof row.updateDate!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(row.updateDate)||!Number.isFinite(published)||!Number.isFinite(now)||published>now+60000||now-published>86400000)return fail();
  const amount=raw(row.amount),total=raw(totalSupply);
  if(amount<=0n||total<=0n||amount>=(1n<<256n)||total>=(1n<<256n))return fail();
  const label=map.network==='arc'?'Arc':'Ethereum';
  const field=found(row.amount,'Circle issuer '+label+' '+map.symbol+' circulation',[{
   address:map.address,chainId:map.chainId,network:map.network,sourceUrl:URL,identitySourceUrl:map.identity,methodologySourceUrl:METHODOLOGY,
   sourceAsOf:row.updateDate,sourceChain:map.chain,rpcComparisonBlock:block,rpcTotalSupplyRaw:total.toString(),issuerMinusRpcRaw:(amount-total).toString(),decimals:6,
   method:'Circle '+map.symbol+' '+map.chain+' publication mapped to the Circle-listed '+label+' mainnet contract; separate pinned totalSupply observation',
   scope:'Issuer-reported '+label+' circulation at sourceAsOf, not on-chain circulating supply at the scan block. RPC total supply is a different-time observation, not independent proof of circulation; mint/redemption or issuer-held pre-mint may make it lower or higher. No global-chain totals or derived burn exclusions.'
  }],'SOURCE_REPORTED',now);
  field.freshness={state:'SOURCE_REPORTED',observedAt:row.updateDate,sourceAsOf:row.updateDate,retrievedAt:new Date(now).toISOString(),ageMs:Math.max(0,now-published),basis:'Circle publication time; not the RPC analysis block.'};
  return field;
 }catch{return fail();}
}
async function inspect(address,totalSupply,options={}){
 if(!knownAddress(address))return null;
 const network=options.network??'ethereum',chainId=options.chainId??(network==='arc'?5042:1);
 if(!mappingFor(address,network,chainId))return unknown('Circle mapping is chain-specific; this contract is not mapped on this chain.','SOURCE_CHAIN_MISMATCH');
 options={...options,network,chainId};
 try{
  const body=await reader.json(URL,{fetcher:options.fetcher||global.fetch,timeoutMs:2500,maxBytes:128*1024,validate:d=>Array.isArray(d?.data)});
  return parse(body,{...options,address,totalSupply});
 }catch{return {...unknown('Circle circulation source failed; no value inferred.','CIRCLE_CIRCULATION_SOURCE_FAILED'),dataState:'SOURCE_API_FAILED'};}
}
module.exports={parse,inspect,raw,TOKEN,URL,MAPPINGS};
