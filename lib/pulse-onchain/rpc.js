'use strict';
// Pulse V2 on-chain transport: read-only, budgeted, chain-checked JSON-RPC.
// - Only the methods below can be sent; nothing here can sign or submit a transaction.
// - Every scan owns ONE budget (calls + wall clock). Exhaustion is an explicit error, never an empty result.
// - A fallback provider is used only after it reports the expected chain ID.
// - Range / result-cap answers are surfaced as ONCHAIN_RANGE_LIMIT so the caller can narrow the window
//   instead of treating a refused query as "no logs".
const {rpcUrl}=require('../../search/server/lib/chains');
const crypto=require('node:crypto');
const watchdog=require('../verification/provider-watchdog');
const watchdogLedger=require('../verification/provider-watchdog-ledger');
const {NETWORKS}=require('../verification/metric-evidence');
const {transientRpcError}=require('../../search/server/lib/rpc-errors');
const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs','eth_call','eth_getStorageAt']);
const RANGE=/block range|ranges? over|range.*(?:large|limit|exceed|wide)|too many (?:logs|results|blocks)|query returned more|exceeds? (?:the )?(?:max|limit|range)|limited to \d|response size/i;
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});
// Provider text is diagnostic only: URLs and long opaque strings (possible credentials) are removed before it is reported.
const sanitize=m=>String(m||'').replace(/https?:\/\/[^\s"']+/gi,'[url]').replace(/\b(?!0x)[A-Za-z0-9_-]{32,}\b/g,'[redacted]').replace(/[^\x20-\x7e]/g,' ').slice(0,140);

// Same endpoints the existing read paths already use. No new provider is introduced here.
function endpoints(chain,env=process.env){
 if(chain==='arc')return require('../../search/server/lib/arc-rpc').providers(env);
 if(chain==='robinhood')return require('../../search/server/lib/robinhood-rpc').providers(env);
 if(chain==='ethereum'){
  const primary=rpcUrl('ethereum',env);
  // Ethereum historically has one provider. An independent fallback is opt-in,
  // never silently introduced and never used while watchdog routing is OFF.
  if(env.ARC_AUTONOMY_WATCHDOG_RPC_ENABLED!=='1'||!env.ETH_RPC_FALLBACK_URL||env.ETH_RPC_FALLBACK_URL==='disabled')return [primary];
  const fallback=rpcUrl('ethereum',{...env,ETH_RPC_URL:env.ETH_RPC_FALLBACK_URL});
  return fallback===primary?[primary]:[primary,fallback];
 }
 throw fail('INVALID_PULSE_CHAIN');
}

async function readBody(response,maxBytes){
 if(response.body&&typeof response.body.getReader==='function'){
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>maxBytes){try{await reader.cancel();}catch{}throw fail('ONCHAIN_RANGE_LIMIT',{detail:'RESPONSE_TOO_LARGE'});}
   chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks,size).toString('utf8');
 }
 const text=await response.text();
 if(Buffer.byteLength(text)>maxBytes)throw fail('ONCHAIN_RANGE_LIMIT',{detail:'RESPONSE_TOO_LARGE'});
 return text;
}

// Provider identifiers are stable across restarts but never include endpoint URLs or keys.
function providerId(url,index){
 const digest=crypto.createHash('sha256').update(url).digest('hex').slice(0,16);
 return 'pulse-'+(index===0?'primary':'fallback'+index)+'-'+digest;
}
function failureKind(error){
 if(error?.code==='ONCHAIN_CHAIN_ID_MISMATCH')return watchdog.FAILURE_KINDS.WRONG_CHAIN;
 if(error?.code==='ONCHAIN_MALFORMED_RESPONSE')return watchdog.FAILURE_KINDS.MALFORMED;
 if(error?.httpStatus===429||error?.code==='ONCHAIN_RATE_LIMITED')return watchdog.FAILURE_KINDS.RATE_LIMIT;
 if(error?.timeout||['TimeoutError','AbortError'].includes(error?.name))return watchdog.FAILURE_KINDS.TIMEOUT;
 if(error?.code==='ONCHAIN_TRANSPORT_FAILED')return watchdog.FAILURE_KINDS.TRANSPORT;
 return watchdog.FAILURE_KINDS.PROVIDER_ERROR;
}
function providerFault(error){
 return Boolean(error?.retryable)&&!['ONCHAIN_RANGE_LIMIT','ONCHAIN_RPC_BUDGET_EXHAUSTED','ONCHAIN_DEADLINE_EXCEEDED'].includes(error.code);
}
function create({chainId,urls,fetcher=fetch,maxCalls=40,deadlineAt=Date.now()+8000,timeoutMs=6000,maxBytes=4*1024*1024,now=Date.now,batch:useBatch=true,paceMs=0,concurrency=4,sleep=ms=>new Promise(r=>setTimeout(r,ms)),env=process.env}={}){
 if(!Number.isSafeInteger(chainId)||!Array.isArray(urls)||!urls.length)throw fail('ONCHAIN_RPC_NOT_CONFIGURED');
 const cost={rpcCalls:0,httpRequests:0,byMethod:{},failovers:0,providerErrors:[]};
 const verified=new Set(),noBatch=new Set(useBatch?[]:urls.map((_,i)=>i));let active=0,nextId=0,lastSentAt=0;
 const enabled=env.ARC_AUTONOMY_WATCHDOG_RPC_ENABLED==='1';
 const network=Object.keys(NETWORKS).find(k=>NETWORKS[k]===chainId);
 if(enabled&&!network)throw fail('ONCHAIN_WATCHDOG_NETWORK_UNSUPPORTED');
 const identities=enabled?urls.map((url,i)=>providerId(url,i)):[];
 // Fail closed if durability is absent. The flag is off by default everywhere.
 if(enabled)watchdogLedger.fileFor(network,identities[0],env);

 async function post(url,calls){
  // Provider pacing: public endpoints rate-limit bursts, not block spans.
  if(paceMs>0){const wait=lastSentAt+paceMs-now();if(wait>0){if(wait>=deadlineAt-now())throw fail('ONCHAIN_DEADLINE_EXCEEDED');await sleep(wait);}}
  const remaining=deadlineAt-now();
  if(remaining<=50)throw fail('ONCHAIN_DEADLINE_EXCEEDED');
  lastSentAt=now();
  const payload=calls.map(c=>({jsonrpc:'2.0',id:++nextId,method:c.method,params:c.params}));
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,remaining));
  cost.httpRequests++;cost.rpcCalls+=calls.length;
  for(const c of calls)cost.byMethod[c.method]=(cost.byMethod[c.method]||0)+1;
  let text,status;
  try{
   const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload.length===1?payload[0]:payload),signal:controller.signal});
   status=response.status;
   text=await readBody(response,maxBytes);
  }catch(error){
   if(error?.code==='ONCHAIN_RANGE_LIMIT')throw error;
   throw fail('ONCHAIN_TRANSPORT_FAILED',{retryable:true,timeout:controller.signal.aborted});
  }finally{clearTimeout(timer);}
  let body;try{body=JSON.parse(text);}catch{body=null;}
  if(status<200||status>=300){
   const message=String(body?.error?.message||(Array.isArray(body)?body[0]?.error?.message:'')||(typeof body?.error==='string'?body.error:'')||body?.message||(body?'':text)||'').slice(0,300);
   if([400,403,413].includes(status)&&RANGE.test(message))throw fail('ONCHAIN_RANGE_LIMIT',{httpStatus:status,detail:sanitize(message)});
   throw fail('ONCHAIN_HTTP_'+status,{httpStatus:status,detail:sanitize(message),retryable:status===403||status===408||status===429||status>=500});
  }
  // Some providers answer a whole batch with one error object.
  if(payload.length>1&&!Array.isArray(body)){
   if(RANGE.test(String(body?.error?.message||'')))throw fail('ONCHAIN_RANGE_LIMIT',{rpcCode:body.error.code,detail:sanitize(body.error.message)});
   if(body?.error&&transientRpcError(body.error))throw fail('ONCHAIN_RATE_LIMITED',{retryable:true,rpcCode:body.error.code});
   throw fail('ONCHAIN_BATCH_UNSUPPORTED',{retryable:true});
  }
  const items=Array.isArray(body)?body:[body];
  if(items.length!==payload.length||items.some(x=>!x||typeof x!=='object'||x.jsonrpc!=='2.0'))throw fail('ONCHAIN_MALFORMED_RESPONSE',{retryable:true});
  const byId=new Map(items.map(x=>[x.id,x]));
  if(byId.size!==payload.length)throw fail('ONCHAIN_MALFORMED_RESPONSE',{retryable:true});
  return payload.map(request=>{
   const item=byId.get(request.id);
   if(!item)throw fail('ONCHAIN_MALFORMED_RESPONSE',{retryable:true});
   if(item.error){
    const message=String(item.error.message||'').slice(0,300);
    if(request.method==='eth_getLogs'&&RANGE.test(message))throw fail('ONCHAIN_RANGE_LIMIT',{rpcCode:item.error.code,detail:sanitize(message)});
    if(transientRpcError(item.error))throw fail('ONCHAIN_RATE_LIMITED',{retryable:true,rpcCode:item.error.code,detail:sanitize(message)});
    return {ok:false,rpcCode:Number.isInteger(item.error.code)?item.error.code:null,detail:sanitize(message)};
   }
   if(!Object.hasOwn(item,'result'))throw fail('ONCHAIN_MALFORMED_RESPONSE',{retryable:true});
   return {ok:true,result:item.result};
  });
 }

 async function verify(index){
  if(verified.has(index))return;
  const [id]=await post(urls[index],[{method:'eth_chainId',params:[]}]);
  if(!id.ok||typeof id.result!=='string'||!/^0x[0-9a-f]+$/i.test(id.result)||Number(BigInt(id.result))!==chainId)throw fail('ONCHAIN_CHAIN_ID_MISMATCH',{retryable:true});
  verified.add(index);
 }

 // A provider that cannot answer JSON-RPC batches is read one call at a time, inside the same budget.
 async function send(index,calls){
  if(calls.length>1&&noBatch.has(index)){
   if(cost.rpcCalls+calls.length>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
   // Paced providers are read strictly one call at a time; others at most `concurrency` calls at once.
   const out=new Array(calls.length),width=paceMs>0?1:Math.max(1,concurrency);let next=0;
   await Promise.all(Array.from({length:Math.min(width,calls.length)},async()=>{for(;;){const i=next++;if(i>=calls.length)return;out[i]=(await post(urls[index],[calls[i]]))[0];}}));
   return out;
  }
  try{return await post(urls[index],calls);}
  catch(error){
   if(calls.length>1&&['ONCHAIN_BATCH_UNSUPPORTED','ONCHAIN_MALFORMED_RESPONSE'].includes(error.code)){noBatch.add(index);return send(index,calls);}
   throw error;
  }
 }

 // Returns one {ok,result}|{ok:false,rpcCode} per call, in order. Throws on budget, range or provider failure.
 async function batch(calls){
  if(!Array.isArray(calls)||!calls.length)return [];
  for(const c of calls)if(!READ_ONLY.has(c.method))throw fail('ONCHAIN_METHOD_NOT_ALLOWED');
  if(cost.rpcCalls+calls.length>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
  let last;
  for(let attempt=0;attempt<urls.length;attempt++){
   const index=enabled?attempt:(active+attempt)%urls.length;
   let prior=null,probe=false;
   if(enabled){
    prior=await watchdogLedger.read(network,identities[index],{env});
    const eligibility=watchdog.eligibility(prior.state,now());
    if(eligibility.mode==='SKIP')continue;
    probe=eligibility.mode==='PROBE';
   }
   try{
    if(probe){
     // A recovery probe MUST freshly verify chain identity; a cached pass is insufficient.
     verified.delete(index);
     // Recovery requires BOTH correct chain identity and a valid live head response.
     if(cost.rpcCalls+2>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
     const started=now();
     await verify(index);
     const [head]=await post(urls[index],[{method:'eth_blockNumber',params:[]}]);
     if(!head.ok||typeof head.result!=='string'||!/^0x[0-9a-f]+$/i.test(head.result))
      throw fail('ONCHAIN_MALFORMED_RESPONSE',{retryable:true});
     const recorded=await watchdogLedger.transition(network,identities[index],{
      kind:'SUCCESS',reason:'RECOVERY_PROBE_OK',latencyMs:Math.max(0,now()-started),at:now(),expectedRevision:prior.revision
     },{env});
     // A probe is never a data result. Two independent successes restore eligibility.
     if(watchdog.eligibility(recorded.state,now()).mode!=='TRAFFIC')continue;
     // Even the second successful probe serves no user data until a subsequent selection.
     continue;
    }
    if(cost.rpcCalls+calls.length+(verified.has(index)?0:1)>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
    const started=now();
    await verify(index);
    const out=await send(index,calls);
    if(enabled){
     await watchdogLedger.transition(network,identities[index],{
      kind:'SUCCESS',reason:index===0?'SUCCESS':'FALLBACK_USED',
      latencyMs:Math.max(0,now()-started),at:now(),expectedRevision:prior.revision
     },{env});
     if(index!==0)cost.failovers++;
    }else if(index!==active){active=index;cost.failovers++;}
    return out;
   }catch(error){
    last=error;
    if(enabled&&providerFault(error)){
     const recorded=await watchdogLedger.transition(network,identities[index],{
      kind:failureKind(error),httpStatus:error.httpStatus===429?429:null,at:now()
     },{env});
     // Preserve the source failure, but never proceed if ledger persistence fails.
    }
    if(['ONCHAIN_RANGE_LIMIT','ONCHAIN_RPC_BUDGET_EXHAUSTED','ONCHAIN_DEADLINE_EXCEEDED'].includes(error.code)||!error.retryable)throw error;
    // Slot label only: endpoint URLs can embed credentials and must never be reported.
    if(cost.providerErrors.length<8)cost.providerErrors.push({provider:index===0?'primary':'fallback'+index,code:error.code,...(error.detail?{detail:error.detail}:{})});
   }
  }
  throw fail('ONCHAIN_PROVIDER_UNAVAILABLE',{cause:last?.code||null,httpStatus:last?.httpStatus||null});
 }
 return {batch,cost,chainId,remainingCalls:()=>maxCalls-cost.rpcCalls,remainingMs:()=>deadlineAt-now()};
}
module.exports={create,endpoints,sanitize,READ_ONLY,RANGE,providerId,failureKind};
