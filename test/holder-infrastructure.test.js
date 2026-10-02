const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const storage=require('../lib/holder-storage'),worker=require('../lib/holder-candidates'),index=require('../lib/holder-index'),reader=require('../lib/balance-reader'),c=require('../lib/core'),fields=require('../lib/fields');
const a='0x'+'d'.repeat(40),x='0x'+'1'.repeat(40),y='0x'+'2'.repeat(40),anchor='0x'+'a'.repeat(64),word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0'),name=a+'-candidates';
function state(pinned='0xa',age=0){const at=Date.now()-age,addresses=[x,y,...c.BURNS],balances=addresses.map(a=>[a,a===x?'600':a===y?'400':'0']);const result={...index.aggregate(balances,1000n,[{source:'test pinned RPC',block:pinned,anchor,totalSupplyRaw:'1000'}]),block:pinned,snapshot:{block:pinned,completedAt:new Date(at).toISOString(),maxCacheAgeSeconds:600}};return {version:1,address:a,chainId:5042,phase:'COMPLETE',startedAt:at,completedAt:at,block:pinned,anchor,total:'1000',addresses,balances,balanceCursor:addresses.length,result};}
async function fixture(fn){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-storage-test-')),keys=['ARC_INDEX_CACHE_DIR','ARC_INDEX_REDIS_URL','ARC_INDEX_REDIS_TOKEN','ARC_HOLDER_MAX_SNAPSHOT_AGE_SECONDS'],env=Object.fromEntries(keys.map(k=>[k,process.env[k]])),old=[c.context,c.call,c.rpc,c.json,reader.balances];process.env.ARC_INDEX_CACHE_DIR=folder;delete process.env.ARC_INDEX_REDIS_URL;delete process.env.ARC_INDEX_REDIS_TOKEN;delete process.env.ARC_HOLDER_MAX_SNAPSHOT_AGE_SECONDS;fields.clearCache();const calls={context:0,pages:[],logs:[]};c.context=async()=>{calls.context++;return {block:'0xb'};};c.call=async()=>word(1000);c.rpc=async(method,params)=>{if(method==='eth_chainId')return '0x13b2';if(method==='eth_getBlockByNumber')return {hash:anchor};if(method==='eth_getLogs'){calls.logs.push(params[0]);return [];}throw Error('Unexpected RPC');};c.json=async url=>{if(url.endsWith('/stats'))return {chainId:5042,indexedBlocks:11};if(!url.includes('holders?'))return {address:a};const offset=Number(new URL(url).searchParams.get('offset'));calls.pages.push(offset);return offset===0?{items:[{address:x},{address:y}],nextOffset:2}:{items:[],nextOffset:null};};reader.balances=async(_a,addresses,pinned)=>({method:'test pinned read',values:addresses.map(a=>word(a===x?600:a===y?400:0))});try{await fn({folder,calls});}finally{[c.context,c.call,c.rpc,c.json,reader.balances]=old;for(const k of keys)if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];fields.clearCache();const resolved=path.resolve(folder);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('arcy-storage-test-'))await fs.rm(resolved,{recursive:true,force:true});}}
test('first scan checkpoints, partial metrics stay absent, resume completes and a separate process reads the same snapshot',()=>fixture(async({folder,calls})=>{
 let r=await worker.advance(a,{maxPages:1,maxBatches:0});assert.equal(r.value,null);assert.equal((await storage.load(name)).offset,2);
 r=await worker.advance(a,{maxPages:1,maxBatches:0});assert.equal(r.value,null);assert.equal(r.coverage.phase,'READ');assert.equal(await storage.snapshot(name),null);
 r=await worker.advance(a,{maxPages:0,maxBatches:1});assert.equal(r.value.holderCount,2);assert.equal(r.value.block,'0xb');assert.equal(r.value.snapshot.freshness,'FRESH');
 const output=execFileSync(process.execPath,['-e',`const s=require(${JSON.stringify(path.resolve(__dirname,'../lib/holder-storage'))});s.snapshot(${JSON.stringify(name)}).then(d=>console.log(JSON.stringify(d)));`],{env:{...process.env,ARC_INDEX_CACHE_DIR:folder},windowsHide:true,encoding:'utf8'});assert.equal(JSON.parse(output).holderCount,2);
 const before=calls.context;r=await worker.advance(a);assert.equal(r.value.holderCount,2);assert.equal(calls.context,before);assert.deepEqual(calls.pages,[0,2]);
}));
test('an incomplete refresh preserves the four old metrics and atomically publishes all four at the next completed block',()=>fixture(async()=>{
 const original=state('0xa',700000);await storage.save(name,original);let r=await worker.advance(a,{maxPages:0,maxBatches:0});assert.equal(r.value.block,'0xa');assert.equal(r.value.snapshot.freshness,'STALE');assert.equal(r.value.scannedAt,original.result.snapshot.completedAt);assert.equal((await storage.load(name)).phase,'TAIL');assert.equal((await storage.snapshot(name)).block,'0xa');
 reader.balances=async(_a,addresses,pinned)=>{assert.equal(pinned,'0xb');return {method:'test pinned',values:addresses.map(a=>word([x,y].includes(a)?500:0))};};r=await worker.advance(a,{maxPages:1,maxBatches:1});assert.equal(r.value.block,'0xb');assert.equal(r.value.largestWalletPct,50);assert.equal(r.value.snapshot.freshness,'FRESH');for(const field of Object.values(r.value.fields))assert.equal(field.snapshot.block,'0xb');assert.equal((await storage.snapshot(name)).block,'0xb');
}));
test('429 refresh returns explicitly stale COMPLETE evidence and preserves the persisted successful snapshot',()=>fixture(async()=>{
 const original=state('0xa',700000);await storage.save(name,original);const rpc=c.rpc;c.rpc=async(m,p)=>m==='eth_getLogs'?Promise.reject(Object.assign(Error(),{httpStatus:429})):rpc(m,p);const r=await worker.advance(a);assert.equal(r.value.holderCount,2);assert.equal(r.value.snapshot.freshness,'STALE');assert.equal(r.value.snapshot.refresh.httpStatus,429);assert.equal(r.value.scannedAt,original.result.snapshot.completedAt);assert.equal((await storage.snapshot(name)).block,'0xa');
}));
test('snapshots outside the maximum historical age are not served during failed refresh',()=>fixture(async()=>{
 await storage.save(name,state('0xa',3700000));const rpc=c.rpc;c.rpc=async(m,p)=>m==='eth_getLogs'?Promise.reject(Object.assign(Error(),{httpStatus:429})):rpc(m,p);await assert.rejects(worker.advance(a),{httpStatus:429});assert.equal((await storage.snapshot(name)).block,'0xa');
}));
test('snapshot-first API serves old verified historical evidence without waiting for RPC or refresh',()=>fixture(async({folder})=>{
 const previous=state('0xa',172800000);await storage.save(name,previous);
 c.rpc=c.context=c.call=async()=>{throw Error('Snapshot display must not wait for RPC');};
 const response=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});
 assert.equal(response.holderCount,2);assert.equal(response.largestWalletPct,60);assert.equal(response.snapshot.freshness,'LAST_VERIFIED');assert.equal(response.snapshot.completedAt,previous.result.snapshot.completedAt);assert.equal(response.scannedAt,previous.result.snapshot.completedAt);assert.deepEqual(await storage.due(),[a]);
 const separate=execFileSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve(__dirname,'../lib/holder-display'))}).cached(${JSON.stringify(a)}).then(d=>console.log(JSON.stringify(d)));`],{env:{...process.env,ARC_INDEX_CACHE_DIR:folder},windowsHide:true,encoding:'utf8'});
 assert.equal(JSON.parse(separate).block,'0xa');assert.equal(JSON.parse(separate).snapshot.freshness,'LAST_VERIFIED');
}));
test('snapshot display preserves COMPLETE while refresh checkpoint is partial and queue fails',()=>fixture(async()=>{
 const original=state('0xa',700000);await storage.save(name,original);await worker.advance(a,{maxPages:0,maxBatches:0});
 const old=storage.enqueue;storage.enqueue=async()=>{throw Object.assign(Error(),{code:'STORAGE_UNAVAILABLE'});};
 try{const value=await require('../lib/holder-display').cached(a);assert.equal(value.holderCount,2);assert.equal(value.block,'0xa');assert.equal(value.snapshot.refresh.state,'FAILED');assert.equal(value.snapshot.refresh.reasonCode,'STORAGE_UNAVAILABLE');assert.equal((await storage.load(name)).phase,'TAIL');assert.equal((await storage.snapshot(name)).block,'0xa');}finally{storage.enqueue=old;}
}));
test('timeout and reconciliation failures retain historical evidence, then a successful COMPLETE replaces all four metrics',()=>fixture(async()=>{
 await storage.save(name,state('0xa',172800000));const rpc=c.rpc;
 c.rpc=async(m,p)=>m==='eth_getLogs'?Promise.reject(Object.assign(Error(),{name:'TimeoutError'})):rpc(m,p);
 await assert.rejects(worker.advance(a));assert.equal((await require('../lib/holder-display').cached(a)).block,'0xa');c.rpc=rpc;
 reader.balances=async(_a,addresses)=>({method:'test',values:addresses.map(()=>word(0))});const failed=await worker.advance(a);assert.equal(failed.reasonCode,'HOLDER_SUPPLY_RECONCILIATION_FAILED');assert.equal((await require('../lib/holder-display').cached(a)).block,'0xa');
 reader.balances=async(_a,addresses)=>({method:'test',values:addresses.map(a=>word(a===x?500:a===y?500:0))});await worker.advance(a);const next=await require('../lib/holder-display').cached(a);assert.equal(next.block,'0xb');assert.equal(next.largestWalletPct,50);for(const field of Object.values(next.fields))assert.equal(field.snapshot.block,'0xb');
}));
test('holder first-scan model has four unverified values and a building status, with no loading dots',()=>{
 const model=require('../ui-model'),view=model.summarize('whales');assert.equal(view.badge,'BUILDING VERIFIED HOLDER SNAPSHOT');assert.equal(view.fields.length,4);assert.ok(view.fields.every(f=>f.text==='NOT VERIFIED'&&f.dataState==='NOT_VERIFIED'));
 const snapshot=require('../lib/holder-display').historical(state().result);assert.equal(model.summarize('whales',{ok:true,...snapshot}).badge,'LAST VERIFIED SNAPSHOT');
});
test('exhausted adapters retain the queued building status without publishing partial metrics',()=>fixture(async()=>{
 const gp=require('../lib/goplus'),old=[worker.advance,index.explorer,index.advance,gp.holders];worker.advance=async()=>({value:null,status:'NOT_VERIFIED',reasonCode:'HOLDER_PINNED_RECONCILIATION_IN_PROGRESS',coverage:{complete:false,phase:'READ'}});index.explorer=index.advance=gp.holders=async()=>({value:null,status:'NOT_VERIFIED',dataState:'SOURCE_API_FAILED',reasonCode:'UPSTREAM_HTTP_ERROR',httpStatus:429});
 try{const d=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(d.reasonCode,'FALLBACKS_EXHAUSTED');assert.equal(d.coverage.refreshQueued,true);assert.equal(d.coverage.phase,'READ');assert.equal(d.coverage.complete,false);assert.ok(d.attempts.some(x=>x.httpStatus===429));const view=require('../ui-model').summarize('whales',d);assert.equal(view.badge,'BUILDING VERIFIED HOLDER SNAPSHOT');assert.ok(view.fields.every(f=>f.text==='NOT VERIFIED'&&f.dataState!=='DATA_FOUND'));}finally{[worker.advance,index.explorer,index.advance,gp.holders]=old;}
}));
test('failed queue and failed providers do not claim that indexing was queued',()=>fixture(async()=>{
 const gp=require('../lib/goplus'),old=[storage.enqueue,worker.advance,index.explorer,index.advance,gp.holders];storage.enqueue=async()=>false;worker.advance=index.explorer=index.advance=gp.holders=async()=>({value:null,status:'NOT_VERIFIED',dataState:'SOURCE_API_FAILED',reasonCode:'UPSTREAM_HTTP_ERROR',httpStatus:429});
 try{const d=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(d.coverage?.refreshQueued,undefined);assert.equal(d.dataState,'SOURCE_API_FAILED');assert.ok(d.attempts.every(x=>x.httpStatus===429));assert.notEqual(require('../ui-model').summarize('whales',d).badge,'BUILDING VERIFIED HOLDER SNAPSHOT');}finally{[storage.enqueue,worker.advance,index.explorer,index.advance,gp.holders]=old;}
}));
test('invalidated historical evidence remains absent while its queued rebuild retains building status',()=>fixture(async()=>{
 const old=worker.advance;worker.advance=async()=>({value:null,status:'NOT_VERIFIED',reasonCode:'HOLDER_SNAPSHOT_ANCHOR_CHANGED'});
 try{const d=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(d.reasonCode,'HOLDER_SNAPSHOT_ANCHOR_CHANGED');assert.equal(d.holderCount,null);assert.equal(d.coverage.refreshQueued,true);assert.equal(require('../ui-model').summarize('whales',d).badge,'BUILDING VERIFIED HOLDER SNAPSHOT');}finally{worker.advance=old;}
}));
test('a newly completed durable snapshot bypasses an already pending API refresh',()=>fixture(async()=>{
 let finish;const pending=fields.cached('holders:'+a,60000,()=>new Promise(resolve=>{finish=resolve;}));await new Promise(resolve=>setImmediate(resolve));await storage.save(name,state());
 try{const value=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(value.holderCount,2);assert.equal(value.snapshot.freshness,'LAST_VERIFIED');}finally{finish({holderCount:null});await pending;}
}));
test('simultaneous same-token requests share one cold discovery/reconciliation job',()=>fixture(async({calls})=>{
 const results=await Promise.all(Array.from({length:8},()=>worker.advance(a,{maxPages:2,maxBatches:1})));assert.equal(calls.context,1);assert.deepEqual(calls.pages,[0,2]);for(const r of results)assert.equal(r.value.block,'0xb');
}));
test('corrupt refresh checkpoints recover from the independently retained completed index instead of genesis',()=>fixture(async({folder,calls})=>{
 await storage.save(name,state('0xa',700000));const file=path.join(folder,name+'.v2.json'),d=JSON.parse(await fs.readFile(file));d.checkpoint.balanceCursor=999;await fs.writeFile(file,JSON.stringify(d));assert.equal((await storage.load(name)).phase,'COMPLETE');const r=await worker.advance(a,{maxPages:0,maxBatches:0});assert.equal(r.value.block,'0xa');assert.deepEqual(calls.pages,[]);
}));
test('malformed checkpoint or forged completed statistics never replace a valid COMPLETE snapshot',()=>fixture(async()=>{
 await storage.save(name,state());const corrupt=state();corrupt.result.largestWalletPct=99;await assert.rejects(storage.save(name,corrupt),{code:'CORRUPTED_HOLDER_CHECKPOINT'});assert.equal((await storage.snapshot(name)).largestWalletPct,60);assert.equal(storage.validCheckpoint({...state(),balances:[null]},a),false);await assert.rejects(storage.save(name,state('0x9')),{code:'HOLDER_SNAPSHOT_BLOCK_REGRESSED'});
}));
test('a changed canonical anchor invalidates completed evidence instead of serving stale metrics',()=>fixture(async()=>{
 await storage.save(name,state());c.rpc=async method=>method==='eth_chainId'?'0x13b2':({hash:'0x'+'b'.repeat(64)});const r=await worker.advance(a);assert.equal(r.value,null);assert.equal(r.reasonCode,'HOLDER_SNAPSHOT_ANCHOR_CHANGED');assert.equal(await storage.snapshot(name),null);
}));
test('configured storage outage fails closed without rebuilding history, while API fallback remains isolated',()=>fixture(async()=>{
 process.env.ARC_INDEX_REDIS_URL='https://storage.invalid';process.env.ARC_INDEX_REDIS_TOKEN='unit-test-only';c.json=async()=>{throw Object.assign(Error(),{httpStatus:503});};await assert.rejects(worker.advance(a),{code:'STORAGE_UNAVAILABLE'});
 const gp=require('../lib/goplus'),old=[index.explorer,index.advance,gp.holders];index.explorer=index.advance=gp.holders=async()=>({value:null,status:'NOT_VERIFIED',dataState:'SOURCE_API_FAILED'});try{const d=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(d.holderCount,null);assert.equal(d.top10Pct,null);assert.equal(d.ok,true);}finally{[index.explorer,index.advance,gp.holders]=old;}
}));
test('Redis protocol uses non-expiring documents and token-fenced atomic commits; an expired owner cannot publish',()=>fixture(async()=>{
 process.env.ARC_INDEX_REDIS_URL='https://storage.invalid';process.env.ARC_INDEX_REDIS_TOKEN='unit-test-only';const map=new Map(),commands=[];c.json=async(_u,o)=>{const args=JSON.parse(o.body);commands.push(args);const [cmd,...v]=args;if(cmd==='GET')return {result:map.get(v[0])??null};if(cmd==='SET'){if(v.includes('NX')&&map.has(v[0]))return {result:null};map.set(v[0],v[1]);return {result:'OK'};}if(cmd==='EVAL'){const n=v[1],keys=v.slice(2,2+n),argv=v.slice(2+n);if(map.get(keys[0])!==argv[0])return {result:0};if(n===2){map.set(keys[1],argv[1]);return {result:1};}map.delete(keys[0]);return {result:1};}throw Error('Unexpected command');};
 await storage.save(name,state());await storage.save(name,{version:1,address:a,chainId:5042,phase:'CATCHUP',startedAt:Date.now(),offset:0,addresses:[x,y,...c.BURNS],balances:[],balanceCursor:0,block:'0xa',anchor,total:'1000',catchupStart:1,catchupCursor:5});assert.equal((await storage.load(name)).catchupCursor,5);assert.equal((await storage.snapshot(name)).holderCount,2);assert.ok(commands.some(args=>args[0]==='EVAL'&&args[2]===2));assert.ok(!commands.some(args=>args.includes('EX')));
 await storage.withLease(name,async()=>{const lock=[...map.keys()].find(k=>k.endsWith(':lease'));map.delete(lock);await storage.withLease(name,()=>storage.save(name,state('0xb')));await assert.rejects(storage.save(name,{...state(),phase:'READ'}),{code:'HOLDER_LEASE_LOST'});});assert.equal((await storage.snapshot(name)).block,'0xb');
 const enqueue=storage.enqueue;storage.enqueue=async()=>true;try{delete require.cache[require.resolve('../lib/holder-display')];const displayed=await require('../lib/holder-display').cached(a);assert.equal(displayed.block,'0xb');assert.equal(displayed.snapshot.freshness,'LAST_VERIFIED');assert.ok(commands.some(args=>args[0]==='GET'&&args[1]==='holders:v2:5042:'+name));}finally{storage.enqueue=enqueue;}
}));
test('durable refresh queue resumes due work and worker endpoint requires configured authentication',()=>fixture(async()=>{
 await storage.enqueue(a);assert.deepEqual(await storage.due(),[a]);await storage.enqueue(a,Date.now()+600000,true);assert.deepEqual(await storage.due(),[]);const old=process.env.CRON_SECRET;delete process.env.CRON_SECRET;try{const r=await require('../api/holderrefresh')({method:'GET',headers:{}},{setHeader(){},status(n){this.code=n;return this;},json(d){return {code:this.code,data:d};}});assert.equal(r.code,503);}finally{if(old!==undefined)process.env.CRON_SECRET=old;}
}));
test('adaptive Transfer ranges handle provider limits and reject removed/conflicting duplicates before checkpointing',()=>fixture(async()=>{
 const ranges=require('../lib/holder-log-range'),log={address:a,blockNumber:'0xa',blockHash:anchor,logIndex:'0x1',topics:[index.TRANSFER,word(x),word(y)],data:word(1)};assert.deepEqual(ranges.candidates([log,log],a,10,10),[x,y]);assert.throws(()=>ranges.candidates([log,{...log,data:word(2)}],a,10,10),{code:'CONFLICTING_TRANSFER_LOG'});assert.throws(()=>ranges.candidates([{...log,removed:true}],a,10,10),{code:'INVALID_TRANSFER_LOG'});let calls=0;c.rpc=async(_m,p)=>{calls++;if(BigInt(p[0].toBlock)-BigInt(p[0].fromBlock)>1n)throw Object.assign(Error(),{code:'RPC_RANGE_LIMIT'});return [];};const r=await ranges.read(a,10,25,16);assert.equal(r.to,11);assert.equal(calls,4);
}));
test('worker authentication rejects wrong credentials and permits an authorized bounded job',()=>fixture(async()=>{
 const refresh=require('../lib/holder-refresh'),oldRun=refresh.run,oldSecret=process.env.CRON_SECRET;process.env.CRON_SECRET='unit-test-worker';let calls=0;refresh.run=async()=>{calls++;return [];};const invoke=authorization=>require('../api/holderrefresh')({method:'GET',headers:{authorization}},{setHeader(){},status(code){this.code=code;return this;},json(data){return {code:this.code,data};}});try{assert.equal((await invoke('Bearer wrong')).code,401);assert.equal(calls,0);assert.equal((await invoke('Bearer unit-test-worker')).code,200);assert.equal(calls,1);}finally{refresh.run=oldRun;if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;}
}));
test('legacy COMPLETE state migrates into non-expiring version-two storage before being reused',()=>fixture(async({folder})=>{
 await fs.writeFile(path.join(folder,name+'.json'),JSON.stringify(state()));assert.equal((await storage.snapshot(name)).holderCount,2);const d=JSON.parse(await fs.readFile(path.join(folder,name+'.v2.json')));assert.equal(d.schemaVersion,2);assert.equal(d.completedSnapshot.holderCount,2);assert.equal(d.lastSuccessfulReconciliationBlock,'0xa');
}));
test('corrupt unpinned balances and mixed-block field evidence cannot be published',()=>fixture(async()=>{
 const s=state();assert.equal(storage.validCheckpoint({...s,phase:'READ',block:null},a),false);assert.equal(storage.validCheckpoint({...s,phase:'TAIL',tailRange:0},a),false);const mixed=structuredClone(s);mixed.result.fields.top20Pct.evidence=[{block:'0x9',anchor}];assert.equal(storage.validSnapshot(mixed.result,a),false);await assert.rejects(storage.save(name,mixed),{code:'CORRUPTED_HOLDER_CHECKPOINT'});assert.equal(await storage.snapshot(name),null);
}));


test('indexer-to-pin catchup checkpoints the entire interval and resumes after provider failure',()=>fixture(async({calls})=>{
 const json=c.json,rpc=c.rpc;c.json=async url=>url.endsWith('/stats')?{chainId:5042,latestIndexedBlock:1,indexedBlocks:999}:json(url);
 let r=await worker.advance(a,{maxPages:2,maxBatches:0});assert.equal(r.coverage.phase,'READ');assert.equal(calls.logs[0].fromBlock,'0x1');
 // Start another cold token state with a deliberately bounded catchup window.
 await storage.save(name,{version:1,address:a,chainId:5042,phase:'CATCHUP',startedAt:Date.now(),offset:0,addresses:[x,y,...c.BURNS],balances:[],balanceCursor:0,block:'0xb',anchor,total:'1000',catchupStart:1,catchupCursor:5});
 c.rpc=async(m,p)=>m==='eth_getLogs'?Promise.reject(Object.assign(Error(),{httpStatus:429})):rpc(m,p);
 await assert.rejects(worker.advance(a),{httpStatus:429});assert.equal((await storage.load(name)).catchupCursor,5);assert.equal((await storage.load(name)).block,'0xb');
 c.rpc=rpc;r=await worker.advance(a,{maxPages:1,maxBatches:1});assert.equal(calls.logs.at(-1).fromBlock,'0x5');assert.equal(r.value.block,'0xb');assert.equal(r.value.holderCount,2);assert.equal(r.value.evidence[0].transferTail.fromBlock,1);
}));

test('failed reconciliation retains candidate union across a new pagination pass',()=>fixture(async()=>{
 let pass=0;c.json=async url=>url.endsWith('/stats')?{chainId:5042,latestIndexedBlock:11}:!url.includes('holders?')?{address:a}:{items:[{address:pass===0?x:y}],nextOffset:null};
 let r=await worker.advance(a,{maxPages:1,maxBatches:1});assert.equal(r.value,null);assert.equal(r.reasonCode,'HOLDER_SUPPLY_RECONCILIATION_FAILED');let stored=await storage.load(name);assert.equal(stored.phase,'DISCOVER');assert.ok(stored.addresses.includes(x));assert.equal(stored.lastReconciliationFailure.reconciledSupplyRaw,'600');assert.equal(await storage.snapshot(name),null);
 pass=1;r=await worker.advance(a,{maxPages:1,maxBatches:1});assert.equal(r.value.holderCount,2);assert.equal(r.value.top10Pct,100);assert.ok((await storage.load(name)).addresses.includes(x));
}));

test('failed refresh reconciliation preserves the previous atomic COMPLETE snapshot',()=>fixture(async()=>{
 const original=state('0xa',700000);await storage.save(name,original);reader.balances=async(_a,addresses)=>({method:'test pinned',values:addresses.map(v=>word(v===x?550:v===y?400:0))});
 const r=await worker.advance(a,{maxPages:1,maxBatches:1});assert.equal(r.value.block,'0xa');assert.equal(r.value.snapshot.freshness,'STALE');assert.equal(r.value.snapshot.refresh.reasonCode,'HOLDER_SUPPLY_RECONCILIATION_FAILED');assert.equal((await storage.snapshot(name)).top20Pct,100);assert.equal((await storage.load(name)).phase,'DISCOVER');
}));

test('cold source failure still queues the contract for durable worker retry',()=>fixture(async()=>{
 c.json=async()=>{throw Object.assign(Error(),{httpStatus:429});};const gp=require('../lib/goplus'),old=[index.explorer,index.advance,gp.holders];index.explorer=index.advance=gp.holders=async()=>({value:null,status:'NOT_VERIFIED',dataState:'SOURCE_API_FAILED'});
 try{const r=await require('../api/holders')({method:'GET',query:{address:a}},{setHeader(){},status(){return this},json(d){return d;}});assert.equal(r.holderCount,null);assert.deepEqual(await storage.due(),[a]);}finally{[index.explorer,index.advance,gp.holders]=old;}
}));

test('catchup never clips a lagging index to the last 5000 blocks and survives a separate execution',()=>fixture(async({folder,calls})=>{
 const json=c.json;c.json=async url=>url.endsWith('/stats')?{chainId:5042,latestIndexedBlock:1,indexedBlocks:9999}:url.includes('holders?')?{items:[{address:x},{address:y}],nextOffset:null}:json(url);c.context=async()=>({block:'0x2710'});
 const first=await worker.advance(a,{maxPages:1,maxBatches:0});assert.equal(first.coverage.phase,'CATCHUP');assert.equal(calls.logs[0].fromBlock,'0x1');const s=await storage.load(name);assert.equal(s.catchupCursor,1001);assert.equal(s.block,'0x2710');assert.equal(s.balanceCursor,0);
 const output=execFileSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve(__dirname,'../lib/holder-storage'))}).load(${JSON.stringify(name)}).then(s=>console.log(JSON.stringify(s)));`],{env:{...process.env,ARC_INDEX_CACHE_DIR:folder},windowsHide:true,encoding:'utf8'});assert.equal(JSON.parse(output).catchupCursor,1001);
 await worker.advance(a,{maxPages:1,maxBatches:0});assert.equal(calls.logs.at(-1).fromBlock,'0x3e9');assert.equal((await storage.load(name)).catchupCursor,2001);assert.equal(await storage.snapshot(name),null);
}));

test('authenticated scheduled runs continue a queued checkpoint and atomically replace an older COMPLETE snapshot',()=>fixture(async({folder,calls})=>{
 const refresh=require('../lib/holder-refresh'),advance=worker.advance,previousSecret=process.env.CRON_SECRET;process.env.CRON_SECRET='unit-test-scheduled-worker';let pass=0;
 worker.advance=(a,options)=>advance(a,{...options,maxPages:1,maxBatches:pass<2?0:1});
 const invoke=()=>require('../api/holderrefresh')({method:'GET',headers:{authorization:'Bearer unit-test-scheduled-worker','user-agent':'vercel-cron/1.0'}},{setHeader(){},status(code){this.code=code;return this;},json(data){return {code:this.code,data};}});
 try{
  await storage.enqueue(a);let r=await invoke();assert.equal(r.code,200);assert.equal(r.data.results[0].state,'BUILDING');assert.equal((await storage.load(name)).offset,2);assert.equal(await storage.snapshot(name),null);
  const output=execFileSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve(__dirname,'../lib/holder-storage'))}).load(${JSON.stringify(name)}).then(s=>console.log(JSON.stringify(s)));`],{env:{...process.env,ARC_INDEX_CACHE_DIR:folder},windowsHide:true,encoding:'utf8'});assert.equal(JSON.parse(output).offset,2);
  // Make the persisted queue member due, representing the next cron day without sleeping.
  await storage.enqueue(a,Date.now()-1,true);pass=1;r=await invoke();assert.equal((await storage.load(name)).phase,'READ');assert.equal((await storage.load(name)).block,'0xb');assert.equal(await storage.snapshot(name),null);
  await storage.enqueue(a,Date.now()-1,true);pass=2;r=await invoke();assert.equal(r.data.results[0].state,'COMPLETE');assert.equal((await storage.snapshot(name)).holderCount,2);assert.deepEqual(calls.pages,[0,2]);
  const old=state('0xa',700000);const file=path.join(folder,name+'.v2.json');const d=JSON.parse(await fs.readFile(file));d.checkpoint=old;d.completedSnapshot=old.result;d.completedIndex={block:old.block,totalSupplyRaw:old.total,candidateAddresses:old.addresses,balances:old.balances};await fs.writeFile(file,JSON.stringify(d));await storage.enqueue(a,Date.now()-1,true);
  r=await invoke();assert.equal(r.data.results[0].state,'COMPLETE');const snapshot=await storage.snapshot(name);assert.equal(snapshot.block,'0xb');assert.equal(snapshot.holderCount,2);for(const field of Object.values(snapshot.fields))assert.ok(field.evidence.some(e=>e.block===snapshot.block));
 }finally{worker.advance=advance;if(previousSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previousSecret;}
}));

test('worker deadline cannot publish a late balance result and retains the last COMPLETE snapshot',()=>fixture(async()=>{
 const budget=require('../lib/holder-budget'),original=state('0xa',700000);await storage.save(name,original);
 reader.balances=async(_a,addresses)=>{await new Promise(resolve=>setTimeout(resolve,80));return {method:'late public read',values:addresses.map(v=>word(v===x?600:v===y?400:0))};};
 await assert.rejects(budget.run(15,()=>budget.operation(()=>worker.advance(a))),{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});
 await new Promise(resolve=>setTimeout(resolve,120));assert.equal((await storage.snapshot(name)).block,'0xa');assert.notEqual((await storage.load(name)).phase,'COMPLETE');assert.equal((await storage.load(name)).balanceCursor,0);
}));
