'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Y=require('../search/server/lib/mechanics-yul');
const A='0x45242320dbb855eea8fd36804c6487e10e97fcf9',code='0x6001600055';
const base=(sources)=>({chainId:4663,address:A,runtimeMatch:'match',runtimeBytecode:{onchainBytecode:code},compilation:{language:'Yul'},abi:{},sources});
test('reviewed Yul: only an exact-runtime-matched record with the reviewed source digest is accepted',()=>{
 const o={chainId:4663,address:A,code};
 assert.equal(Y.reviewed(base({'x.yul':{content:'object "x" {}'}}),o),null,'unreviewed digest is never accepted');
 assert.equal(Y.reviewed({...base({'x.yul':{content:'x'}}),runtimeMatch:null},o),null);
 assert.equal(Y.REVIEWED.f2e77c7eb10de049e0e7d13c779c1240b4f9ac7e9fd78c85634a6cfe4e955525,'IMMUTABLE_LAUNCH_RESTRICTIONS');
 assert.equal(Y.digestOf({'b':{content:'2'},'a':{content:'1'}}),Y.digestOf({'a':{content:'1'},'b':{content:'2'}}),'digest is path-order independent');
 assert(Object.isFrozen(Y.REVIEWED));
});
test('profile is registered for fields and restrictions; frozen PR26/enrich fingerprints untouched',()=>{
 const v4=require('../search/server/lib/mechanics-reviewed-v4');
 assert.equal(v4.PROFILES.f2e77c7eb10de049e0e7d13c779c1240b4f9ac7e9fd78c85634a6cfe4e955525,'IMMUTABLE_LAUNCH_RESTRICTIONS');
 const b=require('../scripts/approved-baseline.cjs').compute(),a=require('./fixtures/approved-baseline.json');
 assert.equal(b.mechanics.validateSource,a.pr26.validateSourceSha256);assert.equal(b.mechanics.enrich,a.current.mechanics.enrich);
});
