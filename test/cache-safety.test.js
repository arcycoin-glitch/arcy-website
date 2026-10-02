const {test}=require('node:test'),assert=require('node:assert/strict'),f=require('../lib/fields');
test('source cache coalesces a slow request past TTL and starts freshness when it completes',async()=>{
 f.clearCache();let finish,calls=0;const read=()=>{calls++;return new Promise(r=>finish=r);};
 const first=f.cached('slow',1,read);await new Promise(r=>setTimeout(r,5));const second=f.cached('slow',1,read);finish({dataState:'DATA_FOUND',value:42});assert.deepEqual(await first,await second);assert.equal(calls,1);
});
test('fresh evidence is reused; expired evidence fails closed and repeated 429s share a bounded cooldown',async()=>{
 f.clearCache();let calls=0,now=1000;const original=Date.now;Date.now=()=>now;
 try{const read=async()=>{calls++;if(calls>1)throw Object.assign(Error('HTTP 429'),{httpStatus:429});return {value:42,dataState:'DATA_FOUND'};};
 assert.equal((await f.cached('limit',100,read)).value,42);now=1050;assert.equal((await f.cached('limit',100,read)).value,42);assert.equal(calls,1);
 now=1101;await assert.rejects(f.cached('limit',100,read),{httpStatus:429});await assert.rejects(f.cached('limit',100,read),{httpStatus:429});assert.equal(calls,2);
 now=11102;assert.equal((await f.cached('limit',100,async()=>({value:43,dataState:'DATA_FOUND'}))).value,43);
 }finally{Date.now=original;f.clearCache();}
});
