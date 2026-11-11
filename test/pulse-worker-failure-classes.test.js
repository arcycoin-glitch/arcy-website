'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const worker=require('../lib/pulse-worker-refresh');
const quietStorage={latest:async()=>null,audit:async()=>null,publish:async()=>{},failure:async()=>{}};
test('failure classes distinguish module, storage, RPC, upstream and integration problems without leaking detail',()=>{
 const missing=Object.assign(Error("Cannot find module '../../search/server/lib/chains'\nRequire stack:\n- /app/lib/pulse-onchain/rpc.js"),{code:'MODULE_NOT_FOUND'});
 assert.deepEqual(worker.classify(missing),{failureClass:'MODULE_NOT_FOUND',reasonCode:'PULSE_WORKER_MODULE_MISSING',module:'chains'});
 assert.ok(!JSON.stringify(worker.classify(missing)).includes('/app'));
 assert.equal(worker.classify(Object.assign(Error('x'),{code:'ENOSPC'})).failureClass,'STORAGE');
 assert.equal(worker.classify(Object.assign(Error('x'),{code:'PULSE_CHECKPOINT_BUSY'})).failureClass,'STORAGE');
 assert.equal(worker.classify(Object.assign(Error('x'),{code:'ONCHAIN_HTTP_429'})).failureClass,'RPC');
 assert.equal(worker.classify(Object.assign(Error('x'),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE'})).failureClass,'UPSTREAM_SOURCE');
 assert.equal(worker.classify(new TypeError('x is not a function')).failureClass,'WORKER_INTEGRATION');
 assert.deepEqual(worker.classify(Error('https://secret.example/key=abc')),{failureClass:'UNCLASSIFIED',reasonCode:'PULSE_REFRESH_FAILED'});
});
test('the on-chain monitor is not loaded when disabled and cannot stop the signed edition when it fails',async()=>{
 const key=require.resolve('../lib/pulse-onchain/monitor');delete require.cache[key];
 assert.equal(await worker.refreshIfDue({env:{},storage:quietStorage}),null);
 assert.equal(require.cache[key],undefined,'monitor must not be required while ARC_PULSE_ONCHAIN_ENABLED is unset');
 const broken={refreshAll:async()=>{throw Object.assign(Error("Cannot find module './gone'"),{code:'MODULE_NOT_FOUND'});}};
 const r=await worker.refreshIfDue({env:{ARC_PULSE_ONCHAIN_ENABLED:'1'},storage:quietStorage,onchainMonitor:broken});
 assert.equal(r.state,'ONCHAIN_MONITORED');
 assert.deepEqual(r.onchain,{status:'FAILED',reasonCode:'PULSE_ONCHAIN_MONITOR_FAILED',failure:{failureClass:'MODULE_NOT_FOUND',reasonCode:'PULSE_WORKER_MODULE_MISSING',module:'gone'}});
 // Signed edition still runs and reports its own component when the monitor is broken.
 let generated=0;const edition={cycle:()=>({start:0}),number:()=>9,generate:async()=>{generated++;throw Object.assign(Error('x'),{code:'PULSE_SOURCE_COVERAGE_INCOMPLETE'});}};
 const both=await worker.refreshIfDue({now:8*3600000,env:{ARC_PULSE_ONCHAIN_ENABLED:'1',ARC_PULSE_EDITION_DIR:'/x',ARC_PULSE_SIGNING_KEY:'k'},storage:quietStorage,edition,onchainMonitor:broken});
 assert.equal(generated,1);assert.equal(both.component,'SIGNED_EDITION');assert.equal(both.failureClass,'UPSTREAM_SOURCE');assert.equal(both.reasonCode,'PULSE_SOURCE_COVERAGE_INCOMPLETE');
 assert.equal(both.onchain.failure.failureClass,'MODULE_NOT_FOUND');
});
test('an unexpected failure is returned as a classified result instead of being thrown at the worker loop',async()=>{
 const storage={...quietStorage,latest:async()=>{throw Object.assign(Error('disk'),{code:'EIO'});}};
 const r=await worker.refreshIfDue({now:8*3600000,env:{ARC_PULSE_EDITION_DIR:'/x',ARC_PULSE_SIGNING_KEY:'k'},storage,edition:{cycle:()=>({start:0}),number:()=>9}});
 assert.deepEqual(r,{state:'FAILED',component:'PULSE_WORKER',reasonCode:'PULSE_REFRESH_FAILED',failureClass:'STORAGE',detailCode:'EIO'});
 const source=fs.readFileSync(path.join(__dirname,'..','lib','pulse-worker-refresh.js'),'utf8');
 assert.match(source,/event:'PULSE_WORKER_CONFIG'/);
 // The optional Radar module is not looked up (and not logged as missing) unless the indexer is enabled.
 const http=fs.readFileSync(path.join(__dirname,'..','lib','holder-worker-http.js'),'utf8');
 assert.match(http,/ARC_RADAR_INDEXER_ENABLED!=='true'\)radarCache=null/);
});
