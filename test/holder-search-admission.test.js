'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const admission=require('../lib/holder-search-admission');
const storage=require('../lib/holder-storage');
const workerHttp=require('../lib/holder-worker-http');

test('durable Search admission coalesces per minute, caps per UTC day, survives reloading and leaves Radar ledger untouched',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'holder-admission-test-'));
 const base=Date.UTC(2026,10,4,9,0,0);
 const opts=t=>({now:()=>t,durableDir:dir,storageMode:'local',config:{url:null,token:null}});
 try{
  const first=await admission.reserve(opts(base));
  assert.equal(first.granted,true);assert.equal(first.used,1);
  const second=await admission.reserve(opts(base+2000));
  assert.equal(second.granted,false);assert.equal(second.reasonCode,'SEARCH_HOLDER_MINUTE_CAP');
  for(let i=1;i<8;i++)assert.equal((await admission.reserve(opts(base+i*61000))).granted,true);
  const ninth=await admission.reserve(opts(base+9*61000));
  assert.equal(ninth.granted,false);assert.equal(ninth.reasonCode,'SEARCH_HOLDER_DAILY_CAP');
  assert.equal((await admission.reserve(opts(base+86400000))).granted,true,'next UTC day resets quota');
  const filenames=await fs.readdir(dir);
  assert.ok(filenames.includes('holder-search-admissions.v1.json'));
  assert.ok(!filenames.includes('radar-quota.json'),'Radar quota ledger must remain untouched');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('missing or partial durable configuration fails closed',async()=>{
 assert.equal((await admission.reserve({storageMode:'local',durableDir:null,config:{url:null,token:null}})).ok,false);
 assert.equal((await admission.reserve({storageMode:'redis',durableDir:null,config:{url:null,token:null}})).ok,false);
 assert.equal((await admission.reserve({storageMode:'local',durableDir:'/tmp/unnecessary',config:{url:'https://redis.example',token:null}})).ok,false);
});

test('worker separate /queue-missing route refuses existing publications, deduplicates jobs, and requires shared admission',async()=>{
 const saved={port:process.env.PORT,token:process.env.ARC_HOLDER_QUEUE_TOKEN,jobStatus:storage.jobStatus,enqueue:storage.enqueue,reserve:admission.reserve};
 process.env.PORT='0';process.env.ARC_HOLDER_QUEUE_TOKEN='admission-test-secret';
 const calls=[];let job={hasCompleteSnapshot:true,queued:false};
 storage.jobStatus=async()=>job;
 storage.enqueue=async a=>{calls.push(a);return true;};
 let permit={ok:true,granted:true};
 admission.reserve=async()=>permit;
 let server;
 try{
  server=workerHttp.start();await once(server,'listening');
  const address='0x'+'a3'.repeat(20);
  async function request(url,token=process.env.ARC_HOLDER_QUEUE_TOKEN){
   const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({chainId:5042,address})});
   return {status:r.status,body:await r.json()};
  }
  assert.equal((await request('/queue-missing','wrong')).status,401);
  assert.equal((await request('/queue-missing')).status,409,'do not requeue completed-but-unpublished snapshot');
  assert.equal(calls.length,0);
  job={hasCompleteSnapshot:false,queued:true};
  assert.equal((await request('/queue-missing')).status,202,'deduplicate already queued contract');
  assert.equal(calls.length,0);
  job={hasCompleteSnapshot:false,queued:false};
  permit={ok:true,granted:false,reasonCode:'SEARCH_HOLDER_DAILY_CAP'};
  assert.equal((await request('/queue-missing')).status,429);
  assert.equal(calls.length,0);
  permit={ok:false,reasonCode:'SEARCH_HOLDER_ADMISSION_UNAVAILABLE'};
  assert.equal((await request('/queue-missing')).status,503);
  assert.equal(calls.length,0);
  permit={ok:true,granted:true};
  assert.equal((await request('/queue-missing')).status,202);
  assert.deepEqual(calls,[address]);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  storage.jobStatus=saved.jobStatus;storage.enqueue=saved.enqueue;admission.reserve=saved.reserve;
  if(saved.port===undefined)delete process.env.PORT;else process.env.PORT=saved.port;
  if(saved.token===undefined)delete process.env.ARC_HOLDER_QUEUE_TOKEN;else process.env.ARC_HOLDER_QUEUE_TOKEN=saved.token;
 }
});
