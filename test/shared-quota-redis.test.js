'use strict';
// Runs the REAL Lua script on a REAL redis-server (skipped when redis-server is not installed).
// Chain under test: Radar client (budget.shared) -> worker HTTP route -> quota-store -> Upstash-REST shim -> redis-server EVAL.
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),cp=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(cp.execFile);
const have=cp.spawnSync('redis-server',['--version']).status===0;
const PORT=36000+Math.floor(Math.random()*2000);
const cli=(...a)=>exec('redis-cli',['-p',String(PORT),...a]).then(r=>r.stdout.trim());
test('shared quota never exceeds the monthly cap (concurrency, cold starts, refunds, failures, Redis outage)',{skip:!have&&'redis-server not installed'},async()=>{
 const srv=cp.spawn('redis-server',['--port',String(PORT),'--save','','--appendonly','no'],{stdio:'ignore'});
 let shim,worker;
 try{
  for(let i=0;i<50;i++){try{if(await cli('ping')==='PONG')break;}catch{}await new Promise(r=>setTimeout(r,100));}
  let outage=false,maxSeen=0;
  shim=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',async()=>{
   if(outage){res.statusCode=500;return res.end('{}');}
   try{const cmd=JSON.parse(b);const out=await cli(...cmd.slice(0,1),...cmd.slice(1));const nums=out.split('\n').map(Number);maxSeen=Math.max(maxSeen,nums[1]||0);res.end(JSON.stringify({result:nums}));}catch{res.statusCode=500;res.end('{}');}
  });}).listen(0);await new Promise(r=>shim.once('listening',r));
  process.env.ARC_INDEX_REDIS_URL='http://127.0.0.1:'+shim.address().port;process.env.ARC_INDEX_REDIS_TOKEN='x';
  process.env.PORT='0';process.env.ARC_HOLDER_QUEUE_TOKEN='tok';
  worker=require('../lib/holder-worker-http').start();await new Promise(r=>worker.once('listening',r));
  const env={ARC_HOLDER_QUEUE_URL:'http://127.0.0.1:'+worker.address().port+'/queue',ARC_HOLDER_QUEUE_TOKEN:'tok',RADAR_V2_MONTHLY_CREDIT_CAP:'100'};
  const now=Date.parse('2026-10-30T12:00:00Z'),budget=require('../lib/radar-v2/budget'),CAP=100;
  let netExpected=0,granted=0,refused=0,unverifiable=0,seed=7;const rnd=()=>(seed=(seed*1664525+1013904223)%4294967296)/4294967296;
  // 12 "instances" x 40 attempts each, all concurrent. Each cycle: reserve 4; then either the provider call fails (keeps 4) or succeeds using 1..4 (refunds the rest).
  const cycle=async()=>{
   const r=await budget.shared('reserve',4,{env,now});
   if(r==='refused'){refused++;return;}if(r!=='granted'){unverifiable++;return;}
   granted++;netExpected+=4;
   if(rnd()<0.6){const used=1+Math.floor(rnd()*4);if(used<4){const s=await budget.shared('settle',used-4,{env,now});if(s==='granted'||s==='refused')netExpected+=used-4;}}
  };
  // outage window in the middle of the run
  const outageTimer=setTimeout(()=>{outage=true;setTimeout(()=>{outage=false;},150);},80);
  await Promise.all(Array.from({length:12},async()=>{for(let i=0;i<40;i++)await cycle();}));
  clearTimeout(outageTimer);
  const final=Number(await cli('GET','arcy:radar:credits:2026-10'));
  assert.ok(maxSeen<=CAP,'counter returned by any script call never exceeded the cap: '+maxSeen);
  assert.ok(final<=CAP,'final counter within cap: '+final);
  assert.ok(granted>0&&refused>0,'both granted and refused paths were exercised: '+JSON.stringify({granted,refused,unverifiable}));
  assert.ok(unverifiable>0,'outage window produced fail-closed results (no spend): '+unverifiable);
  assert.equal(final,netExpected-0,'Redis counter equals the net of acknowledged reserves/refunds (outage calls changed nothing)');
 }finally{worker&&worker.close();shim&&shim.close();srv.kill();}
});
