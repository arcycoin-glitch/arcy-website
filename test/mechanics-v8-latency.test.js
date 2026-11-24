'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compareLatency,augmentCount,percentile}=require('../scripts/mechanics-v8-latency.cjs');
const row=(chain,address,ms,aug=0,block='0x11')=>({chain,address,ms,block,group:'fixed',net:{rpc:4,augAuthority:aug}});
test('replay-only and additional-live-read latencies are not mixed',()=>{
 const before={rows:[row('arc','0xaa',10),row('ethereum','0xbb',20),row('ethereum','0xcc',30)]};
 const after={rows:[row('arc','0xaa',12),row('ethereum','0xbb',600,5),row('ethereum','0xcc',32)]};
 const m=compareLatency(before,after);
 assert.equal(m.measurementClass,'MIXED_REPLAY_WITH_LIVE_AUGMENTATION');
 assert.equal(m.pairedSubjects,3);assert.equal(m.recordedOnly.subjects,2);
 assert.equal(m.recordedOnly.after.p95Ms,32);assert.equal(m.augmentedOnly.after.p95Ms,600);
 assert.equal(m.additionalRequests,5);assert.equal(m.augmentedOutliers[0].address,'0xbb');
 assert.equal(m.byNetwork.ethereum.recordedOnly.subjects,1);
});
test('mismatched blocks are excluded',()=>{
 const m=compareLatency({rows:[row('arc','0xaa',1)]},{rows:[row('arc','0xaa',10,0,'0x12')]});
 assert.equal(m.pairedSubjects,0);assert.equal(m.overall.after.p95Ms,null);
});
test('RPC and replay hits are not counted as live augmentation',()=>{
 assert.equal(augmentCount({net:{rpc:100,replayHit:10,augBinding:2,augAuthoritySource:3}}),5);
 assert.equal(percentile([100,1,2,10],.95),100);
});
