'use strict';
// Signed risk-snapshot publication: the same delivery model as holder snapshots (lib/holder-publication.js).
//   Worker:  after a completed analysis, writes <ARC_HOLDER_PUBLISHED_DIR>/risk/<network>-<token>.json as
//            {payload, signature} with ARC_HOLDER_SIGNING_KEY (Ed25519) and serves it at
//            GET /risk/snapshots/<network>/<token>.json (lib/holder-worker-http.js).
//   Search:  enqueues with POST /risk/queue (Bearer ARC_HOLDER_QUEUE_TOKEN, like holder jobs) and reads the signed file
//            from the worker origin of ARC_HOLDER_PUBLISHED_URL, verifying it with ARC_HOLDER_PUBLIC_KEY. An unsigned,
//            unverifiable or mismatching document is ignored (no snapshot), never trusted.
// Request-path safe: requires no producer (test/risk-bundle-boundary.test.js).
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const evidence=require('../verification/metric-evidence');
const ADDRESS=/^0x[0-9a-f]{40}$/,TIMEOUT_MS=1500,MAX_BYTES=300000;
const fail=code=>Object.assign(Error(code),{code});
const valid=(network,token)=>Object.hasOwn(evidence.NETWORKS,network)&&ADDRESS.test(token);
const dir=env=>env.ARC_HOLDER_PUBLISHED_DIR?path.join(env.ARC_HOLDER_PUBLISHED_DIR,'risk'):null;
const digest=records=>crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');

// Worker side. Returns {state, reasonCode}. Without a signing key nothing is published (Search then reads nothing).
async function publish(network,token,snapshot,env=process.env){
 if(!valid(network,token))throw fail('RISK_PUBLICATION_INVALID_KEY');
 const key=env.ARC_HOLDER_SIGNING_KEY,base=dir(env);
 if(!key||!base)return {state:'NOT_PUBLISHED',reasonCode:!key?'SIGNING_KEY_NOT_CONFIGURED':'PUBLISHED_DIR_NOT_CONFIGURED'};
 const body={schemaVersion:1,network,chainId:evidence.NETWORKS[network],token,publishedAt:new Date().toISOString(),recordsSha256:digest(snapshot.records||[]),snapshot};
 const payload=JSON.stringify(body);if(payload.length>MAX_BYTES)throw fail('RISK_SNAPSHOT_TOO_LARGE');
 const d={payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')};
 await fs.mkdir(base,{recursive:true});
 const file=path.join(base,network+'-'+token+'.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';
 await fs.writeFile(tmp,JSON.stringify(d));await fs.rename(tmp,file);
 return {state:'PUBLISHED',reasonCode:null};
}
async function readLocal(network,token,env=process.env){
 if(!valid(network,token)||!dir(env))return null;
 try{return JSON.parse(await fs.readFile(path.join(dir(env),network+'-'+token+'.json'),'utf8'));}catch{return null;}
}
// Verifies a signed document and returns the snapshot, or null. Checks signature, identity and the record digest.
function verify(d,network,token,env=process.env){
 try{
  const key=env.ARC_HOLDER_PUBLIC_KEY||(env.ARC_HOLDER_SIGNING_KEY?crypto.createPublicKey(env.ARC_HOLDER_SIGNING_KEY):null);
  if(!key||typeof d?.payload!=='string'||typeof d?.signature!=='string')return null;
  if(!crypto.verify(null,Buffer.from(d.payload),key,Buffer.from(d.signature,'base64')))return null;
  const body=JSON.parse(d.payload),s=body.snapshot;
  if(body.schemaVersion!==1||body.network!==network||body.token!==token||body.chainId!==evidence.NETWORKS[network]||!s||s.network!==network||s.token!==token)return null;
  if(!Array.isArray(s.records)||digest(s.records)!==body.recordsSha256)return null;
  return s;
 }catch{return null;}
}
function origin(raw){try{const u=new URL(raw);return u.protocol==='https:'?u.origin:null;}catch{return null;}}
// Search side: a store-shaped client over the worker (enqueue + getSnapshot only). null when not configured.
function remote({env=process.env,fetcher=fetch}={}){
 const queue=origin(env.ARC_HOLDER_QUEUE_URL||''),published=origin(env.ARC_HOLDER_PUBLISHED_URL||''),token=env.ARC_HOLDER_QUEUE_TOKEN;
 if(!queue||!published||!token||!env.ARC_HOLDER_PUBLIC_KEY)return null;
 return {mode:'worker',
  async enqueue(network,tokenAddress){
   if(!valid(network,tokenAddress))throw fail('RISK_STORE_INVALID_KEY');
   let r;try{r=await fetcher(queue+'/risk/queue',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({network,token:tokenAddress}),signal:AbortSignal.timeout(TIMEOUT_MS)});}
   catch{throw fail('RISK_STORE_UNAVAILABLE');}
   let d=null;try{d=await r.json();}catch{}
   if(r.status===401||r.status===403)throw fail('RISK_QUEUE_UNAUTHORIZED');
   if(r.ok)return d?.queued===true;
   if(d?.reasonCode==='RISK_WORKER_DISABLED')throw fail('RISK_WORKER_DISABLED');
   if(d?.reasonCode==='RISK_QUEUE_FULL')return false;
   throw fail('RISK_STORE_UNAVAILABLE');   // 404 (older worker without the route), 5xx, anything else
  },
  async getSnapshot(network,tokenAddress){
   if(!valid(network,tokenAddress))return null;
   let r;try{r=await fetcher(published+'/risk/snapshots/'+network+'/'+tokenAddress+'.json',{signal:AbortSignal.timeout(TIMEOUT_MS),cache:'no-store'});}catch{return null;}
   if(!r.ok)return null;
   let d;try{const text=await r.text();if(text.length>MAX_BYTES+4096)return null;d=JSON.parse(text);}catch{return null;}
   return verify(d,network,tokenAddress,env);
  }};
}
module.exports={publish,readLocal,verify,remote,digest};
