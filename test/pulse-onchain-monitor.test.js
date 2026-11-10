'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const monitor=require('../lib/pulse-onchain/monitor'),storage=require('../lib/pulse-onchain/checkpoint-storage'),watchlist=require('../lib/pulse-onchain/watchlist');
const NOW=Date.parse('2026-11-10T18:00:00Z'),HASH='0x'+'a'.repeat(64),TX=n=>'0x'+n.toString(16).padStart(64,'0');
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-pulse-checkpoints-'));try{await fn({ARC_PULSE_ONCHAIN_DIR:dir});}finally{await fs.rm(dir,{recursive:true,force:true});}}
function event(chain,block,id,hash=HASH){const cfg=watchlist.network(chain),tx=TX(id);return {id:'poc1-'+id.toString(16).padStart(24,'0'),network:chain,chainId:cfg.chainId,category:'OWNERSHIP_CHANGE',type:'OWNERSHIP_TRANSFERRED',headline:'Token: owner changed',summary:'Owner changed.',eventTimestamp:'2026-11-10T17:00:00.000Z',detectedAt:'2026-11-10T18:00:00.000Z',blockNumber:block,blockHash:hash,transactionHash:tx,logIndex:id,evidence:{reference:cfg.explorer+'/tx/'+tx},confirmation:{status:'CONFIRMED'},materiality:{level:'HIGH'}};}
function result(chain,from,to,events=[],{complete=true,overflow=0,status=events.length?'EVENTS_DETECTED':'NO_QUALIFYING_EVENTS',reasonCode=null,rpcCalls=9}={}){return {chain,chainId:watchlist.network(chain).chainId,status,complete,reasonCode,events,window:{fromBlock:from,toBlock:to,blocksCovered:to-from+1,blocksPlanned:to-from+1,toBlockHash:HASH,fromTimestamp:'2026-11-10T17:00:00.000Z',toTimestamp:'2026-11-10T18:00:00.000Z'},counts:{filtered:{overflow}},cost:{rpcCalls,httpRequests:rpcCalls}};}

test('checkpoint range capacity and retained event cap are bounded independently of sparse widening',()=>{
 for(const chain of Object.keys(watchlist.NETWORKS)){const cfg=watchlist.network(chain);assert.equal(monitor.scanCapacity(cfg),cfg.span*cfg.maxWindows);}
});

test('checkpoint advances through complete ranges, deduplicates event ids, and replaces the reorg overlap',()=>fixture(async env=>{
 const calls=[],scan=async options=>{calls.push(options);assert.equal(options.maxEvents,storage.MAX_EVENTS);if(!options.range)return result('ethereum',1000,1100,[event('ethereum',1005,1)]);assert.equal(options.range.fromBlock,1000);return result('ethereum',1000,1200,[event('ethereum',1005,1,'0x'+'b'.repeat(64)),event('ethereum',1150,2)]);};
 const first=await monitor.refreshChain('ethereum',{now:NOW,env,scan});
 assert.equal(first.complete,true,JSON.stringify(first));assert.equal(first.coverage.startBlock,1000);assert.equal(first.coverage.nextBlock,1101);assert.equal(first.coverage.completeFromGenesis,false);
 const skip=await monitor.refreshChain('ethereum',{now:NOW+monitor.INTERVAL_MS-1,env,scan});assert.equal(skip.skipped,true);assert.equal(calls.length,1);
 const next=await monitor.refreshChain('ethereum',{now:NOW+monitor.INTERVAL_MS,env,scan});
 assert.equal(next.complete,true);assert.equal(next.coverage.nextBlock,1201);assert.equal(next.coverage.startBlock,1000);
 assert.equal(next.events.length,2);assert.equal(new Set(next.events.map(e=>e.id)).size,2);
 assert.equal(next.events.find(e=>e.id===event('ethereum',1005,1).id).blockHash,'0x'+'b'.repeat(64));
 assert.equal(calls[1].range.toBlock,1101+monitor.scanCapacity(watchlist.network('ethereum'))-1);
 const disk=await storage.read('ethereum',{env});assert.equal(disk.revision,2);assert.equal(disk.coverage.lastSuccessfulBlock,1200);
}));

test('provider failure and overflow preserve last good cursor and events',()=>fixture(async env=>{
 const original=event('arc',2000,3),scan=async()=>result('arc',1900,2100,[original]);
 const first=await monitor.refreshChain('arc',{now:NOW,env,scan}),cursor=first.coverage.nextBlock;
 const failed=await monitor.refreshChain('arc',{now:NOW+monitor.INTERVAL_MS,env,scan:async()=>({status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode:'ONCHAIN_PROVIDER_UNAVAILABLE',events:[],cost:{rpcCalls:4}})});
 assert.equal(failed.status,'PROVIDER_UNAVAILABLE');assert.equal(failed.coverage.nextBlock,cursor);assert.deepEqual(failed.events,[original]);
 const backedOff=await monitor.refreshChain('arc',{now:NOW+monitor.INTERVAL_MS+monitor.RETRY_MS-1,env,scan});assert.equal(backedOff.skipped,true);
 const overflow=await monitor.refreshChain('arc',{now:NOW+monitor.INTERVAL_MS+monitor.RETRY_MS,env,scan:async options=>result('arc',cursor-64,cursor+20,[],{overflow:1})});
 assert.equal(overflow.complete,false);assert.equal(overflow.reasonCode,'PULSE_EVENT_BATCH_OVERFLOW');assert.equal(overflow.lastAttempt.reasonCode,'PULSE_EVENT_BATCH_OVERFLOW');assert.equal(overflow.coverage.nextBlock,cursor);assert.deepEqual(overflow.events,[original]);
}));

test('a failed first bootstrap persists retry timing without inventing a coverage cursor',()=>fixture(async env=>{
 let calls=0;const failed=await monitor.refreshChain('ethereum',{now:NOW,env,scan:async()=>{calls++;return {status:'PROVIDER_UNAVAILABLE',complete:false,reasonCode:'ONCHAIN_PROVIDER_UNAVAILABLE',events:[],cost:{rpcCalls:3}};}});
 assert.equal(failed.coverage,null);assert.equal(failed.reasonCode,'ONCHAIN_PROVIDER_UNAVAILABLE');
 const persisted=await storage.read('ethereum',{env});assert.equal(persisted.coverage,null);assert.equal(persisted.revision,1);
 const retry=await monitor.refreshChain('ethereum',{now:NOW+monitor.RETRY_MS-1,env,scan:async()=>{calls++;return result('ethereum',100,120);}});
 assert.equal(retry.skipped,true);assert.equal(retry.reasonCode,'RETRY_BACKOFF');assert.equal(calls,1);
 const recovered=await monitor.refreshChain('ethereum',{now:NOW+monitor.RETRY_MS,env,scan:async()=>{calls++;return result('ethereum',100,120);}});
 assert.equal(recovered.complete,true);assert.equal(recovered.coverage.startBlock,100);assert.equal(recovered.coverage.nextBlock,121);assert.equal(calls,2);
}));

test('refreshes are serialized per chain and source failures stay isolated across networks',()=>fixture(async env=>{
 let calls=0,release;const gate=new Promise(resolve=>release=resolve);
 const scan=async options=>{calls++;if(options.chain==='ethereum')throw Object.assign(Error(),{code:'ONCHAIN_PROVIDER_UNAVAILABLE'});if(options.chain==='arc'&&calls===1)await gate;return result(options.chain,100,150);};
 const a=monitor.refreshChain('arc',{now:NOW,env,scan}),b=monitor.refreshChain('arc',{now:NOW,env,scan});release();
 const [one,two]=await Promise.all([a,b]);const states=[one,two];assert.equal(calls,1);assert.ok(states.every(x=>x.complete));assert.equal(states.filter(x=>x.skipped).length,1,JSON.stringify(states));
 const all=await monitor.refreshAll({now:NOW,env,scan});
 assert.equal(all.arc.complete,true);assert.equal(all.robinhood.complete,true);assert.equal(all.ethereum.status,'PROVIDER_UNAVAILABLE');
 assert.equal(all.ethereum.reasonCode,'ONCHAIN_PROVIDER_UNAVAILABLE');
}));

test('checkpoint storage rejects corrupt persisted state and requires an explicit durable directory',async()=>{
 assert.throws(()=>storage.fileFor('ethereum',{}),{code:'PULSE_CHECKPOINT_STORAGE_UNCONFIGURED'});
 await fixture(async env=>{await fs.writeFile(storage.fileFor('ethereum',env),'{bad json');await assert.rejects(()=>storage.read('ethereum',{env}),{code:'PULSE_CHECKPOINT_READ_FAILED'});});
});
