'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),eth=require('../search/server/lib/eth');
const good=options=>Response.json({jsonrpc:'2.0',id:JSON.parse(options.body).id,result:'0x1'});
test('transient Ethereum 429 recovers once without bypassing response identity checks',async()=>{
 const old=fetch;let calls=0;
 global.fetch=async(_url,options)=>++calls===1?new Response(null,{status:429,headers:{'retry-after':'0'}}):good(options);
 try{assert.equal(await eth.rpc('eth_chainId',[],{timeoutMs:1000}),'0x1');assert.equal(calls,2)}finally{global.fetch=old}
});
test('Retry-After beyond the remaining deadline fails closed immediately',async()=>{
 const old=fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'60'}})};
 try{await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:500}),{httpStatus:429});assert.equal(calls,1)}finally{global.fetch=old}
});
test('malformed identity, invalid JSON and getter errors are not retried into apparent evidence',async()=>{
 const old=fetch;
 try{
  for(const payload of ['invalid JSON',{jsonrpc:'2.0',id:-1,result:'0x1'},{jsonrpc:'2.0',error:{code:-32000,message:'execution reverted'}}]){
   let calls=0;global.fetch=async(_url,options)=>{calls++;return typeof payload==='string'?new Response(payload):Response.json({...payload,id:payload.id??JSON.parse(options.body).id})};
   await assert.rejects(eth.rpc('eth_call',[{to:'0x'+'1'.repeat(40),data:'0x1234'},'0x123'],{timeoutMs:1000}));assert.equal(calls,1);
  }
 }finally{global.fetch=old}
});
test('an unavailable Ethereum provider is attempted at most twice per read',async()=>{
 const old=fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:503})};
 try{await assert.rejects(eth.rpc('eth_chainId',[],{timeoutMs:1000}),{httpStatus:503});assert.equal(calls,2)}finally{global.fetch=old}
});
