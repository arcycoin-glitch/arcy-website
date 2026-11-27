'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {explain}=require('../search/server/lib/mechanics-gaps');
const original={value:null,dataState:'NOT_VERIFIED',status:'NOT_VERIFIED',reasonCode:'MINT_CAPABILITY_NOT_VERIFIED',reason:'Unverified',evidence:[]};
const detail=reason=>({sourceVerification:{matched:false,provider:'Sourcify',assurance:null,implementationExecutionResolved:true},failures:[{reason}]});
test('source schema failure is not falsely called a deployed bytecode mismatch',()=>{
 const f=explain('mintCapability',original,detail('SOURCE_SCHEMA_INVALID'));
 assert.equal(f.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED','keep stable API reason code');
 assert.equal(f.reason,'Published source record format is invalid or unsupported.');
 assert.match(f.explanation,/failed schema validation/);
 assert.match(f.explanation,/does not establish a mismatch/);
 assert.equal(f.dataState,'NOT_VERIFIED');
 assert.equal(f.verificationGap.sourceProvider,'Sourcify');
 assert.deepEqual(f.evidence,[]);
});
test('real source bytecode mismatch has a distinct, accurately scoped reason',()=>{
 const f=explain('tradingTaxes',original,detail('SOURCE_BYTECODE_MISMATCH'));
 assert.equal(f.reason,'Published source bytecode differs from deployed code.');
 assert.match(f.explanation,/does not match the pinned on-chain runtime/);
 assert.equal(f.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED');
});
test('chain/address mismatch does not get misreported as a bytecode mismatch',()=>{
 const f=explain('ownerAdmin',original,detail('SOURCE_IDENTITY_MISMATCH'));
 assert.equal(f.reason,'Published source contract identity does not match.');
 assert.match(f.explanation,/chain\/address identity validation/);
 assert.equal(f.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED');
});
test('unreviewed exact-source profile is still not verified; success data is never overridden',()=>{
 const d={sourceVerification:{matched:true,provider:'Sourcify'},failures:[]};
 const f=explain('tradingTaxes',original,d);
 assert.equal(f.reasonCode,'MECHANICS_EXECUTION_PATH_UNREVIEWED');
 assert.equal(f.dataState,'NOT_VERIFIED');
 const good={value:'Transfer 0%',status:'VERIFIED_SOURCE',dataState:'DATA_FOUND'};
 assert.equal(explain('tradingTaxes',good,d),good);
});

// #337: TENDIES 4663:0x45242320… Sourcify 200 / runtimeMatch match / language Yul (CI probe-mechanics-sources-337).
test('Yul verified source keeps the stable reason code but says precisely why; never a promotion',()=>{
 const f=explain('tradingTaxes',original,detail('UNSUPPORTED_SOURCE_LANGUAGE_YUL'));
 assert.equal(f.reasonCode,'MECHANICS_SOURCE_IDENTITY_UNVERIFIED');assert.equal(f.dataState,'NOT_VERIFIED');assert.equal(f.value,null);
 assert.equal(f.reason,'Verified source is hand-written Yul; its execution paths are not reviewed.');
 assert.match(f.explanation,/exact runtime bytecode match/);assert.equal(f.verificationGap.sourceCause,'UNSUPPORTED_SOURCE_LANGUAGE_YUL');
});
test('matchedYul: only an identity- and runtime-matched Yul record is named; validateSource is unchanged',()=>{
 const {matchedYul}=require('../search/server/lib/mechanics-yul'),{validateSource}=require('../search/server/lib/mechanics-deep');
 const A='0x45242320dbb855eea8fd36804c6487e10e97fcf9',code='0x6001600055',o={chainId:4663,address:A,code};
 const base={chainId:4663,address:A,runtimeMatch:'match',runtimeBytecode:{onchainBytecode:code},sources:{'a.yul':{content:'x'}},compilation:{language:'Yul'},abi:null};
 assert.equal(matchedYul(base,o),true);
 for(const bad of [{runtimeMatch:null},{address:'0x'+'1'.repeat(40)},{chainId:1},{compilation:{language:'Solidity'}},{abi:[]},{runtimeBytecode:{onchainBytecode:'0x60'}}])
  assert.equal(matchedYul({...base,...bad},o),false,JSON.stringify(bad));
 assert.throws(()=>validateSource(base,o),/SOURCE_SCHEMA_INVALID/,'frozen validator behaviour unchanged');
});
