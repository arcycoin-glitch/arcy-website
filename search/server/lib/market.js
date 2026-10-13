'use strict';
// Market figures are compact, sourced DEX Screener readings, not valuations
// invented from supply. Provider limits and pair scope remain explicit.
const pending=require('./market-pending');
const dex=require('./dex-market');
function parse(body,address){return {fields:dex.parseMarket(body,'ethereum',address.toLowerCase()).fields}}
async function inspect(address,block){
 if(typeof address!=='string')return pending.card();
 const fields=await dex.inspect('ethereum',address);
 // Exact-contract Chainlink reference feeds are a free on-chain fallback for
 // canonical Ethereum WETH and USDC when DEX market access is unavailable.
 // This fills only the existing price field; it is not DEX volume/liquidity or
 // market-cap evidence.
 if(fields?.priceUsd?.dataState!=='DATA_FOUND'){
  try{
   const reference=await require('./oracle-market').inspect(address,block);
   if(reference?.priceUsd?.dataState==='DATA_FOUND')fields.priceUsd=reference.priceUsd;
  }catch{} // Preserve the existing fail-closed state if the feed cannot be read.
 }
 return {fields,description:'Ethereum market evidence is exact-contract scoped. Chainlink reference prices are on-chain USD observations; DEX activity remains unavailable unless its source is approved.'};
}
function failure(){return pending.card()}
module.exports={parse,inspect,failure};
