'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{spawnSync,spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs');
const SCRIPT=path.join(__dirname,'..','scripts','scheduled-health.cjs');
const IDS={arc:5042,ethereum:1,robinhood:4663};
function run(handler){
 return new Promise(resolve=>{
  const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');res.setHeader('content-type','application/json');res.end(JSON.stringify(handler(u.searchParams)))});
  server.listen(0,'127.0.0.1',()=>{
   const child=spawn(process.execPath,[SCRIPT],{env:{...process.env,ARCY_BASE:'http://127.0.0.1:'+server.address().port}});
   let out='';child.stdout.on('data',d=>out+=d);
   child.on('close',code=>{server.close();resolve({code,out})});
  });
 });
}
const healthy=p=>p.get('action')==='health'?{ok:true,expectedCards:5}:p.get('action')==='token'?{ok:true,chainId:IDS[p.get('chain')],address:p.get('address'),block:'0x10',totalSupplyRaw:'1000'}:{ok:true,network:p.get('chain'),chainId:IDS[p.get('chain')],matches:[]};
test('health check passes with EMPTY discovery results (no dependency on any historical token listing)',async()=>{
 const r=await run(healthy);assert.equal(r.code,0,r.out);
 const s=JSON.parse(r.out.trim().split('\n')[0]);assert.equal(s.checked,7);assert.equal(s.failed,0);
});
test('health check makes only 7 read-only requests and does not depend on the historical ARCY token',()=>{
 const src=fs.readFileSync(SCRIPT,'utf8');
 assert.doesNotMatch(src,/73e5f588d27d6b5ec89c89c82692d1e7fecbd38b/i);
 assert.doesNotMatch(src,/discover-arcy|ARCY not found/);
});
test('health check fails on a cross-chain identity leak',async()=>{
 const r=await run(p=>p.get('action')==='health'?{ok:true,expectedCards:5}:
  {ok:true,network:p.get('chain'),chainId:IDS[p.get('chain')],matches:p.get('chain')==='arc'?[{network:'ethereum',chainId:1,address:'0x'+'a'.repeat(40)}]:[]});
 assert.equal(r.code,1);assert.match(r.out,/discover-isolation-arc/);
});
test('health check fails on a wrong card count',async()=>{
 assert.equal((await run(p=>p.get('action')==='health'?{ok:true,expectedCards:6}:healthy(p))).code,1);
});
test('health check fails when an exact on-chain read is empty, on the wrong chain, or has zero supply',async()=>{
 for(const bad of [{ok:false},{chainId:999},{totalSupplyRaw:'0'},{block:'nope'},{address:'0x'+'1'.repeat(40)}]){
  const r=await run(p=>p.get('action')==='token'?{...healthy(p),...bad}:healthy(p));
  assert.equal(r.code,1,JSON.stringify(bad));assert.match(r.out,/exact-token-/);
 }
});
test('health check does not call the Radar (no provider credits are spent by monitoring)',()=>{
 assert.doesNotMatch(fs.readFileSync(SCRIPT,'utf8'),/radar|holders|report/i);
});
