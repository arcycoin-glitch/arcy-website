'use strict';
// Market figures are compact, sourced DEX Screener readings, not valuations
// invented from supply. Provider limits and pair scope remain explicit.
const pending=require('./market-pending');
const dex=require('./dex-market');
function parse(body,address){return {fields:dex.parseMarket(body,'ethereum',address.toLowerCase()).fields}}
async function inspect(address){
 if(typeof address!=='string')return pending.card();
 const fields=await dex.inspect('ethereum',address);
 return {fields,description:'DEX Screener source-reported, Ethereum contract-matched pools (up to 30). LP lock and total market coverage are not established.'};
}
function failure(){return pending.card()}
module.exports={parse,inspect,failure};
