'use strict';
// Regression: /api/search action dispatcher must preserve the branch-safe Radar V3 source selector.
// Without this, the scheduled V4 builder consumes its OWN previous V4 response (circular input).
const test=require('node:test');
const assert=require('node:assert/strict');
const gateway=require('../api/search/index.js');
const radar=require('../lib/radar-v2');
const V4=require('../lib/radar-v2/v4-snapshot');

function response(){
 return {headers:{},code:null,body:null,setHeader(k,v){this.headers[k]=v;},
  status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
}
test('end-to-end router preserves source=legacy-v3 instead of circulating V4 snapshots',async()=>{
 const old={...process.env},load=radar.load,serve=V4.serve;
 Object.assign(process.env,{RADAR_V4_OPPORTUNITY_ENABLED:'true',
  MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true'});
 let legacyCalls=0,v4Calls=0;
 radar.load=async(network)=>{legacyCalls++;return {ok:true,network,chainId:1,freshness:'FRESH',
  asOf:'2026-11-18T16:00:00Z',tokens:[],nearMiss:[{address:'0x'+'7'.repeat(40),stage:'BELOW_FINALISTS'}]};};
 V4.serve=async()=>{v4Calls++;return {data:{ok:true,network:'ethereum',chainId:1,
  asOf:'2026-11-18T16:00:00Z',freshness:'FRESH',tokens:[],
  opportunity:{servedList:'V4_OPPORTUNITY'}},reason:null};};
 const call=async(url,query)=>{
  const res=response();
  await gateway({method:'GET',url,query,headers:{'sec-fetch-site':'same-origin'}},res);
  return res;
 };
 try{
  const legacy=await call('/api/search?action=radar&chain=ethereum&source=legacy-v3',
   {action:'radar',chain:'ethereum',source:'legacy-v3'});
  assert.equal(legacy.code,200);
  assert.equal(legacy.body.servedList,'LEGACY_V3_REQUESTED');
  assert.equal(legacy.body.nearMiss.length,1);
  assert.equal(legacyCalls,1);
  assert.equal(v4Calls,0,'legacy request must not serve old V4 snapshot');

  const served=await call('/api/search?action=radar&chain=ethereum',{action:'radar',chain:'ethereum'});
  assert.equal(served.code,200);
  assert.equal(served.body.opportunity.servedList,'V4_OPPORTUNITY');
  assert.equal(v4Calls,1,'normal Radar path still serves V4');
  assert.equal(legacyCalls,1,'normal V4 path never calls legacy provider');

  const qonly=await call('/api/search',{action:'radar',chain:'ethereum',source:'legacy-v3'});
  assert.equal(qonly.body.servedList,'LEGACY_V3_REQUESTED','rewritten request query is forwarded');

  const invalid=await call('/api/search?action=radar&chain=ethereum&source=unknown',
   {action:'radar',chain:'ethereum',source:'unknown'});
  assert.equal(invalid.body.opportunity.servedList,'V4_OPPORTUNITY','no unapproved source bypass');
 }finally{
  radar.load=load;V4.serve=serve;
  for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];
  Object.assign(process.env,old);
 }
});
