'use strict';
// Worker-side protected Pons VERIFIED snapshot storage. This endpoint is NOT a
// public Radar feed: holder-worker-http checks the existing bearer token.
const redisConfig=require('./redis-config');
const snapshots=require('./radar-v2/verified-pons-cache');
const KEY='arcy:radar:verified:pons',TTL_SECONDS=10800;
// The production durable worker runs single-replica with an existing /data
// volume, not Redis. Writes are atomic, fsync'd and use a bounded lease just as
// the existing quota-volume ledger does; holder checkpoints are untouched.
async function volume(request,{dir,now}){
 const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
 const file=path.join(dir,'radar-verified-pons.json');
 if(request.mode==='get'){
  try{
   const st=await fs.stat(file);
   if(!st.isFile()||st.size>snapshots.MAX_BYTES)return {ok:false,reasonCode:'SNAPSHOT_STORE_INVALID'};
   const content=JSON.parse(await fs.readFile(file,'utf8'));
   if(!snapshots.valid(content,now()))return {ok:false,reasonCode:'SNAPSHOT_STORE_INVALID'};
   return {ok:true,hit:true,snapshot:content};
  }catch(e){return e.code==='ENOENT'?{ok:true,hit:false}:{ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};}
 }
 const lock=file+'.lock';let held=false,tmp=null;
 try{
  await fs.mkdir(dir,{recursive:true});
  const deadline=Date.now()+1500;
  while(!held){
   try{await fs.mkdir(lock);held=true;}
   catch(e){if(e.code!=='EEXIST'||Date.now()>=deadline)throw e;await new Promise(resolve=>setTimeout(resolve,20));}
  }
  // A slow provider response cannot regress a more recent verified edition.
  try{
   const existing=JSON.parse(await fs.readFile(file,'utf8'));
   if(snapshots.valid(existing,now())&&Date.parse(existing.asOf)>Date.parse(request.snapshot.asOf))
    return {ok:true,saved:false};
  }catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  tmp=file+'.'+crypto.randomUUID()+'.tmp';
  const handle=await fs.open(tmp,'wx');
  try{await handle.writeFile(JSON.stringify(request.snapshot));await handle.sync();}finally{await handle.close();}
  await fs.rename(tmp,file);
  tmp=null;
  return {ok:true,saved:true};
 }catch{return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};}
 finally{
  if(tmp)await fs.rm(tmp,{force:true}).catch(()=>{});
  if(held)await fs.rmdir(lock).catch(()=>{});
 }
}
async function apply(request,{fetchImpl=global.fetch,config=redisConfig(),now=Date.now,durableDir=process.env.ARC_HOLDER_STORAGE==='local'?process.env.ARC_INDEX_CACHE_DIR:null}={}){
 if(!request||!['get','put'].includes(request.mode)||Object.keys(request).some(k=>!['mode','snapshot'].includes(k)))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(request.mode==='get'&&Object.hasOwn(request,'snapshot'))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(request.mode==='put'&&!snapshots.valid(request.snapshot,now()))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(!config.url||!config.token){
  if(typeof durableDir==='string'&&durableDir.startsWith('/'))return volume(request,{dir:durableDir,now});
  return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};
 }
 try{
  const payload=request.mode==='get'?['GET',KEY]:
   ['SET',KEY,JSON.stringify(request.snapshot),'EX',String(TTL_SECONDS)];
  const response=await fetchImpl(config.url.replace(/\/$/,''),{
   method:'POST',headers:{authorization:'Bearer '+config.token,'content-type':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(1300)
  });
  if(!response.ok)return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};
  const data=await response.json();
  if(!data||!Object.hasOwn(data,'result'))return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};
  if(request.mode==='put')return data.result==='OK'?{ok:true,saved:true}:{ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};
  if(data.result===null)return {ok:true,hit:false};
  let stored;try{stored=JSON.parse(data.result);}catch{return {ok:false,reasonCode:'SNAPSHOT_STORE_INVALID'};}
  if(!snapshots.valid(stored,now()))return {ok:false,reasonCode:'SNAPSHOT_STORE_INVALID'};
  return {ok:true,hit:true,snapshot:stored};
 }catch{return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};}
}
module.exports={apply,KEY,TTL_SECONDS};
