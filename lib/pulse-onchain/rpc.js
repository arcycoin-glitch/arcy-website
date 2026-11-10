'use strict';
// Pulse V2 on-chain transport: read-only, budgeted, chain-checked JSON-RPC.
// - Only the methods below can be sent; nothing here can sign or submit a transaction.
// - Every scan owns ONE budget (calls + wall clock). Exhaustion is an explicit error, never an empty result.
// - A fallback provider is used only after it reports the expected chain ID.
// - Range / result-cap answers are surfaced as ONCHAIN_RANGE_LIMIT so the caller can narrow the window
//   instead of treating a refused query as "no logs".
const {rpcUrl}=require('../../search/server/lib/chains');
const {transientRpcError}=require('../../search/server/lib/rpc-errors');
const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs','eth_call','eth_getStorageAt']);
const RANGE=/block range|ranges? over|range.*(?:large|limit|exceed|wide)|too many (?:logs|results|blocks)|query returned more|exceeds? (?:the )?(?:max|limit|range)|limited to \d|response size/i;
const fail=(code,extra={})=>Object.assign(Error(code),{code,...extra});

// Same endpoints the existing read paths already use. No new provider is introduced here.
function endpoints(chain,env=process.env){
 if(chain==='arc')return require('../../search/server/lib/arc-rpc').providers(env);
 if(chain==='robinhood')return require('../../search/server/lib/robinhood-rpc').providers(env);
 if(chain==='ethereum')return [rpcUrl('ethereum',env)];
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

function create({chainId,urls,fetcher=fetch,maxCalls=40,deadlineAt=Date.now()+8000,timeoutMs=6000,maxBytes=4*1024*1024,now=Date.now}={}){
 if(!Number.isSafeInteger(chainId)||!Array.isArray(urls)||!urls.length)throw fail('ONCHAIN_RPC_NOT_CONFIGURED');
 const cost={rpcCalls:0,httpRequests:0,byMethod:{},failovers:0,providerErrors:[]};
 const verified=new Set(),noBatch=new Set();let active=0,nextId=0;

 async function post(url,calls){
  const remaining=deadlineAt-now();
  if(remaining<=50)throw fail('ONCHAIN_DEADLINE_EXCEEDED');
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
   const message=String(body?.error?.message||(Array.isArray(body)?body[0]?.error?.message:'')||'').slice(0,300);
   if([400,413].includes(status)&&RANGE.test(message))throw fail('ONCHAIN_RANGE_LIMIT',{httpStatus:status});
   throw fail('ONCHAIN_HTTP_'+status,{httpStatus:status,retryable:status===403||status===408||status===429||status>=500});
  }
  // Some providers answer a whole batch with one error object.
  if(payload.length>1&&!Array.isArray(body)){
   if(RANGE.test(String(body?.error?.message||'')))throw fail('ONCHAIN_RANGE_LIMIT',{rpcCode:body.error.code});
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
    if(request.method==='eth_getLogs'&&RANGE.test(message))throw fail('ONCHAIN_RANGE_LIMIT',{rpcCode:item.error.code});
    if(transientRpcError(item.error))throw fail('ONCHAIN_RATE_LIMITED',{retryable:true,rpcCode:item.error.code});
    return {ok:false,rpcCode:Number.isInteger(item.error.code)?item.error.code:null};
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
   const out=[];
   for(const call of calls){
    if(cost.rpcCalls+1>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
    out.push((await post(urls[index],[call]))[0]);
   }
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
   const index=(active+attempt)%urls.length;
   try{
    if(cost.rpcCalls+calls.length+(verified.has(index)?0:1)>maxCalls)throw fail('ONCHAIN_RPC_BUDGET_EXHAUSTED');
    await verify(index);
    const out=await send(index,calls);
    if(index!==active){active=index;cost.failovers++;}
    return out;
   }catch(error){
    last=error;
    if(['ONCHAIN_RANGE_LIMIT','ONCHAIN_RPC_BUDGET_EXHAUSTED','ONCHAIN_DEADLINE_EXCEEDED'].includes(error.code)||!error.retryable)throw error;
    // Slot label only: endpoint URLs can embed credentials and must never be reported.
    cost.providerErrors.push({provider:index===0?'primary':'fallback'+index,code:error.code});
   }
  }
  throw fail('ONCHAIN_PROVIDER_UNAVAILABLE',{cause:last?.code||null,httpStatus:last?.httpStatus||null});
 }
 return {batch,cost,chainId,remainingCalls:()=>maxCalls-cost.rpcCalls,remainingMs:()=>deadlineAt-now()};
}
module.exports={create,endpoints,READ_ONLY,RANGE};
