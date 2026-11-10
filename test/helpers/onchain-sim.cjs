'use strict';
// Deterministic in-memory JSON-RPC node for Pulse on-chain tests. Implements real eth_getLogs filter semantics
// (address list, per-position topic OR-lists, inclusive block range) so the engine's query plan is exercised as sent.
const crypto=require('node:crypto');
const h32=seed=>'0x'+crypto.createHash('sha256').update(String(seed)).digest('hex');
const hex=n=>'0x'+BigInt(n).toString(16);
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const addr=a=>'0x'+'0'.repeat(24)+a.slice(2).toLowerCase();
const A=n=>'0x'+n.toString(16).padStart(40,'0');

function node({chainId,head,finalized=head-10,blockTime=12,genesisTime=1790000000,logs=[],calls={},storage={},maxRange=Infinity,failures={}}={}){
 const state={chainId,head,finalized,logs:[...logs],calls,storage,maxRange,failures,requests:[],hashes:new Map()};
 const hashOf=n=>state.hashes.get(n)||h32('block:'+chainId+':'+n);
 const header=n=>n<0||n>state.head?null:{number:hex(n),hash:hashOf(n),timestamp:hex(genesisTime+n*blockTime)};
 function answer(request){
  const {method,params=[]}=request;
  state.requests.push(method);
  if(state.failures[method])return {error:state.failures[method]};
  switch(method){
   case 'eth_chainId':return {result:hex(state.chainId)};
   case 'eth_blockNumber':return {result:hex(state.head)};
   case 'eth_getBlockByNumber':{
    if(params[0]==='finalized')return state.finalized===null?{error:{code:-32602,message:'finalized tag not supported'}}:{result:header(state.finalized)};
    return {result:header(Number(BigInt(params[0])))};
   }
   case 'eth_getLogs':{
    const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
    if(to-from+1>state.maxRange)return {error:{code:-32602,message:'query exceeds max block range '+state.maxRange}};
    const addresses=(Array.isArray(f.address)?f.address:[f.address]).map(a=>a.toLowerCase());
    return {result:state.logs.filter(l=>{
     const n=Number(BigInt(l.blockNumber));
     if(n<from||n>to||!addresses.includes(l.address.toLowerCase()))return false;
     return (f.topics||[]).every((want,i)=>want===null||want===undefined||(Array.isArray(want)?want:[want]).some(t=>t.toLowerCase()===(l.topics[i]||'').toLowerCase()));
    })};
   }
   case 'eth_call':{const key=params[0].to.toLowerCase()+':'+params[0].data.slice(0,10);return Object.hasOwn(state.calls,key)?{result:state.calls[key]}:{error:{code:3,message:'execution reverted'}};}
   case 'eth_getStorageAt':return {result:state.storage[params[0].toLowerCase()+':'+params[1]]||word(0)};
   default:return {error:{code:-32601,message:'method not found'}};
  }
 }
 const fetcher=async(url,init)=>{
  state.lastUrl=url;
  if(state.httpStatus)return new Response('{}',{status:state.httpStatus});
  const body=JSON.parse(init.body),list=Array.isArray(body)?body:[body];
  const out=list.map(r=>({jsonrpc:'2.0',id:r.id,...answer(r)}));
  return new Response(JSON.stringify(Array.isArray(body)?out:out[0]),{status:200,headers:{'content-type':'application/json'}});
 };
 let seq=0;
 function log({address,topics,data='0x',block,tx}){
  seq++;
  const entry={address,topics,data,blockNumber:hex(block),blockHash:hashOf(block),transactionHash:tx||h32('tx:'+seq),logIndex:hex(seq),removed:false};
  state.logs.push(entry);return entry;
 }
 return {state,fetcher,log,hashOf,header};
}
module.exports={node,h32,hex,word,addr,A};
