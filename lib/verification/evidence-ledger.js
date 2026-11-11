'use strict';
// Durable, fail-closed evidence history for the autonomous verification engine.
//
// This module is intentionally NOT wired into user-facing metric paths yet.
// It stores canonical MetricEvidence documents on the existing durable worker volume,
// preserves the last trusted snapshot across failures/restarts, and never converts
// historical trusted evidence back into a current value.
//
// Storage model:
// - one bounded JSON document per metric identity;
// - mkdir lease for cross-process serialization;
// - fsync + atomic rename for writes;
// - corruption/regression/time-conflict fails closed (existing file is never replaced).
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const evidence=require('./metric-evidence');

const SCHEMA_VERSION=1,MAX_TRANSITIONS=64,MAX_FILE_BYTES=512*1024;
const LOCK_WAIT_MS=12000,LOCK_STALE_MS=120000;
const SLUG=/^[a-z][a-z0-9_.-]{0,63}$/,ADDRESS=/^0x[0-9a-f]{40}$/,HASH=/^0x[0-9a-f]{64}$/;
const SUCCESS_STATES=new Set([
 evidence.STATES.VERIFIED_ONCHAIN,
 evidence.STATES.INDEPENDENTLY_CROSS_CHECKED,
 evidence.STATES.SINGLE_SOURCE
]);
const FAILURE_STATES=new Set([
 evidence.STATES.CONFLICTING,
 evidence.STATES.STALE,
 evidence.STATES.UNAVAILABLE,
 evidence.STATES.UNSUPPORTED,
 evidence.STATES.NOT_VERIFIED
]);
const fail=(code)=>Object.assign(Error(code),{code});

function directory(env=process.env){
 const configured=env.ARC_VERIFICATION_LEDGER_DIR;
 if(configured)return configured;
 if(env.ARC_HOLDER_PUBLISHED_DIR)return path.join(env.ARC_HOLDER_PUBLISHED_DIR,'verification-ledger');
 throw fail('EVIDENCE_LEDGER_STORAGE_UNCONFIGURED');
}
function canonicalIdentity(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype)throw fail('EVIDENCE_LEDGER_INVALID_IDENTITY');
 const {metricId,network,token,scope=null}=input;
 if(!SLUG.test(metricId||'')||!Object.hasOwn(evidence.NETWORKS,network)||!ADDRESS.test(token||'')||
   !(scope===null||SLUG.test(scope)||ADDRESS.test(scope)||HASH.test(scope)))throw fail('EVIDENCE_LEDGER_INVALID_IDENTITY');
 return {metricId,network,token,scope};
}
function identityFromEvidence(doc){return canonicalIdentity({metricId:doc.metricId,network:doc.network,token:doc.token,scope:doc.scope});}
function keyFor(identity){
 const i=canonicalIdentity(identity);
 return [i.network,i.token,i.scope??'',i.metricId].join('|');
}
function fileFor(identity,env=process.env){
 const key=keyFor(identity),name=crypto.createHash('sha256').update(key).digest('hex')+'.json';
 return path.join(directory(env),name);
}
function sameIdentity(a,b){return a.metricId===b.metricId&&a.network===b.network&&a.token===b.token&&a.scope===b.scope;}
function sameJson(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function iso(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;}
function validSummary(entry,states){
 return entry===null||Boolean(entry&&iso(entry.at)&&states.has(entry.state)&&typeof entry.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(entry.reasonCode));
}
function validTransition(t){
 return Boolean(t&&iso(t.at)&&(t.from===null||Object.hasOwn(evidence.STATES,t.from))&&Object.hasOwn(evidence.STATES,t.to)&&
  typeof t.reasonCode==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(t.reasonCode)&&typeof t.valueChanged==='boolean');
}
function trusted(doc){return doc===null?null:evidence.parseMetricEvidence(doc);}
function validRecord(record,expectedIdentity){
 try{
  if(!record||record.schemaVersion!==SCHEMA_VERSION||!Number.isSafeInteger(record.revision)||record.revision<1||
    !iso(record.updatedAt)||!Array.isArray(record.transitions)||record.transitions.length>MAX_TRANSITIONS||
    !record.transitions.every(validTransition))return false;
  const identity=canonicalIdentity(record.identity);
  if(expectedIdentity&&!sameIdentity(identity,canonicalIdentity(expectedIdentity)))return false;
  if(record.key!==keyFor(identity))return false;
  const current=evidence.parseMetricEvidence(record.current);
  if(!sameIdentity(identity,identityFromEvidence(current))||record.updatedAt!==current.generatedAt)return false;
  const lastTrusted=trusted(record.lastTrusted),previousTrusted=trusted(record.previousTrusted);
  if(lastTrusted&&(!evidence.isTrustedEvidence(lastTrusted)||!sameIdentity(identity,identityFromEvidence(lastTrusted))))return false;
  if(previousTrusted&&(!evidence.isTrustedEvidence(previousTrusted)||!sameIdentity(identity,identityFromEvidence(previousTrusted))))return false;
  if(!validSummary(record.lastSuccess,SUCCESS_STATES)||!validSummary(record.lastFailure,FAILURE_STATES))return false;
  if(record.lastSuccess&&Date.parse(record.lastSuccess.at)>Date.parse(record.updatedAt))return false;
  if(record.lastFailure&&Date.parse(record.lastFailure.at)>Date.parse(record.updatedAt))return false;
  let previousTime=-Infinity;
  for(const t of record.transitions){const at=Date.parse(t.at);if(at<previousTime||at>Date.parse(record.updatedAt))return false;previousTime=at;}
  return true;
 }catch{return false;}
}
async function readFile(file,identity){
 try{
  const stat=await fs.stat(file);
  if(!stat.isFile()||stat.size<=0||stat.size>MAX_FILE_BYTES)throw fail('EVIDENCE_LEDGER_CORRUPT');
  const parsed=JSON.parse(await fs.readFile(file,'utf8'));
  if(!validRecord(parsed,identity))throw fail('EVIDENCE_LEDGER_CORRUPT');
  return parsed;
 }catch(error){
  if(error.code==='ENOENT')return null;
  if(error.code?.startsWith('EVIDENCE_LEDGER_'))throw error;
  throw fail(error instanceof SyntaxError?'EVIDENCE_LEDGER_CORRUPT':'EVIDENCE_LEDGER_READ_FAILED');
 }
}
async function acquire(file){
 const lock=file+'.lock',deadline=Date.now()+LOCK_WAIT_MS;
 for(;;){
  try{
   await fs.mkdir(lock);
   await fs.writeFile(path.join(lock,'owner'),JSON.stringify({pid:process.pid,at:Date.now()}));
   return lock;
  }catch(error){
   if(error.code!=='EEXIST')throw fail('EVIDENCE_LEDGER_LOCK_FAILED');
   try{const stat=await fs.stat(lock);if(Date.now()-stat.mtimeMs>LOCK_STALE_MS){await fs.rm(lock,{recursive:true,force:true});continue;}}catch{}
   if(Date.now()>=deadline)throw fail('EVIDENCE_LEDGER_BUSY');
   await new Promise(resolve=>setTimeout(resolve,30));
  }
 }
}
async function writeUnlocked(file,record,identity){
 if(!validRecord(record,identity))throw fail('EVIDENCE_LEDGER_INVALID_RECORD');
 const body=JSON.stringify(record);
 if(Buffer.byteLength(body)>MAX_FILE_BYTES)throw fail('EVIDENCE_LEDGER_RECORD_TOO_LARGE');
 let temp;
 try{
  await fs.mkdir(path.dirname(file),{recursive:true});
  temp=file+'.'+crypto.randomUUID()+'.tmp';
  const handle=await fs.open(temp,'wx');
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,file);
 }catch(error){
  if(error.code?.startsWith('EVIDENCE_LEDGER_'))throw error;
  throw fail('EVIDENCE_LEDGER_WRITE_FAILED');
 }finally{if(temp)await fs.unlink(temp).catch(()=>{});}
}
function valueChanged(a,b){
 if(!a)return true;
 return a.value!==b.value||a.unit!==b.unit||JSON.stringify(a.block)!==JSON.stringify(b.block)||
  JSON.stringify(a.source)!==JSON.stringify(b.source);
}
function transitionNeeded(previous,current){
 return !previous||previous.state!==current.state||previous.reasonCode!==current.reasonCode||valueChanged(previous,current);
}
function nextRecord(previous,current){
 const identity=identityFromEvidence(current),now=current.generatedAt;
 if(previous){
  const priorMs=Date.parse(previous.updatedAt),nextMs=Date.parse(now);
  if(nextMs<priorMs)throw fail('EVIDENCE_LEDGER_REGRESSION');
  if(nextMs===priorMs){
   if(sameJson(previous.current,current))return previous;
   throw fail('EVIDENCE_LEDGER_TIME_CONFLICT');
  }
 }
 const success=SUCCESS_STATES.has(current.state),failure=FAILURE_STATES.has(current.state);
 if(!success&&!failure)throw fail('EVIDENCE_LEDGER_INVALID_STATE');
 let lastTrusted=previous?.lastTrusted||null,previousTrusted=previous?.previousTrusted||null;
 if(evidence.isTrustedEvidence(current)){
  previousTrusted=lastTrusted;
  lastTrusted=current;
 }
 const lastSuccess=success?{at:now,state:current.state,reasonCode:current.reasonCode}:previous?.lastSuccess||null;
 const lastFailure=failure?{at:now,state:current.state,reasonCode:current.reasonCode}:previous?.lastFailure||null;
 const transitions=[...(previous?.transitions||[])];
 if(transitionNeeded(previous?.current||null,current)){
  transitions.push({at:now,from:previous?.current?.state||null,to:current.state,reasonCode:current.reasonCode,
   valueChanged:valueChanged(previous?.current||null,current)});
  if(transitions.length>MAX_TRANSITIONS)transitions.splice(0,transitions.length-MAX_TRANSITIONS);
 }
 return {schemaVersion:SCHEMA_VERSION,key:keyFor(identity),identity,revision:(previous?.revision||0)+1,updatedAt:now,
  current,lastTrusted,previousTrusted,lastSuccess,lastFailure,transitions};
}
async function record(input,{env=process.env}={}){
 const current=evidence.parseMetricEvidence(input),identity=identityFromEvidence(current),file=fileFor(identity,env);
 await fs.mkdir(path.dirname(file),{recursive:true});
 const lock=await acquire(file);
 try{
  const previous=await readFile(file,identity),next=nextRecord(previous,current);
  if(next===previous)return structuredClone(previous);
  await writeUnlocked(file,next,identity);
  return structuredClone(next);
 }finally{await fs.rm(lock,{recursive:true,force:true}).catch(()=>{});}
}
async function read(identity,{env=process.env}={}){
 const canonical=canonicalIdentity(identity),value=await readFile(fileFor(canonical,env),canonical);
 return value?structuredClone(value):null;
}
module.exports={SCHEMA_VERSION,MAX_TRANSITIONS,MAX_FILE_BYTES,LOCK_WAIT_MS,LOCK_STALE_MS,directory,canonicalIdentity,keyFor,fileFor,validRecord,record,read};
