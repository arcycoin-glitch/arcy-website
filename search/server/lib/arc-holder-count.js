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
const AX='https://arcexplorer.org';
async function fetchAXCount(address,{fetcher,now}){
 // Independent A/X fallback: verify chain ID and exact token identity before
 // accepting the indexer's reported count. No wallet ranking is inferred.
 const request=async url=>{
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(2000)});
  if(!response.ok)throw Error('A/X explorer unavailable');
  return readJson(response,128*1024);
 };
 try{
  const stats=await request(AX+'/api/v1/stats');
  if(stats?.chainId!==5042)return null;
  const token=address.toLowerCase();
  const metadata=await request(AX+'/api/v1/tokens/'+token);
  if(String(metadata?.address||'').toLowerCase()!==token||
    (metadata.chainId!==undefined&&metadata.chainId!==5042))return null;
  const sourceUrl=AX+'/api/v1/tokens/'+token+'/holders?limit=1&offset=0';
  const page=await request(sourceUrl);
  const count=page?.total;
  if(!Number.isSafeInteger(count)||count<=0||!Array.isArray(page.items)||
    page.items.length!==1||!ADDRESS.test(page.items[0]?.address||''))return null;
  return {value:count,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
   chainId:5042,network:'arc',source:'A/X Explorer',
   evidence:[{sourceUrl,contract:token,chainId:5042,network:'arc',
    chainProof:AX+'/api/v1/stats',tokenProof:AX+'/api/v1/tokens/'+token,
    checkedAt:new Date(now).toISOString(),
    scope:'Current A/X indexer-reported holder count only. Chain and contract identity checked; not a pinned wallet census or verified whale distribution.'}]};
 }catch{return null}
}
async function fetchCount(address,{fetcher=fetch,now=Date.now()}={}){
 if(typeof address!=='string'||!ADDRESS.test(address))return null;
 const token=address.toLowerCase();
 const url=DOMAIN+'/api/v2/tokens/'+token+'/counters';
 try{
  const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(6500)});
  if(response.ok){
   const body=await readJson(response,128*1024);
   const count=parseCount(body);
   if(count!==null)return reportedCount(count,token,new Date(now).toISOString());
  }
 }catch{}
 return fetchAXCount(token,{fetcher,now});
}
module.exports={fetchCount,fetchAXCount,parseCount,reportedCount};
