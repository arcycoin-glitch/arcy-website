'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {audit}=require('../scripts/audit-evidence-lineage.cjs');
const fx=require('./fixtures/fdv-live-shapes-20261031.json');
const {classify}=require('../search/server/lib/evidence-class');
const field={...fx.arcoon.field,...classify(fx.arcoon.field,{card:'activity'})};
const report=f=>({cards:{activity:{fields:{valuation:f}}}});
const fake=handler=>async url=>{
 const p=new URL(url).searchParams,result=handler(p);
 return result instanceof Response?result:Response.json(result);
};
test('live gate needs successful populated reports and actually exercised derived FDV',async()=>{
 const run=handler=>audit({max:3,fetchImpl:fake(handler),log:()=>{}});
 const pass=await run(p=>p.get('action')==='radar'?{tokens:[]}:report(field));
 assert.equal(pass.ok,true);assert.equal(pass.derivedFdvFields,3);
 for(const answer of [{},report({...field,kind:'MARKET_CAP',status:'SOURCE_REPORTED'}),Response.json({error:'unavailable'},{status:503})]){
  const r=await run(p=>p.get('action')==='radar'?{tokens:[]}:answer);
  assert.equal(r.ok,false,'empty, unexercised or HTTP-failed reports cannot pass');
 }
 const missingRadar=await run(p=>p.get('action')==='radar'?{}:report(field));
 assert.equal(missingRadar.ok,false);assert.equal(missingRadar.radarErrors,3);
});
test('live gate rejects both fresh and stale false on-chain claims',async()=>{
 for(const f of [
  {...fx.arcoon.field,evidenceClass:'ON_CHAIN_VERIFIED'},
  {...field,evidenceClass:'STALE',provenance:{...field.provenance,underlyingClass:'ON_CHAIN_VERIFIED'}}
 ]){
  const r=await audit({max:3,log:()=>{},fetchImpl:fake(p=>p.get('action')==='radar'?{tokens:[]}:report(f))});
  assert.equal(r.ok,false);assert.equal(r.falselyOnChainVerified,3);
 }
});
