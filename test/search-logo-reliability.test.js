'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const artwork=require('./helpers/logo-artwork.cjs');
const images=require('../search/server/lib/logo-validation');
const logos=require('../search/server/lib/search-logo');
const address='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const url='https://cdn.robinhood.com/ncw_assets/logos/'+address+'.png';
const item=()=>({network:'robinhood',chainId:4663,address,symbol:'TSLA',
 source:'Robinhood official asset registry',registryMatched:true,logoUrl:url,
 identity:{status:'REGISTRY_MATCHED'}});
function untilAborted(signal,onAbort){
 return new Promise((_,reject)=>{
  const abort=()=>{onAbort();reject(new DOMException('Fixture timeout','AbortError'));};
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
}

test('exact-chain TSLA art is deterministic and does not call global fetch',async()=>{
 const original=global.fetch;let reads=0,live=0;
 global.fetch=async()=>{live++;throw Error('Unit test must not use the network');};
 try{
  for(let i=0;i<3;i++){
   const [result]=await logos.enhance('robinhood',[item()],{fetchImpl:async(u,o)=>{
    reads++;assert.equal(u,url);assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');return artwork.response();
   }});
   assert.equal(result.logoUrl,url);assert.equal(result.identity.status,'REGISTRY_MATCHED');
  }
  assert.equal(reads,3);assert.equal(live,0);
 }finally{global.fetch=original;}
});

test('the existing one-second art deadline reproduces null without changing identity',async()=>{
 let aborted=false,reads=0;
 const [result]=await logos.enhance('robinhood',[item()],{fetchImpl:async(u,o)=>{
  assert.equal(u,url);reads++;return untilAborted(o.signal,()=>{aborted=true;});
 }});
 assert.equal(aborted,true);assert.equal(reads,1);assert.equal(result.logoUrl,null);
 assert.equal(result.logoSource,null);assert.deepEqual(result.identity,item().identity);
});

test('HTTP 403/429/503 and network failure retain identity and return no unvalidated art',async()=>{
 for(const status of [403,429,503,'network']){
  let reads=0;const [result]=await logos.enhance('robinhood',[item()],{fetchImpl:async(u)=>{
   reads++;assert.equal(u,url);if(status==='network')throw Error('Fixture network failure');
   return new Response(null,{status});
  }});
  assert.equal(reads,1);assert.equal(result.logoUrl,null);assert.equal(result.logoSource,null);
  assert.equal(result.identity.status,'REGISTRY_MATCHED');
 }
});

test('image body timeout after HTTP headers fails closed',async()=>{
 let aborted=false;
 const result=await images.validate(url,{registry:true,address,timeoutMs:10,fetcher:async(_,o)=>
  new Response(new ReadableStream({start(controller){o.signal.addEventListener('abort',()=>{
   aborted=true;controller.error(new DOMException('Body stalled','AbortError'));
  },{once:true});}}),{headers:{'content-type':'image/png'}})});
 assert.equal(aborted,true);assert.equal(result,null);
});

test('negative cache is bounded: outage does not poison subsequent successful artwork forever',async()=>{
 const original=global.fetch,u='https://cdn.dexscreener.com/cms/images/unit-negative-recovery.png';
 let reads=0,healthy=false;global.fetch=async()=>{reads++;return healthy?artwork.response():new Response(null,{status:429});};
 try{
  assert.equal(await images.validate(u),null);healthy=true;
  assert.equal(await images.validate(u),null);assert.equal(reads,1);
  const restored=await images.validate(u,{now:Date.now()+60000});
  assert.equal(restored.url,u);assert.equal(restored.width,32);assert.equal(reads,2);
 }finally{global.fetch=original;}
});

test('validated art coalesces concurrent reads and warm cache preserves exact contract checks',async()=>{
 const original=global.fetch;let reads=0;global.fetch=async()=>{reads++;return artwork.response();};
 try{
  const [a,b]=await Promise.all([images.validate(url,{registry:true,address}),images.validate(url,{registry:true,address})]);
  assert.equal(a.url,url);assert.equal(b.url,url);assert.equal(reads,1);
  assert.equal((await images.validate(url,{registry:true,address})).url,url);assert.equal(reads,1);
  assert.equal(await images.validate(url,{registry:true,address:'0x'+'b'.repeat(40)}),null);
  assert.equal(reads,1);
 }finally{global.fetch=original;}
});

test('wrong chain, wrong registry contract, redirects and executable responses never become TSLA art',async()=>{
 let reads=0;const fetchImpl=async()=>{reads++;return artwork.response();};
 const [wrongChain]=await logos.enhance('robinhood',[{...item(),chainId:1}],{fetchImpl});
 const [wrongContract]=await logos.enhance('robinhood',[{...item(),address:'0x'+'b'.repeat(40)}],{fetchImpl});
 assert.equal(wrongChain.logoUrl,null);assert.equal(wrongContract.logoUrl,null);assert.equal(reads,0);
 for(const response of [new Response('<svg onload="bad()"/>',{headers:{'content-type':'image/svg+xml'}}),
  new Response(null,{status:302,headers:{location:'https://evil.example/icon.png'}})]){
  const [result]=await logos.enhance('robinhood',[item()],{fetchImpl:async()=>response});
  assert.equal(result.logoUrl,null);
 }
});
