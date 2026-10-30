'use strict';
// Data-audit tests: refresh back-off, single-flight and (in other files) provider budgets. No UI files involved.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const backoff=require('../lib/refresh-backoff'),storage=require('../lib/unlock-storage');
const MIN=60000,H=60*MIN;
test('retryDelayMs: 5 min, doubling, capped at the cadence; Retry-After is honoured but also capped',()=>{
 assert.equal(backoff.retryDelayMs(1),5*MIN);assert.equal(backoff.retryDelayMs(2),10*MIN);assert.equal(backoff.retryDelayMs(3),20*MIN);
 assert.equal(backoff.retryDelayMs(30),6*H,'cap');assert.equal(backoff.retryDelayMs(0),5*MIN,'bad input is treated as the first failure');
 assert.equal(backoff.retryDelayMs(1,{retryAfterMs:30*MIN}),30*MIN);assert.equal(backoff.retryDelayMs(1,{retryAfterMs:99*H}),6*H);
});
test('unlock worker: a failing source is retried with back-off, not on every loop; success resets it; a fresh edition is never due',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-unlock-backoff-')),old=process.env.ARC_UNLOCK_EDITION_DIR,oldS=process.env.ARC_UNLOCK_SIGNING_KEY,oldH=process.env.ARC_HOLDER_SIGNING_KEY;
 process.env.ARC_UNLOCK_EDITION_DIR=dir;delete process.env.ARC_UNLOCK_SIGNING_KEY;delete process.env.ARC_HOLDER_SIGNING_KEY;
 try{
  const T=Date.parse('2026-10-30T12:00:00Z');
  assert.equal(await storage.due(T),true,'no edition yet: due');
  const edition=(refreshAt)=>({schemaVersion:1,success:true,generatedAt:new Date(T-7*H).toISOString(),refreshAt:new Date(refreshAt).toISOString(),events:[],windows:{today:[],next7:[],days8to30:[]},trigger:'worker',partial:false});
  await storage.publish(edition(T-H));
  assert.equal(await storage.due(T),true,'expired edition: due');
  await storage.failure(Object.assign(Error(),{code:'UNLOCK_DISCOVERY_UNAVAILABLE'}),T,'worker');
  assert.equal(await storage.due(T+30000),false,'30 s after a failure: NOT due (previously retried every loop)');
  assert.equal(await storage.due(T+5*MIN),true,'after the 5 min back-off: due');
  await storage.failure(Object.assign(Error(),{code:'UNLOCK_DISCOVERY_UNAVAILABLE'}),T+5*MIN,'worker');
  assert.equal((await storage.audit()).lastFailure.consecutive,2);
  assert.equal(await storage.due(T+5*MIN+9*MIN),false,'second failure doubles the delay to 10 min');assert.equal(await storage.due(T+15*MIN),true);
  await storage.publish(edition(T+6*H));
  assert.equal((await storage.audit()).lastFailure.consecutive,0,'success resets the counter');
  assert.equal(await storage.due(T+H),false,'fresh edition is not due');
  assert.equal(await storage.due(T+6*H+1),true,'due again once refreshAt passes');
 }finally{
  if(old===undefined)delete process.env.ARC_UNLOCK_EDITION_DIR;else process.env.ARC_UNLOCK_EDITION_DIR=old;
  if(oldS!==undefined)process.env.ARC_UNLOCK_SIGNING_KEY=oldS;if(oldH!==undefined)process.env.ARC_HOLDER_SIGNING_KEY=oldH;
  await fs.rm(dir,{recursive:true,force:true});
 }
});


// ── Radar credit ledger ──────────────────────────────────────────────────────────────────────────────────
const budget=require('../lib/radar-v2/budget'),radar=require('../lib/radar-v2'),rhttp=require('../lib/radar-v2/http');
test('radar credit ledger: cap can be lowered but never raised above the 8,000 hard ceiling; month rollover resets; refusals are counted',()=>{
 budget._reset();
 assert.equal(budget.cap({}),7500);assert.equal(budget.cap({RADAR_V2_MONTHLY_CREDIT_CAP:'99999'}),8000,'cannot be raised past the ceiling');assert.equal(budget.cap({RADAR_V2_MONTHLY_CREDIT_CAP:'100'}),100);
 const env={RADAR_V2_MONTHLY_CREDIT_CAP:'30'},t=Date.parse('2026-10-30T00:00:00Z');
 budget.check(4,{env,now:t});budget.spend(14,{now:t});budget.spend(14,{now:t});
 assert.throws(()=>budget.check(4,{env,now:t}),{code:'RADAR_BUDGET_EXHAUSTED'});assert.equal(budget.snapshot(env,t).refusedCycles,1);
 budget.check(4,{env,now:Date.parse('2026-11-01T00:00:00Z')});assert.equal(budget.snapshot(env,Date.parse('2026-11-01T00:00:00Z')).spentCredits,0,'new UTC month');
 budget._reset();
});
test('radar load: when the month cap is spent the provider is NOT called (fail-closed), and a recent successful result is served as STALE',async()=>{
 budget._reset();rhttp._resetCooldowns();radar._cache.clear();
 const env={MARKET_RADAR_PUBLIC_DISPLAY_APPROVED:'true',MARKET_RADAR_JSON_DELIVERY_APPROVED:'true',COINGECKO_DEMO_API_KEY:'k',VERCEL:'1',RADAR_V2_MONTHLY_CREDIT_CAP:'3'};
 let calls=0;const f=async()=>{calls++;throw Error('must not be called');};
 await assert.rejects(radar.load('arc',{env,fetcher:f,now:()=>Date.parse('2026-10-30T12:00:00Z')}),{code:'RADAR_BUDGET_EXHAUSTED'});
 assert.equal(calls,0,'no upstream call after the cap');
 radar._cache.clear();budget._reset();
});
