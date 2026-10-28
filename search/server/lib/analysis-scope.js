'use strict';
// Share exact reads only for the lifetime of one analysis. Never replay latest
// chain state from a previous report or combine different networks/providers.
const {AsyncLocalStorage}=require('node:async_hooks');
const scope=new AsyncLocalStorage();
const pending=new Map();
function run(operation,notify){return scope.run({reads:new Map(),complete:new Map(),providers:new Map(),active:0,waiters:[],notify},operation)}
// The provider that produced a report's pinned snapshot serves every later
// read of that report; a report can never mix RPC snapshot providers.
function pinnedProvider(network){return scope.getStore()?.providers?.get(network)||null}
function pinProvider(network,endpoint){
 const state=scope.getStore();if(!state?.providers)return;
 const prior=state.providers.get(network);
 if(prior&&prior!==endpoint)throw Error('A report cannot mix RPC snapshot providers');
 state.providers.set(network,endpoint);
}
function read(network,endpoint,method,params,options,operation){
 const diagnostics=require('./diagnostics'),measured=async()=>{const start=Date.now();try{const value=await operation();diagnostics.record('rpc',network,'ok',Date.now()-start);return value}catch(error){diagnostics.record('rpc',network,diagnostics.category(error),Date.now()-start);throw error}};
 const identity=JSON.stringify([network,endpoint,method,params]);
 const key=JSON.stringify([identity,options]);
 const state=scope.getStore();
 if(!state)return measured();
 if(state.complete.has(identity)){diagnostics.record('rpc',network,'cache_hit');return Promise.resolve(state.complete.get(identity))}
 if(!state.reads.has(key))state.reads.set(key,(async()=>{
  if(state.active>=8)await new Promise(resolve=>state.waiters.push(resolve));else state.active++;
  try{const value=await measured();state.complete.set(identity,value);return value}
  finally{const next=state.waiters.shift();if(next)next();else state.active--}
 })());
 return state.reads.get(key);
}
function emit(phase,report){scope.getStore()?.notify?.({phase,report})}
async function report(key,operation,onProgress){
 if(!pending.has(key)){
  const entry={listeners:new Set(),last:null};
  pending.set(key,entry);
  entry.task=Promise.resolve().then(()=>run(operation,event=>{
   entry.last=event;
   for(const listener of entry.listeners){try{listener(structuredClone(event))}catch{}}
  }));
  const done=()=>{if(pending.get(key)===entry)pending.delete(key)};
  entry.task.then(done,done);
 }
 const entry=pending.get(key);
 if(onProgress){entry.listeners.add(onProgress);if(entry.last){try{onProgress(structuredClone(entry.last))}catch{}}}
 try{return structuredClone(await entry.task)}finally{entry.listeners.delete(onProgress)}
}
module.exports={run,read,report,emit,pinnedProvider,pinProvider};
