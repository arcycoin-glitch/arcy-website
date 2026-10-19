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
 const [dexResult,oracleResult]=await Promise.allSettled([
  dexInspect('ethereum',address),
  oracleInspect(address,block)
 ]);
 const fields=dexResult.status==='fulfilled'&&dexResult.value&&typeof dexResult.value==='object'?
  {...dexResult.value}:{...pending.card().fields};
 if(fields.priceUsd?.dataState!=='DATA_FOUND'&&
    oracleResult.status==='fulfilled'&&oracleResult.value?.priceUsd?.dataState==='DATA_FOUND')
  fields.priceUsd=oracleResult.value.priceUsd;
 return {fields,description:'Ethereum market evidence is exact-contract scoped. Chainlink reference prices are on-chain USD observations; DEX activity remains unavailable unless its source is approved.'};
}
function failure(){return pending.card()}
module.exports={parse,inspect,failure};
