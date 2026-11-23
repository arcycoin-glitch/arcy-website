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
