'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../search/market-radar.js'),'utf8');

// Test the actual cooldown callback body in isolation. No DOM or upstream RPC provider is contacted.
const code=script.match(/const retryTimer=setTimeout\(\(\)=>\{([\s\S]*?)\},wait\);/)?.[1];
test('Radar cooldown handler remains valid and reserves only one recovery attempt',()=>{
 assert.ok(code,'missing cooldown-expiry callback');
 assert.doesNotThrow(()=>new Function('overviewRetryAt','overviewRetryTimers','overviewAutoRetries',
  'active','selected','document','network','refreshOverview','renderOverview',code));
 const fire=new Function('overviewRetryAt','overviewRetryTimers','overviewAutoRetries',
  'active','selected','document','network','refreshOverview','renderOverview',code);
 const retryAt=new Map([['pons',1000]]),timers=new Map([['pons',1]]),attempts=new Map();
 let fetches=0,renders=0;
 const run=({active='radar',selected='pons',hidden=false,network='pons'}={})=>
  fire(retryAt,timers,attempts,active,selected,{hidden},network,
   ()=>{fetches++;return Promise.resolve(true);},()=>{renders++;});
 run();
 assert.equal(fetches,1,'active visible selected card gets a single recovery attempt');
 assert.equal(renders,0);
 assert.equal(attempts.get('pons'),true);
 assert.equal(retryAt.has('pons'),false,'expiry clears the Retry-After gate');
 run();
 assert.equal(fetches,1,'second Retry-After does not trigger a request loop');
 assert.equal(renders,1,'second failure falls back to the manual retry state');
 assert.equal(timers.has('pons'),false);
});
test('hidden and unselected Radar cards never automatically fetch after Retry-After',()=>{
 assert.ok(code);
 const fire=new Function('overviewRetryAt','overviewRetryTimers','overviewAutoRetries',
  'active','selected','document','network','refreshOverview','renderOverview',code);
 for(const view of [
  {active:'radar',selected:'pons',hidden:true},
  {active:'research',selected:'pons',hidden:false},
  {active:'radar',selected:'ethereum',hidden:false}
 ]){
  let fetches=0,renders=0;
  const attempts=new Map();
  fire(new Map(),new Map(),attempts,view.active,view.selected,{hidden:view.hidden},
   'pons',()=>{fetches++;},()=>{renders++;});
  assert.equal(fetches,0,JSON.stringify(view));
  assert.equal(renders,1,JSON.stringify(view));
  assert.equal(attempts.size,0,JSON.stringify(view));
 }
});
test('a user manual retry and a successful valid network response reset the one-shot guard',()=>{
 assert.match(script,/if\(!overviewData\.has\(id\)\)\{overviewAutoRetries\.delete\(id\);void refreshOverview\(id\);return;\}/);
 assert.match(script,/if\(validOverview\(network,data\)\)overviewAutoRetries\.delete\(network\);/);
 assert.doesNotThrow(()=>new Function(script));
});
