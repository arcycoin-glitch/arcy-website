'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('../lib/radar-v2/http');

test('a clock function preserves a date-based Retry-After and blocks calls until expiry',async()=>{
 http._resetCooldowns();let now=Date.parse('2026-11-01T20:57:00Z'),calls=0;
 const fetcher=async()=>{calls++;return {ok:false,status:429,headers:new Headers({'retry-after':'Sun, 01 Nov 2026 20:58:30 GMT'})};};
 await assert.rejects(http.request('test-date-clock','https://provider.test',{fetcher,now:()=>now}),e=>e.code==='RADAR_PROVIDER_RATE_LIMITED'&&e.retryInMs===90000);
 now+=30000;
 await assert.rejects(http.request('test-date-clock','https://provider.test',{fetcher,now:()=>now}),e=>e.code==='RADAR_PROVIDER_RATE_LIMITED'&&e.retryInMs===60000);
 assert.equal(calls,1,'no upstream call during the declared cooldown');
 now+=60001;
 const result=await http.request('test-date-clock','https://provider.test',{fetcher:async()=>{calls++;return {ok:true,status:200,text:async()=>'{}'};},now:()=>now});
 assert.deepEqual(result,{});assert.equal(calls,2);
});
test('seconds-based Retry-After supports both epoch and clock callers',async()=>{
 for(const clock of [Date.parse('2026-11-01T20:00:00Z'),()=>Date.parse('2026-11-01T20:00:00Z')]){
  http._resetCooldowns();let calls=0;
  const fetcher=async()=>{calls++;return {ok:false,status:429,headers:new Headers({'retry-after':'120'})};};
  await assert.rejects(http.request('test-seconds-clock','https://provider.test',{fetcher,now:clock}),e=>e.retryInMs===120000);
  await assert.rejects(http.request('test-seconds-clock','https://provider.test',{fetcher,now:clock}),e=>e.retryInMs===120000);
  assert.equal(calls,1);
 }
});
test('an invalid clock fails before contacting the provider rather than bypassing cooldowns',async()=>{
 let calls=0;
 await assert.rejects(http.request('test-invalid-clock','https://provider.test',{fetcher:async()=>{calls++;},now:()=>NaN}),{code:'RADAR_INVALID_CLOCK'});
 assert.equal(calls,0);
});
