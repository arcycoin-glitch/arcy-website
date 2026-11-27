'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../scripts/radar-railway-dispatch.cjs');

const NOW=Date.parse('2026-11-26T12:00:00Z');
const TOKEN='github_pat_test_only_123456789012345678901';
const response=(body,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(body)});
function harness({snapshotAgeMin=125,runs=[],dispatchStatus=204,snapshotStatus=200,runsStatus=200}={}){
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,opts});
  if(url===S.SNAPSHOT_URL)return response({generatedAt:new Date(NOW-snapshotAgeMin*60000).toISOString()},snapshotStatus);
  if(url===S.RUNS_URL)return response({workflow_runs:runs},runsStatus);
  if(url===S.DISPATCH_URL)return {status:dispatchStatus,ok:dispatchStatus===204};
  throw Error('Unexpected host/path');
 };
 return {fetcher,calls};
}
const run=(h,extra={})=>S.check({fetcher:h.fetcher,token:TOKEN,now:NOW,delay:async()=>{},...extra});

test('a snapshot under 100 minutes needs no workflow dispatch or GitHub API read',async()=>{
 const h=harness({snapshotAgeMin:99});
 const r=await run(h);
 assert.equal(r.state,'SKIPPED');assert.equal(r.reason,'SNAPSHOT_UNDER_100_MINUTES');
 assert.deepEqual(h.calls.map(c=>c.url),[S.SNAPSHOT_URL]);
});
test('a genuinely due snapshot dispatches main production once with fixed endpoint and no secret logs',async()=>{
 const h=harness({snapshotAgeMin:145});
 const r=await run(h);
 assert.equal(r.state,'DISPATCHED');assert.equal(r.reason,'DUE');
 assert.deepEqual(h.calls.map(c=>c.url),[S.SNAPSHOT_URL,S.RUNS_URL,S.DISPATCH_URL]);
 const p=h.calls[2].opts;
 assert.equal(p.method,'POST');assert.equal(p.redirect,'error');
 assert.deepEqual(JSON.parse(p.body),{ref:'main',inputs:{target:'production',only_if_due:true}});
 assert.equal(p.headers.authorization,'Bearer '+TOKEN);
 assert(!JSON.stringify(r).includes(TOKEN));
 assert.equal(S.REPO,'arcycoin-glitch/arcy-website');
 assert.equal(S.WORKFLOW,'radar-v4-snapshot.yml');
});
test('one active schedule or manual workflow is enough to prevent extra dispatch',async()=>{
 for(const event of ['schedule','workflow_dispatch']){
  const h=harness({runs:[{created_at:new Date(NOW-6*3600000).toISOString(),status:'in_progress',event}]});
  const r=await run(h);
  assert.equal(r.reason,'WORKFLOW_ALREADY_RUNNING_OR_RECENT');
  assert(!h.calls.some(x=>x.url===S.DISPATCH_URL));
 }
});
test('recently completed schedule run blocks a second build despite raw snapshot propagation delay',async()=>{
 const h=harness({runs:[{created_at:new Date(NOW-12*60000).toISOString(),status:'completed',event:'schedule'}]});
 const r=await run(h);
 assert.equal(r.state,'SKIPPED');assert(!h.calls.some(c=>c.url===S.DISPATCH_URL));
});
test('failed, absent or short credentials never initiate network activity',async()=>{
 for(const token of [undefined,'', 'not-a-token']){
  const h=harness();
  const r=await S.check({fetcher:h.fetcher,now:NOW,token});
  assert.equal(r.state,'CONFIGURATION_REQUIRED');assert.deepEqual(h.calls,[]);
 }
});
test('a forbidden run-state API reports configuration required without dispatching or retrying',async()=>{
 const h=harness({runsStatus:403});
 const r=await run(h);
 assert.equal(r.state,'CONFIGURATION_REQUIRED');assert.equal(r.reason,'GITHUB_ACTIONS_PERMISSION_DENIED');assert.equal(r.stage,'run-state');
 assert.equal(h.calls.filter(x=>x.url===S.RUNS_URL).length,1);
 assert(!h.calls.some(x=>x.url===S.DISPATCH_URL));
});
test('if dispatch fails, report non-secret status and do not fabricate success',async()=>{
 const h=harness({dispatchStatus:429});
 const r=await run(h);
 assert.equal(r.state,'BLOCKED');assert.equal(r.reason,'DISPATCH_HTTP_429');
 assert(!JSON.stringify(r).includes(TOKEN));
});
test('unreadable production snapshot attempts bounded recovery only after checking existing GitHub runs',async()=>{
 const h=harness({snapshotStatus:503});
 const r=await run(h);
 assert.equal(r.state,'DISPATCHED');assert.equal(r.reason,'SNAPSHOT_SOURCE_UNREADABLE');
 assert.equal(r.snapshotReadable,false);
 assert.equal(h.calls.length,4,'one bounded GET retry, then the run-state gate and one POST');
});
test('a failed start/created date does not by itself mark a completed old run as recent',()=>{
 assert.equal(S.recentOrBusy({status:'completed',event:'schedule',created_at:'n/a'},NOW),false);
 assert.equal(S.recentOrBusy({status:'queued',event:'schedule',created_at:'n/a'},NOW),true);
 assert.equal(S.recentOrBusy({status:'completed',event:'schedule',created_at:new Date(NOW-46*60000).toISOString()},NOW),false);
});
