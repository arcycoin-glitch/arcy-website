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
async function requestAt(endpoint,method,params,{timeoutMs=11000}={}){
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
   error.retryable=response.status===403||response.status===429||response.status>=500;
   throw error;
  }
  body=await readJson(response,1024*1024);
 }finally{clearTimeout(timer)}
 if(!body||typeof body!=='object'||Array.isArray(body)||body.jsonrpc!=='2.0'||
  body.id!==id||body.error||!Object.hasOwn(body,'result'))
  throw Error('Arc RPC invalid response');
 return body.result;
}
// Standalone read-only RPC calls also fail over, but pin-sensitive token scans
// use inspectAt() below to avoid combining two providers in one snapshot.
async function rpc(method,params,opts={}){
 const endpoints=providers();
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
 const [supplyWord,decimalsWord]=await Promise.all([
  call('0x18160ddd'),call('0x313ce567')
 ]);
 const totalSupplyRaw=uint(supplyWord),decimals=Number(uint(decimalsWord));
 if(!Number.isInteger(decimals)||decimals<0||decimals>36)
  throw Error('Unsupported token precision');
 const names=await Promise.allSettled([
  call('0x06fdde03'),call('0x95d89b41'),
  ...BURN.map(a=>call('0x70a08231'+a.slice(2).padStart(64,'0')))
 ]);
 const name=names[0].status==='fulfilled'?abiString(names[0].value):null;
 const symbol=names[1].status==='fulfilled'?abiString(names[1].value):null;
 const raw=names.slice(2).every(x=>x.status==='fulfilled')?
  names.slice(2).reduce((a,x)=>a+uint(x.value),0n):null;
 return {chainId:cfg.chainId,network:cfg.id,address,block,token:{name,symbol,decimals},
  totalSupplyRaw:totalSupplyRaw.toString(),totalSupply:units(totalSupplyRaw,decimals),
  burnAddressRaw:raw?.toString()??null,
  burnAddressBalance:raw===null?null:units(raw,decimals)};
}
async function inspectToken({address}){
 if(!ADDRESS.test(address))throw Error('Invalid contract address');
 const normalized=address.toLowerCase();
 const endpoints=providers();
 let last;
 for(const endpoint of endpoints){
  try{return await inspectAt(endpoint,normalized)}
  catch(error){
   last=error;
   // A wrong chain, bad contract, invalid data or invalid provider response
   // cannot be silently replaced by a different provider's assertion.
   if(!retryable(error))throw error;
  }
 }
 throw last;
}
module.exports={rpc,inspectToken,providers,retryable,requestAt,inspectAt};
