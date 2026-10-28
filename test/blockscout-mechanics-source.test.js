'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const source=require('../search/server/lib/blockscout-mechanics-source');
const mechanics=require('../search/server/lib/mechanics-deep');
const ADDRESS='0x'+'1'.repeat(40),OTHER='0x'+'2'.repeat(40);
const CODE='0x600160005500',BLOCK='0x1234';
const fn=(name,output='address')=>({type:'function',name,stateMutability:'view',inputs:[],outputs:[{type:output}]});
const body=()=>({
 is_verified:true,is_fully_verified:true,is_partially_verified:false,
 is_changed_bytecode:false,address_hash:ADDRESS,chain_id:5042,
 deployed_bytecode:CODE,abi:[fn('owner')],
 file_path:'src/Token.sol',source_code:'contract Token { address public owner; }',
 additional_sources:[{file_path:'src/Common.sol',source_code:'library Common {}'}]
});
const parse=(b,opts={})=>source.parseVerified({
 network:'arc',address:ADDRESS,code:CODE,sourceUrl:source.safeSourceUrl('arc',ADDRESS),
 observedAt:'2026-10-28T17:00:00Z',body:b,...opts
});
test('Blockscout source accepts only complete verified source with EXACT pinned deployed bytecode',()=>{
 const p=parse(body());assert.ok(p);
 assert.equal(p.runtimeMatch,'exact_match');
 assert.equal(p.abi[0].name,'owner');
 assert.equal(p.verificationProvider,'Blockscout PRO');
 assert.match(p.digest,/^[0-9a-f]{64}$/);
 assert.equal(p.sourceVerification,'COMPLETE_SOURCE_AND_EXACT_PINNED_DEPLOYED_BYTECODE');
 assert.ok(!p.url.includes('apikey'));
});
test('A verified explorer label alone NEVER certifies partial, changed, mismatched or twin code',()=>{
 for(const patch of [
  {is_verified:false},{is_fully_verified:false},{is_partially_verified:true},
  {is_changed_bytecode:true},{deployed_bytecode:'0x6000'},
  {deployed_bytecode:'0x600160005501'},
  {verified_twin_address_hash:OTHER},{address_hash:OTHER},{chain_id:1},
  {abi:null},{abi:'not json'},{source_code:''},
  {additional_sources:[{file_path:'src/Token.sol',source_code:'duplicate'}]},
  {additional_sources:[{file_path:'src/Other.sol',source_code:123}]}
 ]){
  assert.equal(parse({...body(),...patch}),null,'rejected '+Object.keys(patch).join(','));
 }
 assert.equal(parse(body(),{code:'0x6000'}),null);
 assert.equal(parse(body(),{network:'robinhood'}),null);
});
test('Blockscout source requires exact valid network, address and fully verified data',()=>{
 assert.equal(source.safeSourceUrl('arc',ADDRESS),'https://api.blockscout.com/5042/api/v2/smart-contracts/'+ADDRESS);
 assert.equal(source.safeSourceUrl('ethereum',ADDRESS),'https://api.blockscout.com/1/api/v2/smart-contracts/'+ADDRESS);
 assert.equal(source.safeSourceUrl('robinhood',ADDRESS),'https://api.blockscout.com/4663/api/v2/smart-contracts/'+ADDRESS);
 assert.equal(source.safeSourceUrl('base',ADDRESS),null);
 assert.equal(source.safeSourceUrl('arc','bad'),null);
 assert.equal(parse({...body(),is_fully_verified:undefined}),null);
});
test('No credential means no Blockscout network request, not a false zero or negative capability',async()=>{
 let requested=0;
 const reader={json:async()=>{requested++;return body()}};
 assert.equal(await source.load({network:'arc',address:ADDRESS,code:CODE,key:'',reader}),null);
 assert.equal(await source.load({network:'arc',address:ADDRESS,code:CODE,key:'wrong',reader}),null);
 assert.equal(requested,0);
});
test('Authenticated Blockscout source never exposes the API key in source URL or result',async()=>{
 const old=global.fetch,key='proapi_EXAMPLE_SAFE_SECRET_KEY_123',seen=[];
 try{
  global.fetch=async(url,opts)=>{
   seen.push({url,accept:opts?.headers?.accept});
   return new Response(JSON.stringify(body()),{status:200,headers:{'content-type':'application/json'}});
  };
  const reader={json:async(url,opts)=>{
   assert.equal(url,source.safeSourceUrl('arc',ADDRESS));
   assert.equal(opts.timeoutMs,4200);
   const r=await opts.fetcher(url,{headers:{accept:'application/json'}});
   return r.json();
  }};
  const p=await source.load({network:'arc',address:ADDRESS,code:CODE,key,reader});
  assert.ok(p);
  assert.equal(seen.length,1);
  assert.equal(new URL(seen[0].url).searchParams.get('apikey'),key);
  assert.equal(JSON.stringify(p).includes(key),false);
  assert.ok(!p.url.includes('?'));
 }finally{global.fetch=old}
});
test('Matching source ABI may support pinned owner getter ONLY; mint and tax permissions stay unproven',async()=>{
 const parsed=parse(body());
 const data='0x'+OTHER.slice(2).padStart(64,'0');
 const rpc=async(method,params)=>{
  assert.equal(params.at(-1),BLOCK);
  if(method==='eth_getCode')return CODE;
  if(method==='eth_call')return params[0].data===mechanics.selector('owner()')?data:'0x'+'0'.repeat(64);
  if(method==='eth_getStorageAt')return '0x'+'0'.repeat(64);
  throw Error('Invalid method '+method);
 };
 const report=await mechanics.inspect({network:'arc',address:ADDRESS,block:BLOCK,rpc,sourceLoader:async()=>parsed});
 assert.equal(report.fields.ownerAdmin.status,'GETTER_REPORTED');
 assert.equal(report.fields.ownerAdmin.value,'owner(): '+OTHER);
 assert.equal(report.fields.mintCapability,undefined);
 assert.equal(report.fields.tradingTaxes,undefined);
 assert.equal(report.fields.contractArchitecture.value,'NON-PROXY · runtime verified');
});
