'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const scope=require('../search/server/lib/analysis-scope'),progress=require('../search/server/lib/progress');
const schema=require('../search/server/schema'),service=require('../search/server/lib/multichain-service');
const address='0x'+'7'.repeat(40),base={address,chainId:1,network:'ethereum',block:'0x123',token:{name:'Fixture',symbol:'TEST'}};
test('progress emits identity before deep completion, keeps all twenty fields and rejects a changed block',async()=>{
 const events=[];
 await scope.report('progress-contract',()=>progress.run(async()=>{
  progress.identity('ethereum',base);
  assert.equal(events[0].phase,'identity');assert.equal(events[0].report.block,base.block);
  assert.equal(Object.keys(events[0].report.cards).length,5);
  assert.equal(events[0].report.cards.mechanics.fields.mintCapability.reasonCode,'ANALYSIS_PENDING');
  assert.equal(Object.values(events[0].report.cards).flatMap(c=>Object.keys(c.fields)).length,20);
  const field={value:0,dataState:'DATA_FOUND',source:'Ethereum RPC',network:'ethereum',chainId:1,evidence:[{address,block:base.block}]};
  progress.card('ethereum',base,'activity',{fields:{priceUsd:field}});
  assert.equal(events.at(-1).report.cards.activity.fields.priceUsd.value,0);
  assert.throws(()=>progress.card('ethereum',{...base,block:'0x124'},'activity',{}),/mismatch/);
  return events.at(-1).report;
 }),e=>events.push(e));
});
test('wrong-chain metrics never become available in progressive snapshots',async()=>{
 const events=[];
 await scope.report('wrong-progress',()=>progress.run(async()=>{
  assert.throws(()=>progress.identity('arc',base),/chain mismatch/);
  progress.identity('ethereum',base);
  progress.card('ethereum',base,'holders',{fields:{holderCount:{value:42,dataState:'DATA_FOUND',source:'Other chain',chainId:5042,network:'arc',evidence:[{address}]}}});
  return {};
 }),e=>events.push(e));
 assert.equal(events.at(-1).report.cards.holders.fields.holderCount.value,null);
});
test('late progressive subscriber joins the same scan and receives its already verified snapshot',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r),a=[],b=[];
 const first=scope.report('join-progress',async()=>{calls++;scope.emit('identity',{block:'0x123'});await gate;return {ok:true}},e=>a.push(e));
 await new Promise(r=>setImmediate(r));
 const second=scope.report('join-progress',()=>{throw Error('Duplicate scan')},e=>b.push(e));
 assert.equal(a.length,1);assert.equal(b.length,1);release();await Promise.all([first,second]);assert.equal(calls,1);
});
test('throwing or closed progress listeners cannot abort another reader',async()=>{
 const value=await scope.report('broken-listener',async()=>{scope.emit('identity',{});return {ok:true}},()=>{throw Error('socket closed')});
 assert.equal(value.ok,true);
});
function response(){return {statusCode:200,headers:{},chunks:[],ended:false,once(){},setHeader(k,v){this.headers[k]=v},flushHeaders(){},write(x){this.chunks.push(JSON.parse(x))},end(){this.ended=true},json(x){this.body=x;return x}}}
test('progress HTTP flushes the first frame while the full scan is still pending',async()=>{
 const old=service.report,res=response();let release,calls=0;const gate=new Promise(r=>release=r);
 try{
  service.report=async({onProgress})=>{calls++;onProgress({phase:'identity',report:{ok:true,block:'0x123'}});await gate;return {ok:true,block:'0x123'}};
  const pending=require('../search/server/api/progress')({method:'GET',query:{chain:'ethereum',address}},res);
  await new Promise(r=>setImmediate(r));assert.equal(res.chunks.length,1);assert.equal(res.ended,false);
  release();await pending;assert.equal(calls,1);assert.equal(res.chunks.at(-1).phase,'complete');assert.equal(res.ended,true);
  assert.match(res.headers['Cache-Control'],/no-store/);assert.match(res.headers['Content-Type'],/ndjson/);
 }finally{release?.();service.report=old}
});
test('a deep failure after verified identity produces an error frame, never a successful final snapshot',async()=>{
 const old=service.report,res=response();
 try{
  service.report=async({onProgress})=>{onProgress({phase:'identity',report:{ok:true}});throw Error('provider timeout')};
  await require('../search/server/api/progress')({method:'GET',query:{chain:'ethereum',address}},res);
  assert.deepEqual(res.chunks.map(c=>c.phase),['identity','error']);assert.equal(res.ended,true);
 }finally{service.report=old}
});
test('invalid progressive query is rejected before scanning or streaming',async()=>{
 const old=service.report,res=response();let calls=0;
 try{
  service.report=async()=>{calls++};
  await require('../search/server/api/progress')({method:'GET',query:{chain:'ethereum',address,unsafe:'x'}},res);
  assert.equal(res.statusCode,400);assert.equal(calls,0);assert.equal(res.chunks.length,0);
 }finally{service.report=old}
});
test('Search legacy RPC override is async-local and cannot alter concurrent ordinary website reads',async()=>{
 const request=require('../lib/search-request'),core=require('../lib/core');
 const calls=[];
 await Promise.all(['A','B'].map(label=>request.withRpc(async(method,params)=>{calls.push([label,method,params]);return label},async()=>{
  await new Promise(r=>setTimeout(r,2));assert.equal(await core.rpc('eth_chainId',[]),label);
 })));
 assert.equal(request.rpc(),undefined);assert.deepEqual(calls.map(c=>c[0]).sort(),['A','B']);
});
test('slow discovery and artwork cannot hide healthy exact-contract candidates or expose unvalidated images',async()=>{
 const explorer=require('../search/server/lib/discover'),dex=require('../search/server/lib/dex-market'),logos=require('../search/server/lib/search-logo');
 const old=[explorer.searchExplorer,dex.discover,logos.enhance];let releaseSource,releaseArt;
 const sourceGate=new Promise(r=>releaseSource=r),artGate=new Promise(r=>releaseArt=r);
 try{
  explorer.searchExplorer=()=>sourceGate;
  dex.discover=async()=>[{network:'ethereum',chainId:1,address:'0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3',name:'Ondo',symbol:'ONDO',source:'Fixture DEX'}];
  logos.enhance=()=>artGate;
  const start=performance.now(),result=await service.discover({network:'ethereum',query:'ONDO'});
  assert.ok(performance.now()-start<1800,'optional providers must have a total bounded foreground wait');
  assert.ok(result.matches.some(m=>m.address==='0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3'));
  assert.ok(result.matches.every(m=>!m.logoUrl||m.logoUrl.startsWith('/')),'late artwork must not bypass image validation');
  assert.ok(result.unavailableSources.includes('Blockscout explorer index'));
 }finally{releaseSource?.([]);releaseArt?.([]);[explorer.searchExplorer,dex.discover,logos.enhance]=old}
});
test('pinned Search control cache never joins an ordinary pending control read at another block',async()=>{
 const request=require('../lib/search-request'),fields=require('../lib/fields');fields.clearCache();
 let release;const gate=new Promise(r=>release=r);
 const ordinary=fields.cached('control:'+address,10000,async()=>{await gate;return {block:'0x122'}});
 const res={setHeader(){},status(){return this},json(value){this.body=value;return value}};
 try{
  const route=request.route(async a=>fields.cached('control:'+a,10000,async()=>({block:'0x123'})));
  const pinned=request.withRpc(async()=>null,()=>route({method:'GET',query:{address,refresh:'1',scanId:'v5-0x123'}},res));
  await Promise.race([pinned,new Promise((_,reject)=>setTimeout(()=>reject(Error('Joined another block')),100))]);
  assert.equal(res.body.block,'0x123');
 }finally{release();await ordinary;fields.clearCache()}
});
test('disconnect before identity never attempts to write a JSON fallback to a closed socket',async()=>{
 const old=service.report,res=response();let close,release;
 const gate=new Promise(r=>release=r);res.once=(_event,callback)=>close=callback;
 res.json=()=>{throw Error('write after disconnect')};
 try{
  service.report=async({onProgress})=>{await gate;onProgress({phase:'identity',report:{ok:true}});return {ok:true}};
  const task=require('../search/server/api/progress')({method:'GET',query:{chain:'ethereum',address}},res);
  close();release();await task;assert.equal(res.chunks.length,0);assert.equal(res.ended,false);
 }finally{release?.();service.report=old}
});
