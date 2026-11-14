'use strict';
// Durable store for autonomous risk verification: due queue, per-token job state, latest validated snapshot and
// worker metrics. Shared Redis (the same Upstash instance the holder index uses) when configured, so the Railway worker
// writes and the Search API (Vercel) reads; otherwise one local JSON file on a persistent volume
// (ARC_RISK_STORE_DIR | ARC_VERIFICATION_LEDGER_DIR | ARC_HOLDER_PUBLISHED_DIR). Never the Vercel tmp directory: with
// neither configured the store is UNAVAILABLE and callers fail closed (no queue, no snapshot).
// Every call is time-bounded. Snapshots hold full MetricEvidence records so readers re-evaluate freshness at read time.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const evidence=require('../verification/metric-evidence');
const PREFIX='arcy:risk:v1:',QUEUE=PREFIX+'queue',METRICS=PREFIX+'metrics',MAX_QUEUE=500,SNAPSHOT_TTL_S=14*86400,TIMEOUT_MS=1500;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const fail=code=>Object.assign(Error(code),{code});
const member=(network,token)=>{if(!Object.hasOwn(evidence.NETWORKS,network)||!ADDRESS.test(token))throw fail('RISK_STORE_INVALID_KEY');return network+':'+token;};
const parseMember=m=>{const [network,token]=String(m).split(':');try{member(network,token);return {network,token};}catch{return null;}};
function config(env){
 if(env.ARC_RISK_STORAGE!=='local'){
  const url=env.ARC_INDEX_REDIS_URL||env.UPSTASH_REDIS_REST_URL,token=env.ARC_INDEX_REDIS_TOKEN||env.UPSTASH_REDIS_REST_TOKEN;
  if(url&&token)return {mode:'redis',url,token};
  if(Boolean(url)!==Boolean(token))throw fail('RISK_STORE_CONFIGURATION_INCOMPLETE');
 }
 const dir=env.ARC_RISK_STORE_DIR||env.ARC_VERIFICATION_LEDGER_DIR||env.ARC_HOLDER_PUBLISHED_DIR;
 if(!dir)throw fail('RISK_STORE_UNAVAILABLE');
 return {mode:'local',dir:path.resolve(dir)};
}
async function redis(cfg,args,fetcher){
 let r;
 try{r=await fetcher(cfg.url,{method:'POST',headers:{authorization:'Bearer '+cfg.token,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(TIMEOUT_MS)});}
 catch{throw fail('RISK_STORE_UNAVAILABLE');}
 if(!r.ok)throw fail(r.status===429?'RISK_STORE_RATE_LIMITED':'RISK_STORE_UNAVAILABLE');
 let d;try{d=await r.json();}catch{throw fail('RISK_STORE_UNAVAILABLE');}
 if(!d||d.error||!Object.hasOwn(d,'result'))throw fail('RISK_STORE_UNAVAILABLE');
 return d.result;
}
// Local mode: one document, serialized writes, atomic rename. A corrupt file is reported, never silently reset.
let localTask=Promise.resolve();
async function local(cfg,fn){
 const task=localTask.catch(()=>{}).then(async()=>{
  await fs.mkdir(cfg.dir,{recursive:true});const file=path.join(cfg.dir,'risk-store.v1.json');
  let doc={queue:{},jobs:{},snapshots:{},metrics:null};
  try{doc=JSON.parse(await fs.readFile(file,'utf8'));if(!doc||typeof doc!=='object'||!doc.queue||!doc.jobs||!doc.snapshots)throw fail('RISK_STORE_CORRUPT');}
  catch(e){if(e.code==='RISK_STORE_CORRUPT'||e instanceof SyntaxError)throw fail('RISK_STORE_CORRUPT');if(e.code!=='ENOENT')throw fail('RISK_STORE_UNAVAILABLE');}
  const out=fn(doc);
  if(out&&out.write){const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(doc));await fs.rename(tmp,file);}
  return out?.value;
 });
 localTask=task;return task;
}
function open({env=process.env,fetcher=fetch}={}){
 const cfg=config(env),R=args=>redis(cfg,args,fetcher),L=fn=>local(cfg,fn);
 const json=v=>{if(v===null||v===undefined)return null;try{return JSON.parse(v);}catch{throw fail('RISK_STORE_CORRUPT');}};
 return {mode:cfg.mode,
  // Deduplicated: an existing member keeps its due time unless `replace`.
  async enqueue(network,token,at,{replace=false}={}){
   const m=member(network,token),score=Math.floor(at);
   if(cfg.mode==='redis')return await R(['EVAL',"if redis.call('ZSCORE',KEYS[1],ARGV[1]) == false and redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[4]) then return 0 end if ARGV[3] == '1' then redis.call('ZADD',KEYS[1],ARGV[2],ARGV[1]) else redis.call('ZADD',KEYS[1],'NX',ARGV[2],ARGV[1]) end return 1",1,QUEUE,m,score,replace?'1':'0',MAX_QUEUE])===1;
   return L(d=>{if(!Object.hasOwn(d.queue,m)&&Object.keys(d.queue).length>=MAX_QUEUE)return {value:false};if(replace||!Object.hasOwn(d.queue,m))d.queue[m]=score;return {write:true,value:true};});
  },
  async due(now,limit){
   const raw=cfg.mode==='redis'?await R(['ZRANGEBYSCORE',QUEUE,'-inf',Math.floor(now),'LIMIT',0,limit]):
    await L(d=>({value:Object.entries(d.queue).filter(([,s])=>s<=now).sort((a,b)=>a[1]-b[1]).slice(0,limit).map(([m])=>m)}));
   if(!Array.isArray(raw))throw fail('RISK_STORE_UNAVAILABLE');
   return raw.map(parseMember).filter(Boolean);
  },
  async remove(network,token){const m=member(network,token);if(cfg.mode==='redis')return void await R(['ZREM',QUEUE,m]);return L(d=>{delete d.queue[m];return {write:true};});},
  async depth(now){
   if(cfg.mode==='redis'){const [total,due]=await Promise.all([R(['ZCARD',QUEUE]),R(['ZCOUNT',QUEUE,'-inf',Math.floor(now)])]);return {total:Number(total)||0,due:Number(due)||0};}
   return L(d=>({value:{total:Object.keys(d.queue).length,due:Object.values(d.queue).filter(s=>s<=now).length}}));
  },
  async getJob(network,token){const m=member(network,token);return cfg.mode==='redis'?json(await R(['GET',PREFIX+'job:'+m])):L(d=>({value:d.jobs[m]||null}));},
  async setJob(network,token,job){const m=member(network,token),v=JSON.stringify(job);if(cfg.mode==='redis')return void await R(['SET',PREFIX+'job:'+m,v,'EX',SNAPSHOT_TTL_S]);return L(d=>{d.jobs[m]=JSON.parse(v);return {write:true};});},
  async putSnapshot(network,token,snapshot){const m=member(network,token),v=JSON.stringify(snapshot);if(v.length>200000)throw fail('RISK_SNAPSHOT_TOO_LARGE');
   if(cfg.mode==='redis')return void await R(['SET',PREFIX+'snap:'+m,v,'EX',SNAPSHOT_TTL_S]);return L(d=>{d.snapshots[m]=JSON.parse(v);return {write:true};});},
  async getSnapshot(network,token){const m=member(network,token);return cfg.mode==='redis'?json(await R(['GET',PREFIX+'snap:'+m])):L(d=>({value:d.snapshots[m]||null}));},
  async putMetrics(metrics){const v=JSON.stringify(metrics);if(cfg.mode==='redis')return void await R(['SET',METRICS,v,'EX',SNAPSHOT_TTL_S]);return L(d=>{d.metrics=JSON.parse(v);return {write:true};});},
  async getMetrics(){return cfg.mode==='redis'?json(await R(['GET',METRICS])):L(d=>({value:d.metrics||null}));}
 };
}
module.exports={open,member,parseMember,MAX_QUEUE,PREFIX};
