'use strict';
// Exact-contract source-backed market observations. Oracle prices are reference
// readings, never evidence of DEX liquidity or trade execution.
const pending=require('./market-pending');
const dex=require('./dex-market');
const oracle=require('./oracle-market');
function parse(body,address){return {fields:dex.parseMarket(body,'ethereum',address.toLowerCase()).fields}}
async function inspect(address,block,{dexInspect=dex.inspect,oracleInspect=oracle.inspect}={}){
 if(typeof address!=='string')return pending.card();
 // Independent reads start concurrently: a slow or unavailable DEX provider
 // cannot postpone an otherwise verifiable on-chain Chainlink price.
 const dexPromise=Promise.resolve().then(()=>dexInspect('ethereum',address)).catch(()=>null);
 const oraclePromise=Promise.resolve().then(()=>oracleInspect(address,block)).catch(()=>null);
 const dexFields=await dexPromise;
 const fields=dexFields&&typeof dexFields==='object'?{...dexFields}:{...pending.card().fields};
 // Verified DEX prices should not be delayed by a secondary RPC feed.
 if(fields.priceUsd?.dataState!=='DATA_FOUND'){
  const oracleResult=await oraclePromise;
  if(oracleResult?.priceUsd?.dataState==='DATA_FOUND')
   fields.priceUsd=oracleResult.priceUsd;
 }
 return {fields,description:'Ethereum market evidence is exact-contract scoped. Chainlink reference prices are on-chain USD observations; DEX activity remains unavailable unless its source is approved.'};
}
function failure(){return pending.card()}
module.exports={parse,inspect,failure};
