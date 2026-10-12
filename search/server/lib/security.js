'use strict';
const {found,unknown}=require('./evidence');
const {ADDRESS}=require('./eth');
const {readJson}=require('./http');
const BASE='https://api.gopluslabs.io/api/v1/token_security/1';
const field=(name,reason)=>unknown(reason||'GoPlus has not provided an attributable security observation.',name.toUpperCase()+'_NOT_VERIFIED');
function parse(body,address){
 if(body?.code!==1&&body?.code!=='1')return {taxes:field('taxes','GoPlus did not confirm successful analysis.'),mint:field('mint','GoPlus did not confirm successful analysis.'),securityStatus:'SOURCE_FAILED'};
 const result=body?.result;
 if(!result||typeof result!=='object'||Array.isArray(result))return {taxes:field('taxes'),mint:field('mint'),securityStatus:'NOT_VERIFIED'};
 const raw=result[address.toLowerCase()]||result[address]||Object.entries(result).find(([key])=>key.toLowerCase()===address.toLowerCase())?.[1];
 if(!raw||typeof raw!=='object')return {taxes:field('taxes','No exact-contract Ethereum security report.'),mint:field('mint'),securityStatus:'NOT_VERIFIED'};
 const evidence=[{source:'GoPlus',network:'ethereum',chainId:1,contract:address.toLowerCase(),scope:'Third-party source-reported simulation/inspection. Not independently verified contract source or execution.'}];
 const taxKeys=['buy_tax','sell_tax','transfer_tax'];
 const taxValues=taxKeys.map(k=>{
   const v=raw[k];
   if(typeof v!=='string'&&typeof v!=='number')return null;
   const num=v===''?NaN:Number(v);
   return Number.isFinite(num)&&num>=0&&num<=1?Math.round(num*1000000)/10000:null;
 });
 const taxes=taxValues.every(x=>x!==null)
  ?found('Buy '+taxValues[0]+'% · Sell '+taxValues[1]+'% · Transfer '+taxValues[2]+'%','GoPlus',evidence,'SOURCE_REPORTED')
  :field('taxes','Complete contract-matched buy/sell/transfer security fee report unavailable.');
 const mint=raw.is_mintable==='1'?found('Source reports mint capability','GoPlus',evidence,'SOURCE_REPORTED')
  :raw.is_mintable==='0'?found('Source reports no mint capability detected','GoPlus',evidence,'SOURCE_REPORTED')
  :field('mint','No reliable mint-capability result from the source.');
 return {taxes,mint,securityStatus:'SOURCE_REPORTED',rawFlags:{
  hiddenOwner:raw.hidden_owner??null,
  ownerChangeBalance:raw.owner_change_balance??null,
  blacklist:raw.is_blacklisted??null,
  proxy:raw.is_proxy??null
 }};
}
async function inspect(address){
 if(!ADDRESS.test(address))return parse(null,address);
 try{
  const url=BASE+'?contract_addresses='+encodeURIComponent(address.toLowerCase());
  const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8500)});
  if(!response.ok)throw Error('Security source unavailable');
  return parse(await readJson(response,1024*1024),address);
 }catch{
  return {taxes:field('taxes','Security provider unavailable.'),mint:field('mint','Security provider unavailable.'),securityStatus:'SOURCE_API_FAILED'};
 }
}
module.exports={parse,inspect};
