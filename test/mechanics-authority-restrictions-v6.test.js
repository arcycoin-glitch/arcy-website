'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const privilege=require('../search/server/lib/mechanics-privilege-state');
const restrictions=require('../search/server/lib/mechanics-restrictions');
const probe=require('../search/server/lib/mechanics-proxy-probe');
const S=privilege.selector,ZERO='0x'+'0'.repeat(40),TOKEN='0x'+'11'.repeat(20),OWNER='0x'+'22'.repeat(20),PENDING='0x'+'33'.repeat(20),IMPL='0x'+'44'.repeat(20),block='0x1234';
const word=a=>'0x'+a.slice(2).padStart(64,'0');
const runtime=signatures=>'0x'+signatures.map(s=>'8063'+S(s).slice(2)+'146100ff57').join('')+'00';
function rpcModel({code,owner=OWNER,pending=PENDING,implementation=null}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  const {id,method,params}=JSON.parse(init.body);calls.push({method,params});
  let result;
  if(method==='eth_chainId')result='0x1';
  else if(method==='eth_blockNumber')result=block;
  else if(method==='eth_getStorageAt')result='0x'+'0'.repeat(64);
  else if(method==='eth_getCode')result=params[0]===TOKEN?code:params[0]===IMPL?implementation:'0x';
  else if(method==='eth_call'){
   assert.equal(params[1],block);
   if(params[0].data===S('owner()'))result=word(owner);
   else if(params[0].data===S('pendingOwner()'))result=word(pending);
   else if(params[0].from===owner)result='0x';
   else return new Response(JSON.stringify({jsonrpc:'2.0',id,error:{code:3,message:'execution reverted'}}));
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));
 };
 return {calls,fetcher};
}

test('burn detection and pending ownership never become active burn/ownership powers',async()=>{
 const node=rpcModel({code:runtime(['owner()','pendingOwner()','acceptOwnership()','mint(address,uint256)','burn(uint256)','burn(address,uint256)','burnFrom(address,uint256)','revokeRole(bytes32,address)'])});
 const result=await privilege.classify({network:'ethereum',address:TOKEN,fetcher:node.fetcher,url:'https://rpc.test',paceMs:0});
 assert.equal(result.authorities.find(a=>a.kind==='OWNER').holder,OWNER);
 assert.deepEqual(result.authorities.find(a=>a.kind==='PENDING_OWNER'),{kind:'PENDING_OWNER',holder:PENDING,holderType:'EOA',state:'PENDING',method:'pendingOwner()',block});
 assert.equal(result.ownershipTransfer.status,'GETTER_REPORTED');
 assert.match(result.ownershipTransfer.scope,/not the current owner/);
 const burn=result.functions.filter(f=>f.category==='BURN');assert.equal(burn.length,3);
 for(const fn of burn){
  assert.equal(fn.state,'FUNCTION_DETECTED');
  assert.equal(fn.authorityAssessment.authorityHolder,'NOT_VERIFIED');
  assert.equal(fn.authorityAssessment.currentBlockUsability,'NOT_VERIFIED');
  assert.ok(!node.calls.some(c=>c.method==='eth_call'&&c.params[0].data.startsWith(fn.selector)));
 }
 const mint=result.functions.find(f=>f.category==='MINT');
 assert.equal(mint.authorityAssessment.authorityHolder,'CONFIRMED_AT_BLOCK');
 assert.equal(mint.authorityAssessment.currentBlockUsability,'SIMULATED_WITH_FIXED_ARGUMENTS');
 assert.equal(result.functions.find(f=>f.signature==='acceptOwnership()').state,'FUNCTION_DETECTED');
 assert.ok(result.cost.rpcCalls<=28);
});

test('zero owner revocation remains scoped to its tested path while burn roles stay unresolved',async()=>{
 const node=rpcModel({code:runtime(['owner()','mint(address,uint256)','burn(address,uint256)','grantRole(bytes32,address)']),owner:ZERO});
 const result=await privilege.classify({network:'ethereum',address:TOKEN,fetcher:node.fetcher,url:'https://rpc.test',paceMs:0});
 const mint=result.functions.find(f=>f.category==='MINT'),burn=result.functions.find(f=>f.category==='BURN');
 assert.equal(mint.state,'PRIVILEGE_REVOKED');
 assert.equal(mint.authorityAssessment.revocation,'OWNER_ROUTE_ONLY');
 assert.equal(burn.authorityAssessment.revocation,'NOT_VERIFIED');
 assert.equal(result.functions.find(f=>f.category==='ROLE_ADMIN').authorityAssessment.authoritySource,'NOT_VERIFIED');
});

test('Solady 44-byte clone is labelled separately and uses pinned implementation code',async()=>{
 const node=rpcModel({code:'0x3d3d3d3d363d3d37363d73'+IMPL.slice(2)+'5af43d3d93803e602a57fd5bf3',implementation:runtime(['owner()','mint(address,uint256)'])});
 const result=await privilege.classify({network:'ethereum',address:TOKEN,fetcher:node.fetcher,url:'https://rpc.test',paceMs:0});
 assert.deepEqual(result.proxy,{kind:'Minimal proxy (Solady LibClone, 44-byte)',implementation:IMPL});
 assert.ok(node.calls.some(c=>c.method==='eth_getCode'&&c.params[0]===IMPL&&c.params[1]===block));
});

test('pinned privilege reads coalesce, preserve request IDs and retry transient failure without crossing blocks',async()=>{
 let calls=0,fail=true;
 const fetcher=async(url,init)=>{
  calls++;const {id,params}=JSON.parse(init.body);
  await new Promise(r=>setTimeout(r,params[0]===TOKEN?5:1));
  if(fail){fail=false;return new Response('{}',{status:429});}
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result:'0x6000'}));
 };
 const reader=privilege.createReader({url:'https://rpc.test',chainId:1,fetcher});
 assert.equal((await reader.send('eth_getCode',[TOKEN,block])).state,'PROVIDER_ERROR');
 const answers=await Promise.all([reader.send('eth_getCode',[TOKEN,block]),reader.send('eth_getCode',[TOKEN,block]),reader.send('eth_getCode',[OWNER,block])]);
 assert.ok(answers.every(a=>a.state==='OK'),'concurrent different requests retain their own response IDs');
 assert.equal(calls,3,'retry failed read; duplicate same-block read coalesces');
 await reader.send('eth_getCode',[TOKEN,block]);assert.equal(calls,3);
 await reader.send('eth_getCode',[TOKEN,'0x1235']);assert.equal(calls,4);
});

test('restriction capability presence and current state remain separate, with source and block provenance',async()=>{
 const sourceDigest='d'.repeat(64),proof={sourceDigest};
 const base={fields:{},proof,block,details:{observations:[{method:'paused()',value:false,sourceDigest,block}]}};
 const result=await restrictions.derive({...base,profile:'PAXOS_SUPPLY_CONTROLLED'});
 assert.equal(result.status,'VERIFIED_SOURCE_AND_STATE');
 assert.equal(result.extra.capabilities.find(c=>c.capability==='PAUSE').currentState,'INACTIVE');
 assert.equal(result.extra.capabilities.find(c=>c.capability==='FREEZE').currentState,'NOT_VERIFIED','not paused never implies nobody is frozen');
 for(const observation of [{method:'paused()',value:true,sourceDigest,block:'0x1233'},{method:'paused()',value:true,sourceDigest:'other',block}]){
  const stale=await restrictions.derive({...base,details:{observations:[observation]},profile:'PAXOS_SUPPLY_CONTROLLED'});
  assert.equal(stale.value,'Pause + freeze');assert.equal(stale.status,'VERIFIED_SOURCE');
 }
 const staleMini=await restrictions.derive({...base,profile:'MINIME_CONTROLLED',details:{observations:[{method:'transfersEnabled()',value:true,sourceDigest:'other',block}]}});
 assert.equal(staleMini.value,'Controller-gated transfers');assert.equal(staleMini.status,'VERIFIED_SOURCE');
 const expired=await restrictions.derive({...base,profile:'FIXED_LAUNCH_RESTRICTIONS',details:{observations:[{method:'restrictionEndBlock()',raw:'4659',sourceDigest,block}]}});
 assert.ok(expired.extra.capabilities.every(c=>c.currentState==='EXPIRED'));
 const wrongLaunch=await restrictions.derive({...base,profile:'FIXED_LAUNCH_RESTRICTIONS',details:{observations:[{method:'restrictionEndBlock()',raw:'1',sourceDigest,block:'0x1'}]}});
 assert.equal(wrongLaunch,null);
});

test('delegation proof requires an answered baseline and fails closed on timeout, rate limit and malformed replies',async()=>{
 for(const baseline of [null,undefined,'garbage',new Error('HTTP 429'),new Error('RPC timeout'),Object.assign(new Error('capacity'),{rpcCode:-32005})]){
  let calls=0;
  const read=async()=>{calls++;if(calls===1){if(baseline instanceof Error)throw baseline;return baseline;}return word(TOKEN);};
  assert.equal(await probe.delegationProbe({read,address:TOKEN,slot:'0x'+'ab'.repeat(32),block}),null);
  assert.equal(calls,1,'no override request after an unanswered baseline');
 }
 for(const error of [Object.assign(new Error('execution reverted'),{rpcCode:3}),Object.assign(new Error('RPC unavailable'),{code:'GETTER_REVERTED',rpcCode:-32000})]){
  const read=async(method,params)=>{if(params.length===2)throw error;return word(TOKEN);};
  assert.equal((await probe.delegationProbe({read,address:TOKEN,slot:'0x'+'ab'.repeat(32),block})).baseline,'REVERTED');
 }
});

test('ARC and Robinhood preserve explicit revert metadata without changing provider retry policy',async()=>{
 const original=global.fetch;
 try{
  for(const network of ['arc','robinhood']){
   const transport=require('../search/server/lib/'+network+'-rpc');
   for(const fixture of [
    {error:{code:3,message:'execution reverted'},reverted:true,retry:false},
    {error:{code:-32000,message:'execution reverted: forbidden'},reverted:true,retry:false},
    {error:{code:-32000,message:'opaque provider error'},reverted:false,retry:false},
    {error:{code:-32005,message:'rate limit exceeded'},reverted:false,retry:true},
    {http:429,reverted:false,retry:true},
    {timeout:true,reverted:false,retry:true}
   ]){
    global.fetch=async(url,init)=>{
     if(fixture.timeout)throw new DOMException('RPC timed out','TimeoutError');
     if(fixture.http)return new Response('{}',{status:fixture.http});
     const {id}=JSON.parse(init.body);return new Response(JSON.stringify({jsonrpc:'2.0',id,error:fixture.error}));
    };
    await assert.rejects(()=>transport.requestAt('https://rpc.test/'+network,'eth_call',[{to:TOKEN,data:'0x12345678'},block]),error=>{
     assert.equal(error.code==='GETTER_REVERTED',fixture.reverted,network+' explicit revert metadata');
     assert.equal(transport.retryable(error),fixture.retry,network+' retry policy');
     return true;
    });
   }
  }
 }finally{global.fetch=original;}
});
