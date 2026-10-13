'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const health=require('../search/server/api/health');
function response(){
 return {code:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;return this},
  status(n){this.code=n;return this},
  json(value){this.body=value;return this}};
}
async function withEnvironment(environment,fn){
 const keys=['VERCEL','VERCEL_ENV','DEXSCREENER_PUBLIC_DISPLAY_APPROVED','GOPLUS_PUBLIC_DISPLAY_APPROVED'];
 const prior=new Map(keys.map(x=>[x,process.env[x]]));
 try{
  for(const k of keys)delete process.env[k];
  for(const [key,val] of Object.entries(environment))process.env[key]=val;
  return await fn();
 }finally{
  for(const [key,val] of prior){if(val===undefined)delete process.env[key];else process.env[key]=val}
 }
}
test('production health explicitly reports disabled market and security providers',async()=>{
 await withEnvironment({VERCEL:'1',VERCEL_ENV:'production'},()=>{
  const res=response();health({method:'GET'},res);
  assert.equal(res.code,200);
  const v=res.body;
  assert.equal(v.ok,true);
  assert.equal(v.environment,'production');
  assert.equal(v.expectedCards,5);assert.equal(v.expectedMetrics,20);
  assert.equal(v.providerAccess.dexScreener.enabled,false);
  assert.equal(v.providerAccess.goPlus.enabled,false);
  assert.equal(v.productionReleaseGate.mode,'RESTRICTED_ONCHAIN_ONLY');
  assert.equal(v.productionReleaseGate.fullDataEnabledInCurrentRuntime,false);
  assert.equal(v.productionReleaseGate.sourcePermissionVerifiedByThisEndpoint,false);
  assert.ok(v.disabledProviders.some(p=>p.startsWith('DEX Screener')));
  assert.ok(v.disabledProviders.some(p=>p.startsWith('GoPlus')));
  assert.ok(v.marketSources.every(p=>!p.includes('GoPlus')&&!p.includes('DEX Screener')));
 });
});
test('partial production approval exposes only independently approved provider',async()=>{
 await withEnvironment({VERCEL:'1',VERCEL_ENV:'production',DEXSCREENER_PUBLIC_DISPLAY_APPROVED:'true'},()=>{
  const res=response();health({method:'GET'},res);const v=res.body;
  assert.equal(v.productionReleaseGate.mode,'PARTIAL_PROVIDER_ACCESS');
  assert.equal(v.providerAccess.dexScreener.enabled,true);
  assert.equal(v.providerAccess.goPlus.enabled,false);
  assert.ok(v.marketSources.some(p=>p.includes('DEX Screener')));
  assert.ok(v.disabledProviders.some(p=>p.includes('GoPlus')));
 });
});
test('preview health is never represented as production licensing approval',async()=>{
 await withEnvironment({VERCEL:'1',VERCEL_ENV:'preview'},()=>{
  const res=response();health({method:'GET'},res);const v=res.body;
  assert.equal(v.environment,'preview-or-build');
  assert.equal(v.productionReleaseGate.mode,'NOT_A_PRODUCTION_DEPLOYMENT');
  assert.equal(v.providerAccess.dexScreener.enabled,true);
  assert.equal(v.providerAccess.goPlus.enabled,true);
  assert.equal(v.productionReleaseGate.sourcePermissionVerifiedByThisEndpoint,false);
  assert.match(v.productionReleaseGate.note,/Boolean flags alone are not proof/);
 });
});
test('invalid health method fails closed',()=>{
 const res=response();health({method:'POST'},res);
 assert.equal(res.code,405);assert.equal(res.body.error,'GET_REQUIRED');
});
