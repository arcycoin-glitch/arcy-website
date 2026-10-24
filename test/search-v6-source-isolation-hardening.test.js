'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../search/server/lib/data-engine');
const {createReader}=require('../search/server/lib/source-request');
const ADDRESS='0x'+'a'.repeat(40),BLOCK='0x100';
const supply={value:100,dataState:'DATA_FOUND',status:'ON_CHAIN',source:'Arc RPC',network:'arc',chainId:5042,evidence:[{address:ADDRESS,block:BLOCK,chainId:5042,network:'arc'}]};
function adapter(){
 return {
  async inspectToken(){return {address:ADDRESS,block:BLOCK,chainId:5042,network:'arc',token:{symbol:'T',name:'Token',decimals:18}}},
  inspectStock(){throw Error('registry internal key must stay private')},
  inspectCard({cardId}){
   if(cardId==='holders')throw Error('synchronous private error');
   if(cardId==='mechanics')return Promise.reject(Error('asynchronous private error'));
   if(cardId==='supply')return {fields:{totalSupply:supply}};
   return {fields:{}};
  }
 };
}
test('Search isolates sync and async card failures; healthy cards survive and causes are private',async()=>{
 const report=await createEngine({arc:adapter()}).report({network:'arc',address:ADDRESS});
 assert.equal(report.ok,true);
 assert.deepEqual(Object.keys(report.cards),['supply','holders','liquidity','activity','mechanics']);
 assert.equal(report.cards.supply.context.totalSupply.value,100,'legacy total supply remains available as a separate verified headline fact');
 for(const name of ['holders','mechanics']){
  assert.equal(report.cards[name].status,'SOURCE_API_FAILED');
  for(const field of Object.values(report.cards[name].fields)){
   assert.equal(field.dataState,'SOURCE_API_FAILED');
   assert.equal(field.value,null);
   assert.equal(field.reasonCode,'CARD_SOURCE_FAILED');
   assert.doesNotMatch(JSON.stringify(field),/private error|internal key/);
  }
 }
 assert.equal(report.tokenIdentity.status,'NOT_VERIFIED');
});
test('uncooperative Search fetcher cannot hang beyond its wall-clock deadline',async()=>{
 const reader=createReader();
 await assert.rejects(reader.json('https://proof.example/stalled',
  {fetcher:()=>new Promise(()=>{}),timeoutMs:25}),{code:'SOURCE_TIMEOUT'});
 const result=await reader.json('https://proof.example/stalled',
  {fetcher:async()=>Response.json({proof:true}),timeoutMs:100});
 assert.deepEqual(result,{proof:true});
});
test('a body that never closes is bounded, and its response is not cached',async()=>{
 const reader=createReader(),url='https://proof.example/body';
 const unending=()=>Promise.resolve(new Response(new ReadableStream({start(){}}),{status:200}));
 await assert.rejects(reader.json(url,{fetcher:unending,timeoutMs:30}),{code:'SOURCE_TIMEOUT'});
 const fresh=await reader.json(url,{fetcher:async()=>Response.json({state:'fresh'}),timeoutMs:100});
 assert.equal(fresh.state,'fresh');
});

test('stuck cancellation on error responses never blocks provider failure reporting',async()=>{
 const reader=createReader();
 const fake={ok:false,status:503,headers:{get:()=>null},body:{cancel:()=>new Promise(()=>{})}};
 await assert.rejects(reader.json('https://proof.example/503',{fetcher:async()=>fake,timeoutMs:60}),{httpStatus:503});
});
