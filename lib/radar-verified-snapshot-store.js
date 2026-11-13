'use strict';
// Worker-side protected Pons VERIFIED snapshot storage. This endpoint is NOT a
// public Radar feed: holder-worker-http checks the existing bearer token.
const redisConfig=require('./redis-config');
const snapshots=require('./radar-v2/verified-pons-cache');
const KEY='arcy:radar:verified:pons',TTL_SECONDS=10800;
async function apply(request,{fetchImpl=global.fetch,config=redisConfig(),now=Date.now}={}){
 if(!request||!['get','put'].includes(request.mode)||Object.keys(request).some(k=>!['mode','snapshot'].includes(k)))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(request.mode==='get'&&Object.hasOwn(request,'snapshot'))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(request.mode==='put'&&!snapshots.valid(request.snapshot,now()))
  return {ok:false,reasonCode:'SNAPSHOT_REQUEST_INVALID'};
 if(!config.url||!config.token)return {ok:false,reasonCode:'SNAPSHOT_STORE_UNAVAILABLE'};
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
