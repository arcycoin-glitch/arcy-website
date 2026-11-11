'use strict';
// Feature-flagged Search baseline token inspection routing. All data from a single
// token snapshot must stay on ONE chain-checked provider; never interleave RPCs.
// This module records provider HEALTH, never "verified" token data.
const crypto=require('node:crypto');
const watchdog=require('../../../lib/verification/provider-watchdog');
const ledger=require('../../../lib/verification/provider-watchdog-ledger');
const chains=require('./chains');
const FLAG='ARC_AUTONOMY_WATCHDOG_SEARCH_ENABLED';
const fail=code=>Object.assign(Error(code),{code});
const statusCode=error=>Number.isInteger(error?.httpStatus)?error.httpStatus:null;
const RATE_CODES=new Set([-32005,-32016,-32029]);
const slug=(endpoint,index)=>{
 const digest=crypto.createHash('sha256').update(endpoint).digest('hex').slice(0,16);
 return 'search-'+(index===0?'primary':'fallback'+index)+'-'+digest;
};
function enabled(env=process.env){return env[FLAG]==='1';}
function classify(error){
 const http=statusCode(error);
 if(http===429||RATE_CODES.has(error?.rpcCode))return watchdog.FAILURE_KINDS.RATE_LIMIT;
 if(error?.code==='SEARCH_PROVIDER_WRONG_CHAIN'||error?.message==='RPC chain ID mismatch')
  return watchdog.FAILURE_KINDS.WRONG_CHAIN;
 if(error?.code==='SEARCH_PROVIDER_MALFORMED'||/^(Malformed (Arc|Robinhood) block|(Arc|Robinhood) RPC invalid response)$/.test(error?.message||'')&&error?.rpcCode===undefined)
  return watchdog.FAILURE_KINDS.MALFORMED;
 if(error?.name==='TimeoutError'||error?.name==='AbortError'||error?.timeout===true)
  return watchdog.FAILURE_KINDS.TIMEOUT;
 if(error?.name==='TypeError')return watchdog.FAILURE_KINDS.TRANSPORT;
 if(error?.retryable===true)return watchdog.FAILURE_KINDS.PROVIDER_ERROR;
 return null;
}
function canTryNext(error){return classify(error)!==null;}
async function probe({network,endpoint,read}){
 const id=await read(endpoint,'eth_chainId',[]);
 try{chains.verifyChainId(network,id);}
 catch{throw fail('SEARCH_PROVIDER_WRONG_CHAIN');}
 const block=await read(endpoint,'eth_blockNumber',[]);
 if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block)||BigInt(block)<0n)
  throw fail('SEARCH_PROVIDER_MALFORMED');
}
async function route({network,endpoints,inspect,read,env=process.env,now=Date.now}={}){
 if(!enabled(env))throw fail('SEARCH_WATCHDOG_FLAG_OFF');
 if(!Array.isArray(endpoints)||!endpoints.length||endpoints.some(x=>typeof x!=='string')||
  typeof inspect!=='function'||typeof read!=='function'||typeof now!=='function')
  throw fail('SEARCH_WATCHDOG_INVALID_ROUTING');
 chains.chain(network);
 const ids=endpoints.map(slug);
 // Never silently fall back to volatile in-memory state when persistence fails.
 ledger.fileFor(network,ids[0],env);
 let lastFailure=null,attempted=0;
 for(let index=0;index<endpoints.length;index++){
  const endpoint=endpoints[index],providerId=ids[index];
  const prior=await ledger.read(network,providerId,{env});
  const eligibility=watchdog.eligibility(prior.state,now());
  if(eligibility.mode==='SKIP')continue;
  const recovering=eligibility.mode==='PROBE';
  const started=now();
  try{
   if(recovering){
    await probe({network,endpoint,read});
    await ledger.transition(network,providerId,{
     kind:'SUCCESS',reason:'RECOVERY_PROBE_OK',at:now(),
     latencyMs:Math.max(0,now()-started),expectedRevision:prior.revision
    },{env});
    // Even the SECOND successful probe must not expose data on this request.
    continue;
   }
   attempted++;
   // inspect() must verify eth_chainId and pin all subsequent calls to one block
   // and one endpoint. Existing Arc/Robinhood inspectAt() already does both.
   const result=await inspect(endpoint);
   await ledger.transition(network,providerId,{
    kind:'SUCCESS',reason:index===0?'SUCCESS':'FALLBACK_USED',at:now(),
    latencyMs:Math.max(0,now()-started),expectedRevision:prior.revision
   },{env});
   return result;
  }catch(error){
   const kind=classify(error);
   if(kind===null)throw error; // Contract revert/invalid token is not a provider outage.
   // A stale concurrent writer or corrupt ledger must NEVER be silently bypassed.
   await ledger.transition(network,providerId,{
    kind,httpStatus:statusCode(error)===429?429:null,retryAfterMs:error.retryAfterMs??0,
    at:now(),expectedRevision:prior.revision
   },{env});
   lastFailure=error;
  }
 }
 const failure=fail('SEARCH_WATCHDOG_PROVIDER_UNAVAILABLE');
 failure.causeCode=lastFailure?.code||null;
 failure.attempted=attempted;
 throw failure;
}
module.exports={FLAG,enabled,slug,classify,canTryNext,probe,route};
