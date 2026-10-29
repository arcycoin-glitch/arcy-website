'use strict';
// Deterministic worker-cycle simulator: real holder-refresh / holder-candidates / holder-rpc / holder-log-range / local
// checkpoints, with a virtual clock (sleep advances it) and a scripted provider. No network, no real waiting.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const hex=n=>'0x'+BigInt(n).toString(16),pad=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
async function create({tokens,head=5_000_000,faults=()=>null,interval=500,endpoints=['primary','quicknode'],wallets=3,limits={}}={}){
 require('../../lib/holder-progress')._reset();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-sim-')),old={};
 for(const [k,v] of Object.entries({ARC_HOLDER_STORAGE:'local',ARC_INDEX_CACHE_DIR:dir,ARC_HOLDER_WORKER_RPC:'1',...limits})){old[k]=process.env[k];process.env[k]=v;}
 delete process.env.ARC_INDEX_REDIS_URL;
 let T=Date.now();const clock=()=>T;
 const budget=require('../../lib/holder-budget');budget._clock(clock);
 const core=require('../../lib/core'),rpcLib=require('../../lib/holder-rpc'),storage=require('../../lib/holder-storage'),refresh=require('../../lib/holder-refresh'),worker=require('../../lib/holder-candidates'),reader=require('../../lib/balance-reader');
 const stats={requests:0,perUrl:{},byMethod:{},logsCalls:0};
 const client=rpcLib.create({endpoints,now:clock,interval,sleep:async ms=>{T+=ms;},fetcher:async(url,o)=>{
  const p=JSON.parse(o.body),items=Array.isArray(p)?p:[p];stats.requests+=items.length;stats.perUrl[url]=(stats.perUrl[url]||0)+items.length;
  const f=faults(url,items,T);if(f)return f;
  const one=r=>{stats.byMethod[r.method]=(stats.byMethod[r.method]||0)+1;if(r.method==='eth_getLogs')stats.logsCalls++;
   return {id:r.id,result:r.method==='eth_chainId'?'0x13b2':r.method==='eth_getBlockByNumber'?{hash:'0x'+'a'.repeat(64)}:r.method==='eth_getLogs'?[]:r.method==='eth_call'?pad(100):'0x1'};};
  return {ok:true,json:async()=>Array.isArray(p)?p.map(one):one(p)};}});
 const saved={};const patch=(o,k,v)=>{saved[o.__id||k]=saved[o.__id||k];};
 const orig={core:{...core},reader:reader.balances,ready:refresh.readyInMs,storage:{due:storage.due,enqueue:storage.enqueue,setJob:storage.setJob}};
 core.rpc=(m,p)=>client.rpc(m,p);core.batch=calls=>client.batch(calls);core.call=(to,data,block)=>client.rpc('eth_call',[{to,data},block||'latest']);core.context=async()=>({block:hex(head)});
 reader.balances=async(t,addresses)=>({method:'Pinned fixture',values:addresses.map(()=>pad(100))});
 refresh.readyInMs=()=>client.readyInMs();
 const queue=new Map(),jobs=new Map();
 storage.due=async limit=>[...queue].filter(([,at])=>at<=T).sort((a,b)=>a[1]-b[1]).slice(0,Math.max(1,Math.min(50,limit))).map(([a])=>a);
 storage.enqueue=async(a,at=T,replace=false)=>{if(replace||!queue.has(a))queue.set(a,Math.floor(at));return true;};
 storage.setJob=async(a,u)=>{jobs.set(a,{...u,at:T});};
 const total=BigInt(wallets)*100n,walletList=Array.from({length:wallets},(_,i)=>addr(0xf000+i));
 const state={};
 for(const t of tokens){
  const a=t.address,name=a+'-candidates',cursor=head-t.remaining+1;
  const cp={version:1,address:a,chainId:5042,startedAt:T,phase:'TAIL',offset:0,addresses:walletList.slice(),balances:[],balanceCursor:0,previousBlock:hex(1),previousAnchor:'0x'+'a'.repeat(64),block:hex(head),anchor:'0x'+'a'.repeat(64),total:total.toString(),tailCursor:cursor,tailRange:t.width||1000,discoveryIndexedBlock:0,transferTail:undefined};
  delete cp.transferTail;
  await storage.withLease(name,()=>storage.save(name,cp));
  queue.set(a,t.dueAt??T-1000);state[a]={start:cursor,head,done:false};
 }
 async function cursorOf(a){const s=await require('../../lib/holder-index').load(a+'-candidates');return s;}
 async function progress(){const out={};for(const t of tokens){const s=await cursorOf(t.address);out[t.address]={phase:s?.phase,cursor:s?.tailCursor??null,balanceCursor:s?.balanceCursor,done:s?.phase==='COMPLETE'};}return out;}
 const log=[];
 // One worker iteration exactly as scripts/holder-worker.cjs does it: refresh.run(limit 5, 40 s, 5 s) then a 5 s / 30 s sleep.
 async function iteration(){const before=await progress(),t0=T,m0=client.metrics();
  const results=await refresh.run({limit:5,budgetMs:40000,incompleteDelayMs:5000});
  T+=results.length?5000:30000;
  const after=await progress(),m1=client.metrics();
  const entry={t0:t0-0,elapsed:T-t0,results,pacingMs:m1.pacingMs-m0.pacingMs,cooldownWaitMs:m1.cooldownWaitMs-m0.cooldownWaitMs,backoffMs:m1.backoffMs-m0.backoffMs,deltas:{}};
  for(const a of Object.keys(after))entry.deltas[a]=(after[a].cursor??0)-(before[a].cursor??0);
  log.push(entry);return entry;}
 async function runUntil({maxIterations=500,maxVirtualMs=6*3600e3}={}){const t0=T;let n=0;
  while(n<maxIterations&&T-t0<maxVirtualMs){await iteration();n++;if(Object.values(await progress()).every(x=>x.done))break;}
  return {iterations:n,virtualMs:T-t0};}
 function cleanup(){for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
  Object.assign(core,orig.core);reader.balances=orig.reader;refresh.readyInMs=orig.ready;Object.assign(storage,orig.storage);budget._clock(null);fs.rmSync(dir,{recursive:true,force:true});}
 return {client,stats,log,iteration,runUntil,progress,cleanup,jobs,queue,now:()=>T,advance:ms=>{T+=ms;},head,state};
}
module.exports={create,hex,pad,addr};
