'use strict';
// Exact Robinhood contract holder COUNT only. A REST count does not establish
// historical holder concentration, wallet safety or complete transfer coverage.
const {readJson}=require('./http');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const PUBLIC='https://robinhoodchain.blockscout.com/api/v2/tokens/';
const PRO='https://api.blockscout.com/4663/api/v2/tokens/';
const API_KEY=/^proapi_[A-Za-z0-9_-]{8,120}$/;
function parseCount(body){
 const count=body?.token_holders_count??body?.holders_count;
 const n=typeof count==='number'?count:typeof count==='string'&&/^[1-9]\d*$/.test(count)?Number(count):NaN;
 return Number.isSafeInteger(n)&&n>0?n:null;
}
async function fetchCount(address,{fetcher=fetch,key=process.env.BLOCKSCOUT_API_KEY,now=Date.now()}={}){
 if(typeof address!=='string'||!ADDRESS.test(address))return null;
 const endpoints=[{url:PUBLIC+address+'/counters',provider:'Robinhood Blockscout'}];
 // This credential never enters a public URL, browser field or source annotation.
 if(typeof key==='string'&&API_KEY.test(key)){
  const rest=new URL(PRO+address+'/counters');
  rest.searchParams.set('apikey',key);
  endpoints.push({url:rest.href,provider:'Blockscout PRO Robinhood'});
 }
 for(const {url,provider} of endpoints){
  try{
   const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6800)});
   if(!response.ok)continue;
   const count=parseCount(await readJson(response,128*1024));
   if(count===null)continue;
   const clean=url.replace(/[?].*$/,'');
   return {value:count,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
    network:'robinhood',chainId:4663,source:provider,
    evidence:[{network:'robinhood',chainId:4663,contract:address,sourceUrl:clean,
     checkedAt:new Date(now).toISOString(),
     scope:'Current Blockscout-reported token holder count only. No complete pinned wallet ranking.'}]};
  }catch{}
 }
 return null;
}
module.exports={fetchCount,parseCount};
