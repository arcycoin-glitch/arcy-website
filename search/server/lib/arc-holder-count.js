'use strict';
// Blockscout current-count fallback, NEVER full whale distribution.
const {readJson}=require('./http');
const ADDRESS=/^0x[0-9a-f]{40}$/;
const DOMAIN='https://explorer.arc.io';
function parseCount(body){
 const raw=body?.token_holders_count??body?.holders_count;
 const n=(typeof raw==='number'?raw:typeof raw==='string'&&/^[1-9]\d*$/.test(raw)?Number(raw):NaN);
 return Number.isSafeInteger(n)&&n>0?n:null;
}
function reportedCount(count,address,checkedAt){
 const url=DOMAIN+'/api/v2/tokens/'+address+'/counters';
 return {value:count,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
  chainId:5042,network:'arc',source:'Arc Blockscout',
  evidence:[{sourceUrl:url,contract:address,chainId:5042,network:'arc',
   checkedAt,scope:'Current explorer-reported holder count only. Not a pinned-block enumeration, not complete whale balances.'}]};
}
async function fetchCount(address,{fetcher=fetch,now=Date.now()}={}){
 if(typeof address!=='string'||!ADDRESS.test(address))return null;
 const url=DOMAIN+'/api/v2/tokens/'+address+'/counters';
 try{
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
  if(!response.ok)return null;
  const body=await readJson(response,128*1024);
  const count=parseCount(body);
  return count===null?null:reportedCount(count,address,new Date(now).toISOString());
 }catch{return null}
}
module.exports={fetchCount,parseCount,reportedCount};
