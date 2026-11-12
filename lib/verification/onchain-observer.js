'use strict';
// Independent same-block on-chain observations for the verification runtime.
//
// The Search report reads chain state through each network's failover client, so the operator that actually served
// a value is not recorded. This observer re-reads the verifiable values at the report's exact block from two named
// endpoints — the network's primary endpoint and a second endpoint run by a DIFFERENT registered operator — and
// returns every raw reading with its block hash. It decides nothing; the runtime compares the readings.
//
// Safety and cost:
//  * read-only method allowlist; nothing can sign or send a transaction
//  * per-endpoint call budget, per-call timeout, one overall deadline, bounded concurrency, no retries
//  * cooperates with the provider watchdog: a provider in cooldown is skipped (not retried), and each endpoint
//    contributes ONE health event per observation, so an outage cannot turn report traffic into a retry storm
//  * endpoint URLs (which can carry API keys) never leave this module
const {chain,rpcUrl}=require('../../search/server/lib/chains');
const identity=require('./source-identity');
const watchdog=require('./provider-watchdog');

const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_call','eth_getStorageAt']);
const SELECTORS=Object.freeze({totalSupply:'0x18160ddd',decimals:'0x313ce567',balanceOf:'0x70a08231',owner:'0x8da5cb5b'});
const BURN=Object.freeze(['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead']);
const EIP1967_IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
// Second endpoints run by a different registered operator than each network's default primary.
const INDEPENDENT_DEFAULTS=Object.freeze({ethereum:'https://eth.drpc.org',arc:'https://rpc.quicknode.mainnet.arc.io',robinhood:'https://robinhood.drpc.org'});
const LIMITS=Object.freeze({callsPerEndpoint:10,concurrencyPerEndpoint:3,timeoutMs:2500,deadlineMs:4000,maxBodyBytes:64*1024});
const ADDRESS=/^0x[0-9a-f]{40}$/,BLOCK_HEX=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i,WORD=/^0x[0-9a-f]{64}$/i,HASH=/^0x[0-9a-f]{64}$/i,QTY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const fail=(code,extra)=>Object.assign(Error(code),{code,...extra});

function primaryUrl(network,env){
 if(network==='arc')return require('../../search/server/lib/arc-rpc').providers(env)[0];
 if(network==='robinhood')return require('../../search/server/lib/robinhood-rpc').providers(env)[0];
 return rpcUrl('ethereum',env);
}
function independentUrl(network,env){
 const raw=env['ARC_VERIFICATION_RPC_URL_'+network.toUpperCase()];
 if(raw==='off')return null;
 const value=raw||INDEPENDENT_DEFAULTS[network];
 let url;try{url=new URL(value);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.hash)return null;
 return url.toString();
}
function endpoints(network,env=process.env){
 const cfg=chain(network),primary=primaryUrl(cfg.id,env),second=independentUrl(cfg.id,env);
 const a={role:'primary',url:primary,...identity.rpcOperator(primary)};
 const list=[a];let independence={independent:false,reasonCode:'NO_INDEPENDENT_ENDPOINT'};
 if(second){
  const b={role:'independent',url:second,...identity.rpcOperator(second)};
  independence=identity.independent(a,b);
  // A same-operator second endpoint is not called at all: it would cost budget and prove nothing.
  if(independence.reasonCode!=='SAME_OPERATOR')list.push(b);
 }
 for(const e of list)e.providerId=('verify-'+cfg.id+'-'+e.operator).slice(0,64);
 return {endpoints:list,independence};
}

// Process-local provider health. It is always bounded (one state per network/operator). When durable storage is
// configured the shared provider-watchdog ledger is used as well, so cooldowns survive restarts on the worker.
const health=new Map();
function durable(env){return Boolean(env.ARC_VERIFICATION_LEDGER_DIR||env.ARC_HOLDER_PUBLISHED_DIR);}
async function loadHealth(network,providerId,env){
 const key=network+'|'+providerId;
 if(!health.has(key))health.set(key,watchdog.create(providerId,network));
 if(durable(env)){
  try{const row=await withTimeout(require('./provider-watchdog-ledger').read(network,providerId,{env}),800);if(row?.state&&watchdog.validState(row.state))health.set(key,row.state);}
  catch{/* durable state unavailable: the process-local state still bounds traffic */}
 }
 return health.get(key);
}
async function saveHealth(network,providerId,event,env){
 const key=network+'|'+providerId,state=health.get(key)||watchdog.create(providerId,network);
 health.set(key,event.kind==='SUCCESS'?watchdog.recordSuccess(state,{at:event.at,latencyMs:event.latencyMs}):
  watchdog.recordFailure(state,{at:event.at,kind:event.kind,httpStatus:event.httpStatus??null,retryAfterMs:event.retryAfterMs??0}));
 if(durable(env)){try{await withTimeout(require('./provider-watchdog-ledger').transition(network,providerId,event,{env}),800);}catch{}}
 return health.get(key);
}
function withTimeout(promise,ms){
 let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('TIMEOUT')),ms);})]).finally(()=>clearTimeout(timer));
}
function retryAfterMs(response){
 const raw=response?.headers?.get?.('retry-after');if(!raw)return 0;
 const seconds=Number(raw);if(Number.isFinite(seconds)&&seconds>=0)return Math.min(seconds*1000,24*3600*1000);
 const at=Date.parse(raw);return Number.isFinite(at)?Math.max(0,Math.min(at-Date.now(),24*3600*1000)):0;
}

function client({url,fetcher,deadlineAt,now,timeoutMs}){
 let id=0,active=0;const queue=[],cost={rpcCalls:0};
 async function call(method,params){
  if(!READ_ONLY.has(method))throw fail('RPC_METHOD_NOT_ALLOWED',{kind:'PROVIDER_ERROR'});
  if(cost.rpcCalls>=LIMITS.callsPerEndpoint)throw fail('RPC_BUDGET_EXCEEDED',{kind:'PROVIDER_ERROR'});
  // Semaphore with direct hand-off: a finishing call passes its slot to the next waiter, so the limit holds strictly.
  if(active>=LIMITS.concurrencyPerEndpoint)await new Promise(resolve=>queue.push(resolve));
  else active++;
  try{
   const remaining=deadlineAt-now();
   if(remaining<=50)throw fail('RPC_DEADLINE_EXCEEDED',{kind:'TIMEOUT'});
   cost.rpcCalls++;const requestId=++id,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,remaining));
   try{
    let response;
    try{response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal});}
    catch(e){throw fail(e?.name==='AbortError'?'RPC_TIMEOUT':'RPC_TRANSPORT_ERROR',{kind:e?.name==='AbortError'?'TIMEOUT':'TRANSPORT'});}
    if(response.status===429)throw fail('RPC_RATE_LIMITED',{kind:'RATE_LIMIT',httpStatus:429,retryAfterMs:retryAfterMs(response)});
    if(!response.ok)throw fail('RPC_HTTP_'+response.status,{kind:response.status>=500?'TRANSPORT':'PROVIDER_ERROR',httpStatus:response.status});
    let text;try{text=await response.text();}catch{throw fail('RPC_TRANSPORT_ERROR',{kind:'TRANSPORT'});}
    if(Buffer.byteLength(text)>LIMITS.maxBodyBytes)throw fail('RPC_RESPONSE_TOO_LARGE',{kind:'MALFORMED'});
    let body;try{body=JSON.parse(text);}catch{throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});}
    if(body?.jsonrpc!=='2.0'||body.id!==requestId)throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});
    if(body.error){
     const message=String(body.error.message||'');
     if(body.error.code===-32005||/rate|too many|limit exceeded/i.test(message))throw fail('RPC_RATE_LIMITED',{kind:'RATE_LIMIT',httpStatus:null});
     if(method==='eth_call'&&(body.error.code===3||/revert/i.test(message)))throw fail('CALL_REVERTED',{kind:null});
     throw fail('RPC_PROVIDER_ERROR',{kind:'PROVIDER_ERROR'});
    }
    return body.result;
   }finally{clearTimeout(timer);}
  }finally{const next=queue.shift();if(next)next();else active--;}
 }
 return {call,cost};
}
const uintFromWord=raw=>{if(!WORD.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});return BigInt(raw).toString();};
const addressFromWord=raw=>{if(!WORD.test(raw||'')||!/^0x0{24}/i.test(raw))throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});return '0x'+raw.slice(-40).toLowerCase();};

async function readEndpoint(e,{network,address,block,wants,fetcher,deadlineAt,now,timeoutMs}){
 const started=now(),rpc=client({url:e.url,fetcher,deadlineAt,now,timeoutMs}),cfg=chain(network);
 const readings={},errors={};let firstFailure=null;
 const attempt=async(name,method,params,parse)=>{
  try{readings[name]=parse(await rpc.call(method,params));}
  catch(error){
   errors[name]=error.code||'RPC_FAILED';
   // A revert is a property of the contract (e.g. no owner()), not a provider failure.
   if(error.kind&&!firstFailure)firstFailure=error;
  }
 };
 await attempt('chainId','eth_chainId',[],raw=>{if(!QTY.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});return Number(BigInt(raw));});
 if(readings.chainId!==undefined&&readings.chainId!==cfg.chainId){
  const error=fail('RPC_WRONG_CHAIN',{kind:'WRONG_CHAIN'});
  return {state:'FAILED',reasonCode:error.code,failure:error,readings:{},errors:{chainId:error.code},cost:{...rpc.cost,ms:now()-started}};
 }
 if(readings.chainId===undefined)return {state:'FAILED',reasonCode:errors.chainId,failure:firstFailure,readings:{},errors,cost:{...rpc.cost,ms:now()-started}};
 const at=[block];
 const work=[
  attempt('header','eth_getBlockByNumber',[block,false],raw=>{
   if(!raw||raw.number?.toLowerCase()!==block.toLowerCase()||!HASH.test(raw.hash||'')||!QTY.test(raw.timestamp||''))throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});
   return {hash:raw.hash.toLowerCase(),timestamp:Number(BigInt(raw.timestamp))};}),
  attempt('totalSupply','eth_call',[{to:address,data:SELECTORS.totalSupply},...at],uintFromWord),
  attempt('decimals','eth_call',[{to:address,data:SELECTORS.decimals},...at],raw=>{const v=BigInt(uintFromWord(raw));if(v>255n)throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});return Number(v);}),
  ...BURN.map((burn,i)=>attempt('burn'+i,'eth_call',[{to:address,data:SELECTORS.balanceOf+burn.slice(2).padStart(64,'0')},...at],uintFromWord))
 ];
 if(e.role==='primary')work.push(attempt('head','eth_blockNumber',[],raw=>{if(!QTY.test(raw||''))throw fail('RPC_MALFORMED_RESPONSE',{kind:'MALFORMED'});return BigInt(raw).toString();}));
 if(wants.owner)work.push(attempt('owner','eth_call',[{to:address,data:SELECTORS.owner},...at],addressFromWord));
 if(wants.implementation)work.push(attempt('implementation','eth_getStorageAt',[address,EIP1967_IMPLEMENTATION_SLOT,...at],addressFromWord));
 await Promise.all(work);
 if(readings.burn0!==undefined&&readings.burn1!==undefined)readings.burnBalance=(BigInt(readings.burn0)+BigInt(readings.burn1)).toString();
 const ok=readings.header&&readings.totalSupply!==undefined;
 return {state:firstFailure?(ok?'PARTIAL':'FAILED'):'OK',reasonCode:firstFailure?.code||null,failure:firstFailure,readings,errors,cost:{...rpc.cost,ms:now()-started}};
}

async function observe({network,address,block,wants={},env=process.env,fetcher=fetch,now=Date.now,deadlineMs=LIMITS.deadlineMs,timeoutMs=LIMITS.timeoutMs}={}){
 const cfg=chain(network),token=String(address||'').toLowerCase();
 if(!ADDRESS.test(token))throw fail('VERIFICATION_INVALID_ADDRESS');
 if(!BLOCK_HEX.test(block||''))throw fail('VERIFICATION_INVALID_BLOCK');
 const {endpoints:list,independence}=endpoints(cfg.id,env),deadlineAt=now()+deadlineMs,started=now();
 const results=await Promise.all(list.map(async e=>{
  const state=await loadHealth(cfg.id,e.providerId,env),gate=watchdog.eligibility(state,now());
  const base={role:e.role,providerId:e.providerId,operator:e.operator,operatorBasis:e.basis,operatorReference:e.reference};
  if(gate.mode==='SKIP')return {...base,state:'SKIPPED',reasonCode:gate.reasonCode,nextProbeAt:gate.nextProbeAt,watchdogState:state.state,readings:{},errors:{},cost:{rpcCalls:0,ms:0}};
  const r=await readEndpoint(e,{network:cfg.id,address:token,block:block.toLowerCase(),wants,fetcher,deadlineAt,now,timeoutMs});
  const at=now();
  const updated=r.failure?await saveHealth(cfg.id,e.providerId,{kind:r.failure.kind,httpStatus:r.failure.httpStatus??null,retryAfterMs:r.failure.retryAfterMs||0,at},env):
   await saveHealth(cfg.id,e.providerId,{kind:'SUCCESS',reason:gate.mode==='PROBE'?'RECOVERY_PROBE_OK':'SUCCESS',latencyMs:Math.min(r.cost.ms,120000),at},env);
  const {failure,...rest}=r;
  return {...base,...rest,probe:gate.mode==='PROBE',watchdogState:updated.state};
 }));
 return {network:cfg.id,chainId:cfg.chainId,block:{hex:block.toLowerCase(),number:BigInt(block).toString()},independence,endpoints:results,
  cost:{rpcCalls:results.reduce((n,r)=>n+r.cost.rpcCalls,0),ms:now()-started,deadlineMs},healthPersistence:durable(env)?'DURABLE_LEDGER':'PROCESS_LOCAL'};
}
module.exports={observe,endpoints,LIMITS,SELECTORS,BURN,EIP1967_IMPLEMENTATION_SLOT,INDEPENDENT_DEFAULTS,_resetHealth:()=>health.clear()};
