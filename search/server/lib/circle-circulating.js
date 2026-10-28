'use strict';
// Circle publishes per-chain circulation; never substitute its global total.
const {unknown,found}=require('./evidence');
const reader=require('./source-request').createReader({ttlMs:60000,maxEntries:1});
const TOKEN='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const URL='https://api.circle.com/v1/stablecoins';
const IDENTITY='https://developers.circle.com/stablecoins/usdc-contract-addresses';
const METHODOLOGY='https://www.circle.com/blog/circle-api-update-stabilizing-usdc-supply-data';
function raw(value){
 if(typeof value!=='string'||value.length>90||!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))throw Error('INVALID_AMOUNT');
 const [whole,fraction='']=value.split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
}
function parse(body,{address,totalSupply,block,network='ethereum',chainId=1,now=Date.now()}={}){
 const fail=()=>unknown('Circle Ethereum publication is missing, stale, ambiguous or incompatible with this token scan.','CIRCLE_CIRCULATION_UNVERIFIED');
 if(network!=='ethereum'||chainId!==1||typeof address!=='string'||address.toLowerCase()!==TOKEN||!/^0x[0-9a-f]+$/i.test(block||''))return fail();
 try{
  const currencies=body?.data?.filter(x=>x?.symbol==='USDC');
  if(currencies?.length!==1||currencies[0].name!=='USD Coin')return fail();
  const rows=currencies[0].chains?.filter(x=>x?.chain==='ETH');
  if(rows?.length!==1)return fail();
  const row=rows[0],published=Date.parse(row.updateDate);
  if(typeof row.updateDate!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(row.updateDate)||!Number.isFinite(published)||!Number.isFinite(now)||published>now+60000||now-published>86400000)return fail();
  const amount=raw(row.amount),total=raw(totalSupply);
  if(amount<=0n||total<=0n||amount>=(1n<<256n)||total>=(1n<<256n))return fail();
  const field=found(row.amount,'Circle issuer Ethereum USDC circulation',[{
   address:TOKEN,chainId:1,network:'ethereum',sourceUrl:URL,identitySourceUrl:IDENTITY,methodologySourceUrl:METHODOLOGY,
   sourceAsOf:row.updateDate,sourceChain:'ETH',rpcComparisonBlock:block,rpcTotalSupplyRaw:total.toString(),issuerMinusRpcRaw:(amount-total).toString(),decimals:6,
   method:'Circle USDC ETH publication mapped to Circle-listed Ethereum mainnet contract; separate pinned totalSupply observation',
   scope:'Issuer-reported Ethereum circulation at sourceAsOf, not on-chain circulating supply at the scan block. RPC total supply is a different-time observation, not independent proof of circulation; mint/redemption may make it lower or higher. No global-chain totals or derived burn exclusions.'
  }],'SOURCE_REPORTED',now);
  field.freshness={state:'SOURCE_REPORTED',observedAt:row.updateDate,sourceAsOf:row.updateDate,retrievedAt:new Date(now).toISOString(),ageMs:Math.max(0,now-published),basis:'Circle publication time; not the RPC analysis block.'};
  return field;
 }catch{return fail();}
}
async function inspect(address,totalSupply,options={}){
 if(typeof address!=='string'||address.toLowerCase()!==TOKEN)return null;
 if(options.network!==undefined&&options.network!=='ethereum'||options.chainId!==undefined&&options.chainId!==1)return unknown('Circle mapping is Ethereum-specific.','SOURCE_CHAIN_MISMATCH');
 try{
  const body=await reader.json(URL,{fetcher:options.fetcher||global.fetch,timeoutMs:2500,maxBytes:128*1024,validate:d=>Array.isArray(d?.data)});
  return parse(body,{...options,address,totalSupply});
 }catch{return {...unknown('Circle circulation source failed; no value inferred.','CIRCLE_CIRCULATION_SOURCE_FAILED'),dataState:'SOURCE_API_FAILED'};}
}
module.exports={parse,inspect,raw,TOKEN,URL};
