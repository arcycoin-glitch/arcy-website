'use strict';
// Durable Pulse monitor state is stored beside signed Pulse editions on the existing worker volume.
// This file is namespaced separately from holder checkpoints and is never used by Holder indexing.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const watchlist=require('./watchlist');
const MAX_EVENTS=500,LOCK_WAIT_MS=12000,LOCK_STALE_MS=120000;
const fail=code=>Object.assign(Error(code),{code});
function directory(env=process.env){return env.ARC_PULSE_ONCHAIN_DIR||env.ARC_PULSE_EDITION_DIR||env.ARC_HOLDER_PUBLISHED_DIR||null;}
function fileFor(chain,env=process.env){watchlist.network(chain);const dir=directory(env);if(!dir)throw fail('PULSE_CHECKPOINT_STORAGE_UNCONFIGURED');return path.join(dir,'pulse-onchain-'+chain+'.json');}
function validEvent(event,chain){
 const cfg=watchlist.network(chain);
 return Boolean(event&&event.network===chain&&event.chainId===cfg.chainId&&/^poc1-[0-9a-f]{24}$/.test(event.id||'')&&
  Number.isSafeInteger(event.blockNumber)&&event.blockNumber>=0&&/^0x[0-9a-f]{64}$/i.test(event.blockHash||'')&&
  /^0x[0-9a-f]{64}$/i.test(event.transactionHash||'')&&Number.isSafeInteger(event.logIndex)&&event.logIndex>=0&&
  event.confirmation?.status==='CONFIRMED'&&typeof event.headline==='string'&&typeof event.summary==='string'&&
  typeof event.evidence?.reference==='string'&&/^https:\/\//.test(event.evidence.reference));
}
function valid(state,chain){
 try{
  const cfg=watchlist.network(chain),c=state?.coverage;
  const events=state?.events,attempt=state?.lastAttempt,attemptValid=attempt&&typeof attempt.at==='string'&&Number.isFinite(Date.parse(attempt.at))&&
   typeof attempt.status==='string'&&typeof attempt.complete==='boolean'&&attempt.cost&&Number.isSafeInteger(attempt.cost.rpcCalls)&&attempt.cost.rpcCalls>=0&&
   Number.isSafeInteger(attempt.cost.httpRequests)&&attempt.cost.httpRequests>=0;
  const coverageValid=c&&Number.isSafeInteger(c.startBlock)&&c.startBlock>=0&&Number.isSafeInteger(c.nextBlock)&&c.nextBlock>c.startBlock&&
   c.lastSuccessfulBlock===c.nextBlock-1&&/^0x[0-9a-f]{64}$/i.test(c.lastSuccessfulBlockHash||'')&&
   c.completeFromGenesis===(c.startBlock===0)&&Number.isSafeInteger(c.reorgOverlap)&&c.reorgOverlap>=1&&
   typeof c.lastSuccessfulAt==='string'&&Number.isFinite(Date.parse(c.lastSuccessfulAt));
  const noCoverageValid=c===null&&attempt?.complete===false&&Array.isArray(events)&&events.length===0;
  return Boolean(state&&state.schemaVersion===1&&state.chain===chain&&state.chainId===cfg.chainId&&Number.isSafeInteger(state.revision)&&state.revision>=1&&
   attemptValid&&(coverageValid||noCoverageValid)&&Array.isArray(events)&&events.length<=MAX_EVENTS&&events.every(e=>validEvent(e,chain))&&
   new Set(events.map(e=>e.id)).size===events.length&&typeof state.generatedAt==='string'&&Number.isFinite(Date.parse(state.generatedAt)));
 }catch{return false;}
}
async function readFile(file,chain){
 try{const state=JSON.parse(await fs.readFile(file,'utf8'));if(!valid(state,chain))throw fail('PULSE_CHECKPOINT_CORRUPT');return state;}
 catch(error){if(error.code==='ENOENT')return null;throw error.code?error:fail('PULSE_CHECKPOINT_READ_FAILED');}
}
async function acquire(file){
 const lock=file+'.lock',deadline=Date.now()+LOCK_WAIT_MS;
 for(;;){
  try{await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner'),JSON.stringify({pid:process.pid,at:Date.now()}));return lock;}
  catch(error){
   if(error.code!=='EEXIST')throw fail('PULSE_CHECKPOINT_LOCK_FAILED');
   try{const stat=await fs.stat(lock);if(Date.now()-stat.mtimeMs>LOCK_STALE_MS){await fs.rm(lock,{recursive:true,force:true});continue;}}catch{}
   if(Date.now()>=deadline)throw fail('PULSE_CHECKPOINT_BUSY');
   await new Promise(resolve=>setTimeout(resolve,30));
  }
 }
}
async function writeUnlocked(file,state,chain){
 if(!valid(state,chain))throw fail('PULSE_CHECKPOINT_INVALID');
 let tmp;
 try{await fs.mkdir(path.dirname(file),{recursive:true});tmp=file+'.'+crypto.randomUUID()+'.tmp';const handle=await fs.open(tmp,'wx');try{await handle.writeFile(JSON.stringify(state));await handle.sync();}finally{await handle.close();}await fs.rename(tmp,file);}
 catch(error){if(error.code?.startsWith('PULSE_'))throw error;throw fail('PULSE_CHECKPOINT_WRITE_FAILED');}
 finally{if(tmp)await fs.unlink(tmp).catch(()=>{});}
}
async function withLease(chain,fn,{env=process.env}={}){
 const file=fileFor(chain,env);await fs.mkdir(path.dirname(file),{recursive:true});const lock=await acquire(file);
 try{
  const store={read:()=>readFile(file,chain),save:state=>writeUnlocked(file,state,chain)};
  return await fn(store);
 }finally{await fs.rm(lock,{recursive:true,force:true}).catch(()=>{});}
}
async function read(chain,{env=process.env}={}){return readFile(fileFor(chain,env),chain);}
module.exports={directory,fileFor,read,withLease,valid,validEvent,MAX_EVENTS,LOCK_WAIT_MS,LOCK_STALE_MS};
