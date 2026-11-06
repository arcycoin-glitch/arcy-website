'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const radar=require('../lib/radar-v2');
const discovery=require('../lib/radar-v2/discovery');

function windows(network,mode){
  const plan=radar.channelPlan(network,mode);
  return plan.channels.flatMap(([kind])=>Array.from({length:kind==='top'?plan.topPages:1},(_,i)=>kind+':'+(i+1)));
}
test('Arc Demo samples 2 pages of mature candidates with unchanged 3-page cost',()=>{
  assert.deepEqual(windows('arc','demo'),['top:1','top:2','trending:1']);
  assert.equal(windows('arc','demo').length,3);
  assert.equal(radar.channelPlan('arc','demo').arcDemo,true);
});
test('Arc Pro and every other network retain their established discovery windows',()=>{
  assert.deepEqual(windows('arc','pro'),['top:1','top:2','trending:1','new:1']);
  for(const network of ['ethereum','robinhood','pons']){
    assert.deepEqual(windows(network,'demo'),['top:1','trending:1','new:1'],network);
    assert.deepEqual(windows(network,'pro'),['top:1','top:2','trending:1','new:1'],network);
  }
});
test('24h maturity and all network safety floors remain unchanged',()=>{
  const now=Date.parse('2026-11-07T01:00:00.000Z');
  const young={poolCreatedAt:new Date(now-12*3600000).toISOString()};
  const old={poolCreatedAt:new Date(now-48*3600000).toISOString()};
  assert.equal(discovery.rankingMaturityIssue(young,now).reason,'POOL_UNDER_24H');
  assert.equal(discovery.rankingMaturityIssue(old,now),null);
  assert.equal(discovery.PROFILES.arc.minVol,5000);
  assert.equal(discovery.PROFILES.arc.minLiq,20000);
  assert.equal(discovery.SCORE_VERSION,'arcy-discovery-2');
});
test('Arc changes stay inside backend candidate gathering only',()=>{
  const src=fs.readFileSync('lib/radar-v2/index.js','utf8');
  assert.match(src,/const plan=channelPlan\(network,access\.mode\)/);
  assert.match(src,/const pages=kind==='top'\?plan\.topPages:1/);
  assert.match(src,/if\(plan\.arcDemo\)channelStatus\.new='SKIPPED_IN_FAVOR_OF_TOP_PAGE_2'/);
  assert.match(src,/const maturity=D\.rankingMaturityIssue\(view,t,\{strict:true\}\)/);
  assert.match(src,/const dv=D\.diversify\(verified\.map/);
});
