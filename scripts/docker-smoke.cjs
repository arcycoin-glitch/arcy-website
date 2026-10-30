#!/usr/bin/env node
'use strict';
// Docker build + container startup smoke test for the Railway Holder worker.
//   node scripts/docker-smoke.cjs            (exit 0 pass, 1 fail, 77 = no Docker daemon, skipped)
//   node scripts/docker-smoke.cjs --require-docker   (CI: a missing daemon is a failure)
// Uses the exact Railway settings: repo-root context, Dockerfile.holder-worker. Radar stays disabled
// (ARC_RADAR_INDEXER_ENABLED unset) and a throw-away token/volume is used; no network secrets involved.
const cp=require('node:child_process'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const root=path.join(__dirname,'..'),tag='arcy-holder-smoke:'+process.pid,name='arcy-holder-smoke-'+process.pid;
const need=process.argv.includes('--require-docker');
const sh=(args,o={})=>cp.spawnSync('docker',args,{cwd:root,encoding:'utf8',...o});
const info=sh(['info','--format','{{.ServerVersion}}']);
if(info.error||info.status!==0){const m='docker daemon unavailable: build/startup NOT exercised';console.error(m);process.exit(need?1:77);}
const token=crypto.randomBytes(24).toString('hex'),port=String(18000+process.pid%2000);
const volume=fs.mkdtempSync(path.join(os.tmpdir(),'arcy-worker-smoke-'));fs.mkdirSync(path.join(volume,'index'));const sentinel=path.join(volume,'index','release-sentinel.txt');fs.writeFileSync(sentinel,'preserve-existing-checkpoints');
let code=1;
const cleanup=()=>{sh(['rm','-f',name]);sh(['rmi','-f',tag]);fs.rmSync(volume,{recursive:true,force:true});};
try{
 const b=sh(['build','-f','Dockerfile.holder-worker','-t',tag,'.'],{stdio:['ignore','inherit','inherit']});
 if(b.status!==0)throw Error('docker build failed');
 const run=sh(['run','-d','--name',name,'-v',volume+':/data','-p','127.0.0.1:'+port+':'+port,'-e','PORT='+port,'-e','ARC_HOLDER_QUEUE_TOKEN='+token,
  '-e','ARC_HOLDER_STORAGE=local','-e','ARC_RADAR_INDEXER_ENABLED=false','-e','ARC_INDEX_CACHE_DIR=/data/index','-e','ARC_HOLDER_PUBLISHED_DIR=/data/published',tag]);
 if(run.status!==0)throw Error('docker run failed: '+run.stderr);
 const deadline=Date.now()+60000;let ok=false;
 const probe=async()=>{try{const r=await fetch('http://127.0.0.1:'+port+'/nope',{headers:{authorization:'Bearer '+token}});return r.status===404||r.status===401;}catch{return false;}};
 (async()=>{
  while(Date.now()<deadline){
   const st=sh(['inspect','-f','{{.State.Running}}',name]).stdout.trim();
   if(st!=='true')break;
   if(await probe()){ok=true;break;}
   await new Promise(r=>setTimeout(r,1000));}
  if(ok){const restart=sh(['restart',name]);if(restart.status!==0)ok=false;let answered=false;for(let i=0;i<30;i++){if(await probe()){answered=true;break;}await new Promise(r=>setTimeout(r,500));}ok=ok&&answered&&fs.readFileSync(sentinel,'utf8')==='preserve-existing-checkpoints';}
  const logs=sh(['logs',name]);const text=(logs.stdout||'')+(logs.stderr||'');
  if(/Cannot find module/.test(text))ok=false;
  // The HTTP probe alone could be answered before the worker loop is up: require the worker's own start event too.
  if(ok&&!/HOLDER_WORKER_STARTED/.test(text))ok=false;
  console.log(ok?'SMOKE PASS: container started and the Holder HTTP server answered':'SMOKE FAIL\n'+text.slice(-2000));
  code=ok?0:1;cleanup();process.exit(code);
 })();
}catch(e){console.error('SMOKE FAIL:',e.message);cleanup();process.exit(1);}
