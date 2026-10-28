'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const explorer=require('../search/server/lib/mechanics-explorer-source');
const mechanics=require('../search/server/lib/mechanics-deep');
const {chain}=require('../search/server/lib/chains');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),C='0x'+'3'.repeat(40);
const CODE='0x600160005500',DELEGATE='0x60006000f400',BLOCK='0x1234';
const word=a=>'0x'+a.slice(2).padStart(64,'0'),ZERO='0x'+'0'.repeat(64);
const owner={type:'function',name:'owner',stateMutability:'view',inputs:[],outputs:[{type:'address'}]};
const mint={type:'function',name:'mint',stateMutability:'nonpayable',inputs:[],outputs:[]};
function body(extra={}){return {is_verified:true,is_changed_bytecode:false,deployed_bytecode:CODE,abi:[owner,mint],source_code:'contract Token {}',file_path:'Token.sol',additional_sources:[],...extra};}
function reader(blockscout){return {observedAt:()=>0,json:async(url,options)=>{
 if(url.startsWith('https://sourcify.dev/'))throw Object.assign(Error('not found'),{httpStatus:404});
 if(blockscout instanceof Error)throw blockscout;
 options.validate(blockscout);return blockscout;
}};}
function rpcFor({outer=CODE,targets={},slot=ZERO}={}){
 return async(method,params)=>{
  assert.equal(params.at(-1),BLOCK);
  if(method==='eth_getCode')return params[0]===A?outer:targets[params[0]]||'0x';
  if(method==='eth_getStorageAt')return params[1]===mechanics.SLOTS.implementation?slot:ZERO;
  if(method==='eth_call')return params[0].data===mechanics.selector('owner()')?word(C):ZERO;
  throw Error('Unexpected RPC method');
 };
}
test('explorer source is chain-scoped, verified and bound to pinned runtime',()=>{
 for(const network of ['ethereum','robinhood']){
  const cfg=chain(network),result=explorer.validate(body({address_hash:A,chain_id:cfg.chainId}),{cfg,address:A,code:CODE});
  assert.equal(result.attestationOnly,true);assert.equal(result.address,A);assert.equal(result.chainId,cfg.chainId);
  assert.equal(result.runtimeMatch,'EXPLORER_ATTESTED_PINNED_BYTECODE');assert.match(result.scope,/No local recompilation/);
 }
 assert.equal(explorer.config(chain('arc')),null);
 const more=body({abi:JSON.stringify([owner]),additional_sources:[{file_path:'lib.sol',source_code:'library L {}'}]});
 assert.equal(explorer.validate(more,{cfg:chain('ethereum'),address:A,code:CODE}).abi[0].name,'owner');
});
test('unverified, conflicting identity, bytecode and malformed source fail closed',()=>{
 const args={cfg:chain('ethereum'),address:A,code:CODE};
 for(const changed of [
  {is_verified:false},{is_changed_bytecode:true},{address_hash:B},{chain_id:4663},
  {deployed_bytecode:DELEGATE},{abi:'not json'},{abi:[{type:'function',name:'owner',inputs:{},outputs:[]}]},
  {source_code:''},{additional_sources:[{file_path:'Token.sol',source_code:'other'}]}
 ])assert.throws(()=>explorer.validate(body(changed),args));
 assert.throws(()=>explorer.validate(body(),{...args,cfg:{id:'ethereum',chainId:4663}}));
});
test('Sourcify unavailability falls back to the correct Blockscout endpoint',async()=>{
 for(const network of ['ethereum','robinhood']){
  const diagnostics=[],cfg=chain(network),result=await mechanics.sourceFor(cfg,A,CODE,diagnostics,{sourceReader:reader(body())});
  assert.equal(result.source,'Blockscout');assert.equal(result.attestationOnly,true);
  assert.equal(result.url,explorer.EXPLORERS[network].origin+'/api/v2/smart-contracts/'+A);
  assert.equal(diagnostics[0].reason,'SOURCE_CODE_UNAVAILABLE');
 }
});
test('failed or unverified explorer result remains unavailable with safe diagnostics',async()=>{
 for(const input of [body({is_verified:false}),body({deployed_bytecode:DELEGATE}),Object.assign(Error('private endpoint token'),{httpStatus:503})]){
  const diagnostics=[],result=await mechanics.sourceFor(chain('ethereum'),A,CODE,diagnostics,{sourceReader:reader(input)});
  assert.equal(result,null);assert.equal(diagnostics.length,2);assert(!JSON.stringify(diagnostics).includes('private endpoint token'));
  if(!(input instanceof Error))assert.match(diagnostics[1].reason,/^EXPLORER_/);
 }
});
test('unsupported explorer fallback is distinguished from a source failure',async()=>{
 const diagnostics=[],result=await mechanics.sourceFor(chain('arc'),A,CODE,diagnostics,{sourceReader:reader(body())});
 assert.equal(result,null);assert.equal(diagnostics[0].reason,'SOURCE_CODE_UNAVAILABLE');
 assert.equal(diagnostics[1].reason,'EXPLORER_UNSUPPORTED_NETWORK');
});
test('exact clone may use pinned implementation ABI getter; explorer assertion cannot imply mint or tax',async()=>{
 const clone='0x363d3d373d3d3d363d73'+B.slice(2)+'5af43d82803e903d91602b57fd5bf3';
 const source=explorer.validate(body(),{cfg:chain('robinhood'),address:B,code:CODE});
 // Even if a source digest collides with a reviewed profile, an explorer-only
 // assertion cannot activate curated execution or permission semantics.
 source.digest=Object.keys(mechanics.PROFILES).find(x=>mechanics.PROFILES[x]==='WARD_AUTH_TOKEN');
 const result=await mechanics.inspect({network:'robinhood',address:A,block:BLOCK,
  rpc:rpcFor({outer:clone,targets:{[B]:CODE}}),sourceLoader:async(_,a)=>a===B?source:null});
 assert.match(result.fields.contractArchitecture.value,/EIP-1167/);
 assert.equal(result.fields.ownerAdmin.value,'owner(): '+C);
 assert.equal(result.fields.ownerAdmin.evidence[0].runtimeMatch,'EXPLORER_ATTESTED_PINNED_BYTECODE');
 assert.equal(result.fields.mintCapability,undefined);assert.equal(result.fields.tradingTaxes,undefined);
 assert.equal(result.details.reviewedProfile,null);
});
test('an unbound slot and explorer-attested source do not prove proxy routing',async()=>{
 const source={...explorer.validate(body(),{cfg:chain('ethereum'),address:B,code:CODE}),digest:'unreviewed'};
 const result=await mechanics.inspect({network:'ethereum',address:A,block:BLOCK,
  rpc:rpcFor({outer:DELEGATE,targets:{[B]:CODE},slot:word(B)}),sourceLoader:async(_,a)=>a===B?source:null});
 assert.equal(result.fields.contractArchitecture,undefined);assert.equal(result.fields.ownerAdmin,undefined);
 assert(result.details.failures.some(x=>x.reason==='IMPLEMENTATION_EXECUTION_UNRESOLVED'));
});
