'use strict';
// Arc mainnet (5042) read-only RPC with a provider failover.
// A token inspection is pinned to ONE provider for its entire snapshot.
// Retry the whole snapshot on an independent, chain-checked provider after
// HTTP 403 / 429 / 5xx, timeout, or transport failure. Never mix pinned reads.
const {chain,rpcUrl,verifyChainId}=require('./chains');
const {readJson}=require('./http');
const {uint,units,abiString,BURN,ADDRESS}=require('./eth');
const cfg=chain('arc');
const DEFAULT_FALLBACK='https://rpc.quicknode.mainnet.arc.io';
const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_call','eth_getStorageAt','eth_getBlockByNumber']);
let nextId=0;
function providers(env=process.env){
 const primary=rpcUrl('arc',env);
 const backupValue=env.ARC_RPC_FALLBACK_URL;
 // Explicit opt-out; default backup is the publicly published dRPC endpoint.
 const secondary=backupValue==='disabled'?null:rpcUrl('arc',{
  ARC_RPC_URL:backupValue||DEFAULT_FALLBACK
 });
 return secondary&&secondary!==primary?[primary,secondary]:[primary];
}
function retryable(error){
 return Boolean(error?.retryable)||['AbortError','TimeoutError','TypeError'].includes(error?.name);
}
async function rawRequestAt(endpoint,method,params,{timeoutMs=11000}={}){
 if(!READ_ONLY.has(method))throw Error('Arc RPC method not allowed in read-only lab');
 const id=++nextId;
 // A ref-counted watchdog is essential: AbortSignal.timeout() is unref'd
 // in Node and a stalled mocked/provider promise could otherwise exit silently.
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new DOMException('RPC request timed out','TimeoutError')),timeoutMs);
 let body;
 try{
  const response=await fetch(endpoint,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
   signal:controller.signal
  });
  if(!response.ok){
   const error=new Error('Arc RPC HTTP '+response.status);
   error.httpStatus=response.status;
   error.retryable=response.status===403||response.status===429||response.status>=500;
   throw error;
  }
  body=await readJson(response,1024*1024);
 }finally{clearTimeout(timer)}
 if(!body||typeof body!=='object'||Array.isArray(body)||body.jsonrpc!=='2.0'||body.id!==id)
  throw Error('Arc RPC response identity mismatch');
 if(body.error)throw Object.assign(Error('Arc RPC method failed'),{
  code:'RPC_METHOD_FAILED',retryable:[-32005,-32016].includes(body.error.code)});
 if(!Object.hasOwn(body,'result'))throw Error('Arc RPC result missing');
 return body.result;
}
function requestAt(endpoint,method,params,options={}){
 return require('./analysis-scope').read('arc',endpoint,method,params,options,()=>rawRequestAt(endpoint,method,params,options));
}
// Standalone read-only RPC calls also fail over, but pin-sensitive token scans
// use inspectAt() below to avoid combining two providers in one snapshot.
async function rpc(method,params,opts={}){
 const pinned=require('./analysis-scope').pinnedProvider('arc');
 const endpoints=pinned?[pinned]:providers();
 let last;
 for(let i=0;i<endpoints.length;i++){
  try{
   if(i!==0&&method!=='eth_chainId')
    verifyChainId('arc',await requestAt(endpoints[i],'eth_chainId',[],opts));
   const value=await requestAt(endpoints[i],method,params,opts);
   if(i!==0&&method==='eth_chainId')verifyChainId('arc',value);
   return value;
  }catch(error){
   last=error;
   if(!retryable(error))throw error;
  }
 }
 throw last;
}
async function inspectAt(endpoint,address){
 const callRpc=(method,params)=>requestAt(endpoint,method,params);
 verifyChainId('arc',await callRpc('eth_chainId',[]));
 const block=await callRpc('eth_blockNumber',[]);
 if(!/^0x[0-9a-f]+$/i.test(block))throw Error('Malformed Arc block');
 const bytecode=await callRpc('eth_getCode',[address,block]);
 if(!/^0x[0-9a-f]+$/i.test(bytecode||'')||bytecode==='0x')
  throw Error('No verified token contract');
 const call=data=>callRpc('eth_call',[{to:address,data},block]);
 // Independent getters share the already validated chain/code/block anchor.
 const [supplyWord,decimalsWord,names]=await Promise.all([
  call('0x18160ddd'),call('0x313ce567'),
  Promise.allSettled([call('0x06fdde03'),call('0x95d89b41'),
   ...BURN.map(a=>call('0x70a08231'+a.slice(2).padStart(64,'0')))])
 ]);
 const totalSupplyRaw=uint(supplyWord),decimals=Number(uint(decimalsWord));
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)
  throw Error('Unsupported token precision');
 const name=names[0].status==='fulfilled'?abiString(names[0].value):null;
 const symbol=names[1].status==='fulfilled'?abiString(names[1].value):null;
 const raw=names.slice(2).every(x=>x.status==='fulfilled')?
  names.slice(2).reduce((a,x)=>a+uint(x.value),0n):null;
 return {chainId:cfg.chainId,network:cfg.id,address,block,token:{name,symbol,decimals},
  totalSupplyRaw:totalSupplyRaw.toString(),totalSupply:units(totalSupplyRaw,decimals),
  burnAddressRaw:raw?.toString()??null,
  burnAddressBalance:raw===null?null:units(raw,decimals)};
}
// Use the original, independently exercised Arc RPC path only when all new
// provider transports fail. Both paths attest chain 5042 and pin all reads to
// one block. Never substitute a value from a different block/chain.
async function inspectUsingLegacyCore(address,{core=require('../../../lib/core')}={}){
 if(!ADDRESS.test(address))throw Error('Invalid Arc contract');
 const normalized=address.toLowerCase();
 if(core.CHAIN!==5042)throw Error('Legacy reader chain mismatch');
 const {block}=await core.context(normalized); // Revalidates chain and deployed bytecode.
 if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block))throw Error('Invalid pinned Arc block');
 const call=data=>core.call(normalized,data,block);
 const [supplyHex,decimalHex]=await Promise.all([call('0x18160ddd'),call('0x313ce567')]);
 const raw=core.uint(supplyHex),decimals=Number(core.uint(decimalHex));
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Invalid Arc precision');
 const reads=await Promise.allSettled([
  call('0x06fdde03'),call('0x95d89b41'),
  ...core.BURNS.map(a=>call('0x70a08231'+a.slice(2).padStart(64,'0')))
 ]);
 const getName=i=>{try{return reads[i].status==='fulfilled'?core.string(reads[i].value):null}catch{return null}};
 const balances=reads.slice(2).map(x=>{try{return x.status==='fulfilled'?core.uint(x.value):null}catch{return null}});
 const burned=balances.every(x=>typeof x==='bigint')?balances.reduce((a,b)=>a+b,0n):null;
 // Current balances larger than total cannot be published as a burn percentage.
 const checked=burned!==null&&burned<=raw?burned:null;
 return {chainId:5042,network:'arc',address:normalized,block,
  token:{name:getName(0),symbol:getName(1),decimals},
  totalSupplyRaw:raw.toString(),totalSupply:core.units(raw,decimals),
  burnAddressRaw:checked?.toString()??null,
  burnAddressBalance:checked===null?null:core.units(checked,decimals),
  rpcFallback:'ORIGINAL_ARC_READ_ONLY_PINNED_RPC'};
}

async function inspectToken({address}){
 if(!ADDRESS.test(address))throw Error('Invalid contract address');
 const normalized=address.toLowerCase();
 const endpoints=providers();
 let last;
 for(const endpoint of endpoints){
  try{const result=await inspectAt(endpoint,normalized);require('./analysis-scope').pinProvider('arc',endpoint);return result}
  catch(error){
   last=error;
   // A wrong chain, bad contract, invalid data or invalid provider response
   // cannot be silently replaced by a different provider's assertion.
   if(!retryable(error))throw error;
  }
 }
 if(retryable(last)){
  try{return await inspectUsingLegacyCore(normalized)}
  catch{} // If legacy source also fails, retain the original failure signal.
 }
 throw last;
}
module.exports={rpc,inspectToken,inspectUsingLegacyCore,providers,retryable,requestAt,inspectAt};
