'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const net=require('node:net');
const path=require('node:path');

async function availablePort(){
 const server=net.createServer();
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}
async function startServer(port){
 const child=spawn(process.execPath,['dev.cjs'],{
  cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe']});
 const deadline=new Promise((_,reject)=>setTimeout(()=>reject(Error('Local ARCY server did not start')),9000));
 await Promise.race([once(child.stdout,'data'),deadline]);
 return child;
}
async function query(port,path){
 const r=await fetch('http://127.0.0.1:'+port+path,{signal:AbortSignal.timeout(12000)});
 const text=await r.text();let json;
 try{json=JSON.parse(text)}catch{}
 return {status:r.status,json,text,contentType:r.headers.get('content-type')};
}
test('Local preview serves three-chain Search API, fails closed and preserves token-detail routing',async()=>{
 const port=await availablePort();
 const child=await startServer(port);
 try{
  const health=await query(port,'/api/search?action=health');
  assert.equal(health.status,200);
  assert.equal(health.json.ok,true);
  assert.deepEqual(health.json.networks,['arc','ethereum','robinhood']);
  assert.equal(health.json.expectedCards,5);
  assert.equal(health.json.expectedMetrics,20);
  const invalidAddress=await query(port,'/api/search?action=report&chain=arc&address=0xBAD');
  assert.equal(invalidAddress.status,400);
  assert.equal(invalidAddress.json.ok,false);
  const invalidChain=await query(port,'/api/search?action=discover&chain=solana&q=USDC');
  assert.equal(invalidChain.status,400);
  assert.equal(invalidChain.json.ok,false);
  const unknownAction=await query(port,'/api/search?action=not-in-allowlist');
  assert.equal(unknownAction.status,404);
  assert.equal(unknownAction.json.error,'UNKNOWN_SEARCH_ACTION');
  const homepage=await query(port,'/');
  assert.equal(homepage.status,200);
  assert.match(homepage.text,/search-upgrade\.js/);
  const address='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
  const details=await query(port,'/search/token/arc/'+address);
  assert.equal(details.status,200);
  assert.match(details.text,/PRICE HISTORY · GECKOTERMINAL LIVE EMBED/);
  assert.match(details.text,/id="cards"/);
  const unmatched=await query(port,'/search/token/solana/'+address);
  assert.equal(unmatched.status,404);
 }finally{
  child.kill('SIGTERM');
  if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,1200))]);
 }
});
