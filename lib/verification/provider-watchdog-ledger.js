'use strict';
// Durable, secret-free watchdog state beside (not inside) MetricEvidence records.
// The MetricEvidence ledger has token-bound schemas: provider health is a distinct
// identity and must never masquerade as verified token evidence.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const evidenceLedger=require('./evidence-ledger');
const watchdog=require('./provider-watchdog');

const VERSION=1,MAX_EVENTS=48,MAX_BYTES=64*1024,LOCK_WAIT_MS=12000;
const fail=code=>Object.assign(Error(code),{code});
const iso=at=>new Date(at).toISOString();

function identity(network,providerId){
 const initial=watchdog.create(providerId,network);
 return {network:initial.network,providerId:initial.providerId};
}
function fileFor(network,providerId,env=process.env){
 const i=identity(network,providerId);
 const hash=crypto.createHash('sha256').update(i.network+'|'+i.providerId).digest('hex');
 return path.join(evidenceLedger.directory(env),'providers',hash+'.json');
}
function valid(row,i){
 if(!row||row.version!==VERSION||row.network!==i.network||row.providerId!==i.providerId||
  !Number.isSafeInteger(row.revision)||row.revision<1||!watchdog.validState(row.state)||
  row.state.network!==i.network||row.state.providerId!==i.providerId||
  !Array.isArray(row.events)||row.events.length>MAX_EVENTS)return false;
 if(row.events.some(e=>!e||!Number.isFinite(Date.parse(e.at))||
   !Object.hasOwn(watchdog.STATES,e.from)||!Object.hasOwn(watchdog.STATES,e.to)||
   !/^(SUCCESS|RECOVERY_PROBE_OK|FALLBACK_USED|RATE_LIMIT|TIMEOUT|TRANSPORT|MALFORMED|WRONG_CHAIN|PROVIDER_ERROR)$/.test(e.reason)))return false;
 return true;
}
async function load(file,i){
 let body;
 try{body=await fs.readFile(file,'utf8');}
 catch(e){if(e.code==='ENOENT')return null;throw fail('PROVIDER_WATCHDOG_LEDGER_READ_FAILED');}
 if(Buffer.byteLength(body)>MAX_BYTES||!body.length)throw fail('PROVIDER_WATCHDOG_LEDGER_CORRUPT');
 let row;try{row=JSON.parse(body);}catch{throw fail('PROVIDER_WATCHDOG_LEDGER_CORRUPT');}
 if(!valid(row,i))throw fail('PROVIDER_WATCHDOG_LEDGER_CORRUPT');
 return row;
}
async function read(network,providerId,{env=process.env}={}){
 const i=identity(network,providerId);
 const row=await load(fileFor(network,providerId,env),i);
 return row?structuredClone(row):{version:VERSION,...i,revision:0,state:watchdog.create(providerId,network),events:[]};
}
async function lock(file){
 const dir=file+'.lock',until=Date.now()+LOCK_WAIT_MS;
 for(;;){
  try{await fs.mkdir(dir);return dir;}
  catch(e){
   if(e.code!=='EEXIST')throw fail('PROVIDER_WATCHDOG_LEDGER_LOCK_FAILED');
   try{const st=await fs.stat(dir);if(Date.now()-st.mtimeMs>120000){await fs.rm(dir,{recursive:true,force:true});continue;}}catch{}
   if(Date.now()>=until)throw fail('PROVIDER_WATCHDOG_LEDGER_BUSY');
   await new Promise(r=>setTimeout(r,30));
  }
 }
}
async function transition(network,providerId,event,{env=process.env}={}){
 const i=identity(network,providerId),file=fileFor(network,providerId,env);
 await fs.mkdir(path.dirname(file),{recursive:true});
 const held=await lock(file);
 let tmp;
 try{
  const previous=await read(network,providerId,{env});
  const at=event.at===undefined?Date.now():event.at;
  if(!Number.isSafeInteger(at)||at<0)throw fail('PROVIDER_WATCHDOG_LEDGER_BAD_EVENT');
  const priorAt=previous.events.at(-1)?.at;
  if(priorAt&&at<Date.parse(priorAt))throw fail('PROVIDER_WATCHDOG_LEDGER_CLOCK_REGRESSION');
  const input=previous.state,success=event.kind==='SUCCESS';
  const reason=success?(event.reason==='RECOVERY_PROBE_OK'?'RECOVERY_PROBE_OK':event.reason==='FALLBACK_USED'?'FALLBACK_USED':'SUCCESS'):event.kind;
  const state=success?
   watchdog.recordSuccess(input,{at,latencyMs:event.latencyMs}):
   watchdog.recordFailure(input,{at,kind:event.kind,httpStatus:event.httpStatus??null,retryAfterMs:event.retryAfterMs??0});
  const events=[...previous.events,{at:iso(at),from:input.state,to:state.state,reason}].slice(-MAX_EVENTS);
  const next={version:VERSION,...i,revision:previous.revision+1,state,events};
  if(!valid(next,i))throw fail('PROVIDER_WATCHDOG_LEDGER_BAD_EVENT');
  const body=JSON.stringify(next);
  if(Buffer.byteLength(body)>MAX_BYTES)throw fail('PROVIDER_WATCHDOG_LEDGER_TOO_LARGE');
  tmp=file+'.'+crypto.randomUUID()+'.tmp';
  const handle=await fs.open(tmp,'wx');
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  await fs.rename(tmp,file);
  return structuredClone(next);
 }finally{
  if(tmp)await fs.unlink(tmp).catch(()=>{});
  await fs.rm(held,{recursive:true,force:true}).catch(()=>{});
 }
}
module.exports={VERSION,MAX_EVENTS,fileFor,read,transition};
