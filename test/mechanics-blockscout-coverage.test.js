'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,retrieve,HOSTS}=require('../search/server/lib/mechanics-blockscout');
const {explain}=require('../search/server/lib/mechanics-gaps');
const CODE='0x60016000526001601ff3',A='0x'+'ab'.repeat(20);
const abi=[{type:'function',name:'owner',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}];
const fixture=(over={})=>({is_verified:true,is_fully_verified:true,is_partially_verified:false,
 deployed_bytecode:CODE,language:'solidity',source_code:'pragma solidity ^0.8.20; contract V { address public owner; }',
 file_path:'contracts/V.sol',compiler_version:'v0.8.20',name:'V',abi,...over});
const opts={network:'ethereum',address:A,code:CODE};
test('Blockscout fully verified exact bytecode provides a source/ABI profile without claiming independent compilation',()=>{
 const f=parse(fixture(),opts);
 assert.ok(f&&f.digest.length===64);
 assert.equal(f.sourceProvider,'Blockscout');
 assert.equal(f.sourceAssurance,'EXPLORER_FULL_VERIFICATION_PLUS_EXACT_ONCHAIN_BYTECODE');
 assert.equal(f.runtimeMatch,'match');
 assert.deepEqual(f.abi,abi);
 assert.ok(f.sources['contracts/V.sol'].content.includes('pragma solidity'));
});
test('verified source is available to the same strict parser on all three EVM networks',()=>{
 assert.ok(parse(fixture(),{...opts,network:'ethereum'}));
 assert.ok(parse(fixture(),{...opts,network:'arc'}));
 assert.ok(parse(fixture(),{...opts,network:'robinhood'}));
 assert.equal(HOSTS.arc,'https://explorer.arc.io');
 assert.equal(HOSTS.onsource,undefined);
});
test('partial, unverified, changed or bytecode-mismatched contracts NEVER pass',()=>{
 for(const mod of [
  {is_verified:false},{is_fully_verified:false},{is_partially_verified:true},
  {is_changed_bytecode:true},{deployed_bytecode:'0x60016000526001601ff4'},
  {deployed_bytecode:null},{address_hash:'0x'+'cd'.repeat(20)}
 ])assert.equal(parse(fixture(mod),opts),null,JSON.stringify(mod));
});
test('malformed ABI, unsupported source language and invalid files fail closed',()=>{
 for(const mod of [
  {abi:[{type:'function',name:'mint',inputs:'bad',outputs:[]}]},
  {abi:[{type:'function',name:'mint',inputs:[],outputs:[{type:42}]}]},
  {abi:'not-json'},{source_code:''},{file_path:'../../etc/secret.sol'},
  {additional_sources:[{file_path:'../../evil.sol',source_code:'contract Evil{}'}]},
  {additional_sources:[{file_path:'contracts/V.sol',source_code:'duplicate'}]},
  {language:'vyper'}
 ])assert.equal(parse(fixture(mod),opts),null,JSON.stringify(mod).slice(0,200));
});
test('additional verified files are retained only within bounds, and flattened source remains a source observation',()=>{
 const f=parse(fixture({additional_sources:[{file_path:'contracts/Sub.sol',source_code:'contract Sub{}'}]}),opts);
 assert.equal(Object.keys(f.sources).length,2);
 assert.equal(f.sources['contracts/Sub.sol'].content,'contract Sub{}');
});
test('bounded retrieval handles success and does not request any extra RPC calls',async()=>{
 const calls=[],diagnostics=[];
 const reader={json:async(url,config)=>{calls.push({url,config});return fixture()},
  observedAt:()=>Date.UTC(2026,10,5)};
 const cfg={id:'ethereum',chainId:1};
 const out=await retrieve({cfg,address:A,code:CODE,reader,diagnostics});
 assert.ok(out);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://eth.blockscout.com/api/v2/smart-contracts/'+A);
 assert.equal(calls[0].config.timeoutMs,3500);
 assert.equal(diagnostics.length,0);
 assert.equal(out.retrievedAt,'2026-11-05T00:00:00.000Z');
});
test('unverified response never becomes a verified fact and carries specific diagnostics',async()=>{
 const diagnostics=[];
 const out=await retrieve({cfg:{id:'robinhood',chainId:4663},address:A,code:CODE,
  reader:{json:async()=>fixture({is_fully_verified:false})},diagnostics});
 assert.equal(out,null);
 assert.equal(diagnostics[0].reason,'SOURCE_VERIFICATION_INSUFFICIENT');
 assert.ok(diagnostics[0].sourceUrl.startsWith('https://robinhoodchain.blockscout.com/'));
});
test('Arc uses its official Blockscout URL, never guesses a source; HTTP failures stay not verified',async()=>{
 let count=0,actual=null;
 const arc=await retrieve({cfg:{id:'arc',chainId:5042},address:A,code:CODE,
  reader:{json:async(url)=>{count++;actual=url;return fixture({is_fully_verified:false});}}});
 assert.equal(arc,null);assert.equal(count,1);
 assert.equal(actual,'https://explorer.arc.io/api/v2/smart-contracts/'+A);
 const diagnostics=[];
 await retrieve({cfg:{id:'ethereum',chainId:1},address:A,code:CODE,
  reader:{json:async()=>{throw Object.assign(Error('down'),{httpStatus:503})}},diagnostics});
 assert.equal(diagnostics[0].reason,'SOURCE_API_FAILED');
});
const unknown=()=>({value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',
 reasonCode:'MINT_CAPABILITY_NOT_VERIFIED',reason:'Generic unavailable',evidence:[]});
test('verified but unreviewed source explains tax/mint/owner limitations, not a false 0% or no owner',()=>{
 const d={sourceVerification:{matched:true,provider:'Blockscout',assurance:'EXACT',
 templateRejection:'SHADOWS_LIBRARY_NAME',implementationExecutionResolved:true},failures:[]};
 for(const k of ['tradingTaxes','mintCapability','ownerAdmin']){
  const o=explain(k,unknown(),d);
  assert.equal(o.value,null);assert.equal(o.dataState,'NOT_VERIFIED');
  assert.equal(o.reasonCode,'MECHANICS_EXECUTION_PATH_UNREVIEWED');
  assert.equal(o.verificationGap.sourceProvider,'Blockscout');
  assert.equal(o.reasonDetail,'Generic unavailable');
 }
 assert.match(explain('mintCapability',unknown(),d).reason,/mint\(\)/);
});
test('verified ABI shows fee, role and mint interface candidates but does not assert capabilities',()=>{
 const d={sourceVerification:{matched:true,provider:'Sourcify',templateRejection:'OVERRIDES__transfer'},
  interfaceCandidates:[{name:'setBuyFee',stateMutability:'nonpayable'},
   {name:'mint',stateMutability:'nonpayable'},
   {name:'grantRole',stateMutability:'nonpayable'}],failures:[]};
 const tax=explain('tradingTaxes',unknown(),d),mint=explain('mintCapability',unknown(),d),owner=explain('ownerAdmin',unknown(),d);
 assert.match(tax.reason,/setBuyFee/);
 assert.match(mint.reason,/mint/);
 assert.match(owner.reason,/grantRole/);
 assert.equal(tax.dataState,'NOT_VERIFIED');
 assert.equal(mint.dataState,'NOT_VERIFIED');
 assert.equal(owner.dataState,'NOT_VERIFIED');
 assert.equal(mint.verificationGap.templateRejection,'OVERRIDES__transfer');
});
test('source mismatch, provider outage and unbound proxy have distinct failure reasons',()=>{
 const base={matched:false,provider:null,templateRejection:null};
 for(const [cause,expected] of [
  ['SOURCE_BYTECODE_MISMATCH','MECHANICS_SOURCE_IDENTITY_UNVERIFIED'],
  ['SOURCE_RATE_LIMIT','MECHANICS_SOURCE_READ_UNAVAILABLE'],
  ['SOURCE_VERIFICATION_INSUFFICIENT','MECHANICS_VERIFIED_SOURCE_UNAVAILABLE'],
  ['IMPLEMENTATION_EXECUTION_UNRESOLVED','MECHANICS_IMPLEMENTATION_UNRESOLVED']
 ]){
  const f=explain('tradingTaxes',unknown(),{sourceVerification:base,failures:[{reason:cause}]});
  assert.equal(f.reasonCode,expected,cause);
 }
});
test('already verified Mechanics facts and unrelated fields cannot be rewritten by gap explanations',()=>{
 const good={value:'Verified 0%',dataState:'DATA_FOUND',reasonCode:null};
 const d={sourceVerification:{matched:false},failures:[{reason:'SOURCE_CODE_UNAVAILABLE'}]};
 assert.equal(explain('tradingTaxes',good,d),good);
 assert.equal(explain('contractArchitecture',unknown(),d).reasonCode,'MINT_CAPABILITY_NOT_VERIFIED');
 assert.equal(explain('mintCapability',unknown(),{}).reasonCode,'MINT_CAPABILITY_NOT_VERIFIED');
});

test('contract mechanics annotation works across network reports without changing verified values',()=>{
 const coverage=require('../search/server/lib/mechanics-coverage');
 for(const network of ['ethereum','arc','robinhood']){
  const details={sourceVerification:{matched:true,provider:'Sourcify'},interfaceCandidates:[
   {name:'setFee',stateMutability:'nonpayable'},{name:'grantRole',stateMutability:'nonpayable'}],failures:[]};
  const verified={value:'NON-PROXY · runtime verified',dataState:'DATA_FOUND',evidence:[{}]};
  const unknownWithDetails={...unknown(),analysisDiagnostics:details};
  const card={description:network,fields:{contractArchitecture:verified,tradingTaxes:unknownWithDetails,mintCapability:unknownWithDetails,ownerAdmin:unknownWithDetails}};
  const out=coverage.annotateCard(card);
  assert.equal(card.fields.tradingTaxes.reason,'Generic unavailable','original not mutated');
  assert.equal(out.fields.contractArchitecture,verified,'proved existing value not copied/changed');
  assert.equal(out.fields.tradingTaxes.value,null);
  assert.match(out.fields.tradingTaxes.reason,/setFee/);
  assert.match(out.fields.ownerAdmin.reason,/grantRole/);
  assert.equal(out.fields.ownerAdmin.dataState,'NOT_VERIFIED');
 }
});
