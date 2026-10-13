'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const getters=require('../search/server/lib/admin-getters');
const {mechanicsCard}=require('../search/server/lib/report');
const TOKEN='0x'+'a'.repeat(40),ADMIN='0x'+'b'.repeat(40),IMPL='0x'+'c'.repeat(40);
const word=a=>'0x'+'0'.repeat(24)+a.slice(2);
function rpcFactory({admin=ADMIN,implementation=IMPL,code='0x60806040',throwOn=null}={}){
 const calls=[];
 const rpc=async(method,params)=>{
  calls.push([method,params]);
  if(throwOn===method)throw Error('unavailable');
  if(method==='eth_call'){
   assert.equal(params[0].to,TOKEN);assert.equal(params[1],'0x123');
   if(params[0].data===getters.GETTERS.admin)return admin?word(admin):'0x'+'0'.repeat(64);
   if(params[0].data===getters.GETTERS.implementation)return implementation?word(implementation):'0x'+'0'.repeat(64);
  }
  if(method==='eth_getCode'){
   assert.equal(params[0],IMPL);assert.equal(params[1],'0x123');
   return code;
  }
  throw Error('Unexpected RPC method '+method);
 };
 return {rpc,calls};
}
const found=(value,network='ethereum',chainId=1)=>({value,dataState:'DATA_FOUND',status:'GETTER_REPORTED',
 network,chainId,source:'RPC',evidence:[{method:'tested getter'}]});
test('getter addresses must be canonical 32-byte ABI words with no zero address',()=>{
 assert.equal(getters.addressWord(word(ADMIN)),ADMIN);
 assert.equal(getters.addressWord('0x'+'0'.repeat(64)),null);
 assert.equal(getters.addressWord('0x'+'f'.repeat(64)),null);
 assert.equal(getters.addressWord('0x1234'),null);
});
test('Ethereum gives chain-checked, pinned source evidence for both optional getters',async()=>{
 const mock=rpcFactory();
 const o=await getters.inspect({network:'ethereum',address:TOKEN,block:'0x123',rpc:mock.rpc});
 assert.equal(o.ownerAdmin.dataState,'DATA_FOUND');
 assert.equal(o.contractArchitecture.dataState,'DATA_FOUND');
 assert.equal(o.ownerAdmin.chainId,1);
 assert.equal(o.contractArchitecture.network,'ethereum');
 assert.equal(o.contractArchitecture.evidence[0].method,'implementation() + eth_getCode');
 assert.match(o.contractArchitecture.evidence[0].scope,/authority remain unverified/);
 assert.equal(mock.calls.length,3);
});
test('Robinhood chain ID stays 4663 and getters cannot claim unrelated Ethereum data',async()=>{
 const mock=rpcFactory();
 const o=await getters.inspect({network:'robinhood',address:TOKEN,block:'0x123',rpc:mock.rpc});
 assert.equal(o.ownerAdmin.chainId,4663);
 assert.equal(o.ownerAdmin.network,'robinhood');
 assert.equal(o.contractArchitecture.chainId,4663);
 assert.deepEqual(await getters.inspect({network:'robinhood',address:TOKEN,block:'0x123',rpc:mock.rpc,
  needAdmin:false,needImplementation:false}),{});
});
test('zero or malformed getters and absent contract bytecode never create a verified architecture',async()=>{
 const absent=rpcFactory({admin:null,implementation:IMPL,code:'0x'});
 const o=await getters.inspect({network:'ethereum',address:TOKEN,block:'0x123',rpc:absent.rpc});
 assert.equal(o.ownerAdmin,undefined);
 assert.equal(o.contractArchitecture,undefined);
 const broken=rpcFactory({throwOn:'eth_call'});
 assert.deepEqual(await getters.inspect({network:'ethereum',address:TOKEN,block:'0x123',rpc:broken.rpc}),{});
});
test('Ethereum mechanics preserve preferred owner/EIP-1967 evidence over fallback',()=>{
 const directOwner=found(ADMIN),directProxy=found(IMPL);
 const direct={fields:{owner:directOwner,proxyImplementation:directProxy}};
 const fallback={ownerAdmin:found('admin() getter: '+ADMIN),contractArchitecture:found('implementation() getter: '+IMPL)};
 const withDirect=mechanicsCard(direct,{},fallback);
 assert.match(withDirect.fields.ownerAdmin.value,/owner\(\) getter/);
 assert.match(withDirect.fields.contractArchitecture.value,/EIP-1967 implementation/);
 const without=mechanicsCard({fields:{}},{},fallback);
 assert.equal(without.fields.ownerAdmin.value,fallback.ownerAdmin.value);
 assert.equal(without.fields.contractArchitecture.value,fallback.contractArchitecture.value);
 assert.equal(without.fields.tradingTaxes.dataState,'NOT_VERIFIED');
 assert.equal(without.fields.mintCapability.dataState,'NOT_VERIFIED');
});
test('reject unknown network, bad contract and unpinned block before an RPC call',async()=>{
 let count=0;const rpc=async()=>{count++};
 for(const x of [
  {network:'arc',address:TOKEN,block:'0x123'},
  {network:'ethereum',address:'USDC',block:'0x123'},
  {network:'ethereum',address:TOKEN,block:'latest'}
 ])await assert.rejects(()=>getters.inspect({...x,rpc}),/Invalid pinned/);
 assert.equal(count,0);
});
