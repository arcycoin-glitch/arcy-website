'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// Evaluate the actual frontend function with controlled browser timers and visibility.
// No network calls are made by these tests.
const src=fs.readFileSync(path.join(__dirname,'../search/market-radar.js'),'utf8');
const start=src.indexOf(' function scheduleOverviewRetry(');
const end=src.indexOf('\n async function refreshOverview(',start);
assert(start>0&&end>start,'Radar frontend must retain the tested scheduling function');
const implementation=src.slice(start,end);

function fixture(){
 const scheduled=[],listeners=new Map(),requests=[],renders=[],cleared=[];
 const overviewRetryAt=new Map(),overviewRetryTimers=new Map(),overviewAutoRetryUsed=new Set();
 const doc={
  visibilityState:'visible',
  addEventListener(type,handler){listeners.set(type,handler);},
  removeEventListener(type,handler){if(listeners.get(type)===handler)listeners.delete(type);}
 };
 const ctx={
  Date:{now:()=>5000},
  Math,overviewRetryAt,overviewRetryTimers,overviewAutoRetryUsed,document:doc,
  clearTimeout(handle){cleared.push(handle);},
  setTimeout(fn,ms){const handle={fn,ms,unref(){}};scheduled.push(handle);return handle;},
  renderOverview(network,data){renders.push({network,data});},
  refreshOverview(network){requests.push(network);return Promise.resolve(true);}
 };
 vm.runInNewContext(implementation+'\nthis.scheduleOverviewRetry=scheduleOverviewRetry;',ctx);
 return {schedule:ctx.scheduleOverviewRetry,scheduled,listeners,requests,renders,cleared,
  overviewRetryAt,overviewRetryTimers,overviewAutoRetryUsed,doc};
}

test('Retry-After schedules one real request per network; does not merely repaint',()=>{
 const x=fixture();
 const a=x.schedule('pons',30000);
 assert.equal(a.automatic,true);
 assert.equal(a.delay,36000,'Pons gets a stagger to avoid four simultaneous quota requests');
 assert.equal(x.overviewRetryAt.get('pons'),41000);
 assert.equal(x.requests.length,0,'never request before the cooldown');
 x.scheduled[0].fn();
 assert.deepEqual(x.requests,['pons']);
 assert.equal(x.overviewRetryAt.has('pons'),false);
 assert.equal(x.overviewRetryTimers.has('pons'),false);
 const b=x.schedule('pons',30000);
 assert.equal(b.automatic,false,'do not create repeating API calls after another rate limit');
 x.scheduled[1].fn();
 assert.deepEqual(x.requests,['pons'],'second cooldown only re-enables manual retry');
 assert.equal(x.renders.length,1);
});

test('a backgrounded tab defers its single retry until visible',()=>{
 const x=fixture();x.doc.visibilityState='hidden';
 x.schedule('arc',1000);x.scheduled[0].fn();
 assert.deepEqual(x.requests,[]);
 assert.equal(x.listeners.has('visibilitychange'),true);
 x.doc.visibilityState='visible';x.listeners.get('visibilitychange')();
 assert.deepEqual(x.requests,['arc']);
 assert.equal(x.listeners.size,0,'visibility listener must be removed');
});

test('retry is independently bounded and isolated per network',()=>{
 const x=fixture();
 assert.equal(x.schedule('arc',2000).delay,2000);
 assert.equal(x.schedule('ethereum',2000).delay,4000);
 assert.equal(x.schedule('robinhood',2000).delay,6000);
 assert.equal(x.schedule('pons',2000).delay,8000);
 assert.equal(x.overviewAutoRetryUsed.size,4);
 assert.equal(x.schedule('arc',48*3600*1000).delay,24*3600*1000);
 assert(x.cleared.length>=1);
});
