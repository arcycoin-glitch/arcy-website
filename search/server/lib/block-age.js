'use strict';
// A holder snapshot has TWO ages: when it was completed (the worker finished reconciling) and how old the PINNED BLOCK it describes is.
// The second one is what the data actually means. Block timestamps are immutable, so each is resolved once per process and cached.
// Failure never fabricates an age: blockAgeSeconds stays null with blockAgeBasis explaining why.
const cache=new Map();
const BLOCK=/^0x[0-9a-f]+$/i;
function rpcFor(network){
 if(network==='arc')return require('./arc-rpc').rpc;
 if(network==='robinhood')return require('./robinhood-rpc').rpc;
 if(network==='ethereum')return require('./eth').rpc;
 return null;
}
async function blockTimeMs(network,block,{rpc=rpcFor(network),timeoutMs=2500}={}){
 const key=network+':'+String(block).toLowerCase();
 if(cache.has(key))return cache.get(key);
 if(!rpc||!BLOCK.test(block||''))return null;
 let timer;
 try{
  const header=await Promise.race([rpc('eth_getBlockByNumber',[block,false]),new Promise((_,rej)=>{timer=setTimeout(()=>rej(Object.assign(Error('timeout'),{code:'BLOCK_TIME_TIMEOUT'})),timeoutMs);})]);
  const seconds=Number(BigInt(header?.timestamp));
  if(!Number.isSafeInteger(seconds)||seconds<=0)return null;
  cache.set(key,seconds*1000);if(cache.size>500)cache.delete(cache.keys().next().value);
  return seconds*1000;
 }catch{return null;}finally{clearTimeout(timer);}
}
function refs(report){
 const holders=report?.cards?.holders;if(!holders)return [];
 const out=[];
 for(const f of Object.values(holders.fields||{})){
  const block=f?.snapshot?.block||f?.freshness?.block||null;
  if(block&&BLOCK.test(block))out.push({field:f,block});
 }
 return out;
}
async function enrich(report,{network=report?.network,now=Date.now(),rpc,timeoutMs}={}){
 const list=refs(report);if(!list.length)return report;
 const times=new Map();
 for(const block of new Set(list.map(x=>x.block.toLowerCase())))times.set(block,await blockTimeMs(network,block,{rpc,timeoutMs}));
 const head=report.block&&BLOCK.test(report.block)?BigInt(report.block):null;
 for(const {field,block} of list){
  const t=times.get(block.toLowerCase()),snap={...(field.snapshot||{}),block};
  const completed=Date.parse(snap.completedAt||field.freshness?.observedAt||'');
  if(Number.isFinite(completed))snap.completionAgeSeconds=Math.max(0,Math.floor((now-completed)/1000));
  if(t){snap.blockTime=new Date(t).toISOString();snap.blockAgeSeconds=Math.max(0,Math.floor((now-t)/1000));snap.blockAgeBasis='RPC block timestamp of the pinned block';}
  else{snap.blockTime=null;snap.blockAgeSeconds=null;snap.blockAgeBasis='UNKNOWN: pinned block timestamp could not be read (no age is estimated)';}
  if(head!==null)snap.blockLag=Number(head-BigInt(block));
  field.snapshot=snap;
 }
 return report;
}
// For the standalone /api/holders payload: {block, snapshot, fields}. Adds the same block-age fields to value.snapshot and every field snapshot.
async function enrichHolderValue(value,{rpc,now=Date.now(),timeoutMs}={}){
 if(!value?.fields||!value.snapshot?.block)return value;
 const pseudo={network:'arc',block:null,cards:{holders:{fields:value.fields}}};
 await enrich(pseudo,{network:'arc',rpc,now,timeoutMs});
 const any=Object.values(value.fields).find(f=>f?.snapshot&&'blockAgeSeconds' in f.snapshot);
 if(any){const {blockTime,blockAgeSeconds,blockAgeBasis,completionAgeSeconds}=any.snapshot;value.snapshot={...value.snapshot,blockTime,blockAgeSeconds,blockAgeBasis,completionAgeSeconds};}
 return value;
}
function _reset(){cache.clear();}
module.exports={enrich,enrichHolderValue,blockTimeMs,_reset};
