'use strict';
// Incremental COMPLETE refresh (2026-11-05). Production evidence: ARGUS (26,562 candidates) and FAZE (14,385) re-read every
// candidate balance on every 10-minute refresh while the Arc RPC answered 429s, which turned COMPLETE into STALE and starved
// first-time BUILDING scans. These tests pin the bounded fix: re-read only tail-touched/new/burn candidates, carry the rest
// exactly from the previous verified COMPLETE index, keep exact totalSupply reconciliation, and fall back to a full re-read
// at the same pinned block (never a rediscovery) whenever the carry cannot be proven.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const storage=require('../lib/holder-storage'),worker=require('../lib/holder-candidates'),index=require('../lib/holder-index'),reader=require('../lib/balance-reader'),c=require('../lib/core'),fields=require('../lib/fields'),health=require('../lib/search-health');
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const a='0x'+'e'.repeat(40),name=a+'-candidates',anchor='0x'+'b'.repeat(64);
const addr=i=>'0x'+(i+1).toString(16).padStart(40,'0');
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
const topic=x=>'0x'+x.slice(2).padStart(64,'0');
const HOLDERS=Array.from({length:60},(_,i)=>addr(i)); // 60 holders x 100 = 6000 supply
function previous({ageMs=700000,fullReadAgeMs=700000,pinned='0xa'}={}){
 const at=Date.now()-ageMs,addresses=[...HOLDERS,...c.BURNS],balances=addresses.map(x=>[x,c.BURNS.includes(x)?'0':'100']);
 const result={...index.aggregate(balances,6000n,[{source:'test pinned RPC',block:pinned,anchor,totalSupplyRaw:'6000'}]),block:pinned,snapshot:{block:pinned,completedAt:new Date(at).toISOString(),maxCacheAgeSeconds:600}};
 const s={version:1,address:a,chainId:5042,phase:'COMPLETE',startedAt:at,completedAt:at,block:pinned,anchor,total:'6000',addresses,balances,balanceCursor:addresses.length,result};
 if(fullReadAgeMs!==null)s.lastFullReadAt=Date.now()-fullReadAgeMs;
 return s;
}
// Chain model at the new pinned block 0xc: HOLDERS[0] sent 30 to a brand-new wallet NEW in block 0xb (one Transfer log).
const NEW='0x'+'f'.repeat(40);
async function fixture(fn,{chain}={}){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-incremental-test-'));
 const keys=['ARC_INDEX_CACHE_DIR','ARC_INDEX_REDIS_URL','ARC_INDEX_REDIS_TOKEN','ARC_HOLDER_STORAGE','ARC_HOLDER_INCREMENTAL_REFRESH','ARC_HOLDER_FULL_REREAD_MS','ARC_HOLDER_MAX_SNAPSHOT_AGE_SECONDS'];
 const env=Object.fromEntries(keys.map(k=>[k,process.env[k]])),old=[c.context,c.call,c.rpc,c.json,reader.balances];
 process.env.ARC_INDEX_CACHE_DIR=folder;process.env.ARC_HOLDER_STORAGE='local';delete process.env.ARC_INDEX_REDIS_URL;delete process.env.ARC_INDEX_REDIS_TOKEN;
 for(const k of ['ARC_HOLDER_INCREMENTAL_REFRESH','ARC_HOLDER_FULL_REREAD_MS','ARC_HOLDER_MAX_SNAPSHOT_AGE_SECONDS'])delete process.env[k];fields.clearCache();
 const state=chain||{total:6000n,balances:new Map([...HOLDERS.map(x=>[x,100n]),[NEW,0n]])};
 if(!chain){state.balances.set(HOLDERS[0],70n);state.balances.set(NEW,30n);}
 const calls={read:[],logs:0,json:0};
 c.context=async()=>({block:'0xc'});
 c.call=async(_t,data)=>{assert.equal(data,'0x18160ddd');return word(state.total);};
 c.rpc=async(method,params)=>{
  if(method==='eth_chainId')return '0x13b2';
  if(method==='eth_getBlockByNumber')return {hash:anchor};
  if(method==='eth_getLogs'){calls.logs++;const from=BigInt(params[0].fromBlock),to=BigInt(params[0].toBlock);
   return 0xbn>=from&&0xbn<=to?[{address:a,topics:[TRANSFER,topic(HOLDERS[0]),topic(NEW)],data:word(30),blockHash:anchor,logIndex:'0x0',blockNumber:'0xb',removed:false}]:[];}
  throw Error('Unexpected RPC '+method);
 };
 c.json=async()=>{calls.json++;throw Object.assign(Error('explorer must not be used by a refresh'),{httpStatus:522});};
 reader.balances=async(_t,addresses,pinned)=>{assert.equal(pinned,'0xc');calls.read.push(...addresses);return {method:'test pinned read',values:addresses.map(x=>word(state.balances.get(x)||0n))};};
 try{await fn({folder,calls,state});}
 finally{[c.context,c.call,c.rpc,c.json,reader.balances]=old;for(const k of keys)if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];fields.clearCache();
  const resolved=path.resolve(folder);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('arcy-incremental-test-'))await fs.rm(resolved,{recursive:true,force:true});}
}
async function untilComplete(limit=8){let r;for(let i=0;i<limit;i++){r=await worker.advance(a,{maxPages:20,maxBatches:20});const s=await storage.load(name);assert.notEqual(s.phase,'DISCOVER','a refresh never resets to DISCOVER');if(s.phase==='COMPLETE')return r;}throw Error('did not complete: '+JSON.stringify(r?.reasonCode));}
const expected=()=>index.aggregate([...HOLDERS.map(x=>[x,x===HOLDERS[0]?'70':'100']),[NEW,'30'],...c.BURNS.map(x=>[x,'0'])],6000n,[]);

test('incremental refresh re-reads only tail-touched, new and burn candidates and publishes exact metrics with carry evidence',()=>fixture(async({calls})=>{
 await storage.save(name,previous());
 const r=await untilComplete();
 const read=[...new Set(calls.read)].sort();
 assert.deepEqual(read,[HOLDERS[0],NEW,...c.BURNS].sort(),'only 4 of 63 candidates were read at the new pin');
 assert.equal(calls.json,0,'no explorer rediscovery');
 const snap=await storage.snapshot(name),want=expected();
 assert.equal(snap.block,'0xc');
 for(const k of ['holderCount','largestWalletPct','top10Pct','top20Pct'])assert.equal(snap[k],want[k],k);
 assert.equal(snap.holderCount,61);
 const ev=snap.evidence.find(e=>e.block==='0xc');
 assert.equal(ev.incrementalReconciliation.carriedFromBlock,'0xa');
 assert.equal(ev.incrementalReconciliation.rereadAtPinnedBlock,4);
 assert.equal(ev.incrementalReconciliation.carriedUnchanged,59);
 assert.match(snap.coverage.basis,/carried exactly/);
 assert.equal(r.value.block,'0xc');
 // the carry never extends the full-read clock: lastFullReadAt is unchanged by an incremental refresh
 const s=await storage.load(name);assert.ok(Date.now()-s.lastFullReadAt>=690000);
}));

test('a legacy COMPLETE (no full-read timestamp) refreshes with a FULL re-read and then records lastFullReadAt',()=>fixture(async({calls})=>{
 await storage.save(name,previous({fullReadAgeMs:null}));
 await untilComplete();
 assert.equal(new Set(calls.read).size,63,'every candidate re-read');
 const s=await storage.load(name);assert.ok(Number.isFinite(s.lastFullReadAt)&&Date.now()-s.lastFullReadAt<60000);
 assert.equal((await storage.snapshot(name)).evidence.find(e=>e.block==='0xc').incrementalReconciliation,undefined);
}));

test('a full re-read is forced once the last full read is older than ARC_HOLDER_FULL_REREAD_MS',()=>fixture(async({calls})=>{
 process.env.ARC_HOLDER_FULL_REREAD_MS=String(3600000);
 await storage.save(name,previous({fullReadAgeMs:2*3600000}));
 await untilComplete();
 assert.equal(new Set(calls.read).size,63);
}));

test('kill switch ARC_HOLDER_INCREMENTAL_REFRESH=off restores the previous full re-read behaviour',()=>fixture(async({calls})=>{
 process.env.ARC_HOLDER_INCREMENTAL_REFRESH='off';
 await storage.save(name,previous());
 await untilComplete();
 assert.equal(new Set(calls.read).size,63);
}));

test('a carry that does not reconcile (balance changed without a Transfer) falls back to a FULL re-read at the same pin, never DISCOVER, and publishes correct values',()=>{
 // Non-standard token: an untouched holder gained 5 without any Transfer log, and totalSupply grew by 5.
 const chain={total:6005n,balances:new Map([...HOLDERS.map(x=>[x,100n]),[NEW,30n]])};chain.balances.set(HOLDERS[0],70n);chain.balances.set(HOLDERS[5],105n);
 return fixture(async({calls})=>{
  const events=[];const record=health.record;health.record=(e,d)=>{events.push(e);return record(e,d);};
  try{
   await storage.save(name,previous());
   const before=(await storage.snapshot(name)).block;assert.equal(before,'0xa');
   const r=await untilComplete();
   assert.ok(events.includes('HOLDER_INCREMENTAL_RECONCILIATION_FALLBACK'));
   assert.equal(new Set(calls.read).size,63,'fallback re-read every candidate');
   const snap=await storage.snapshot(name);assert.equal(snap.block,'0xc');
   const want=index.aggregate([...HOLDERS.map(x=>[x,String(chain.balances.get(x))]),[NEW,'30'],...c.BURNS.map(x=>[x,'0'])],6005n,[]);
   for(const k of ['holderCount','largestWalletPct','top10Pct','top20Pct'])assert.equal(snap[k],want[k],k);
   assert.equal(snap.evidence.find(e=>e.block==='0xc').incrementalReconciliation,undefined,'published evidence is a full read');
   assert.equal(r.value.block,'0xc');
  }finally{health.record=record;}
 },{chain});
});

test('while an incremental refresh is in progress the previous COMPLETE is served as STALE and never replaced by partial data',()=>fixture(async()=>{
 await storage.save(name,previous());
 const r=await worker.advance(a,{maxPages:20,maxBatches:0}); // TAIL done, READ not started
 assert.equal(r.value.block,'0xa');assert.equal(r.value.snapshot.freshness,'STALE');
 const s=await storage.load(name);assert.equal(s.phase,'READ');assert.equal(s.incremental.reread,4);assert.equal(s.incremental.carried,59);
 assert.equal((await storage.snapshot(name)).block,'0xa','previous verified COMPLETE retained');
}));

test('restart recovery: a fresh process loads the persisted incremental checkpoint, and resuming completes without re-reading carried balances',()=>fixture(async({folder,calls})=>{
 await storage.save(name,previous());
 await worker.advance(a,{maxPages:20,maxBatches:0});
 const out=execFileSync(process.execPath,['-e',`require(${JSON.stringify(path.resolve(__dirname,'../lib/holder-storage'))}).load(${JSON.stringify(name)}).then(s=>console.log(JSON.stringify({phase:s.phase,incremental:s.incremental,cursor:s.balanceCursor})))`],{env:{...process.env,ARC_INDEX_CACHE_DIR:folder,ARC_HOLDER_STORAGE:'local'},encoding:'utf8',windowsHide:true});
 const persisted=JSON.parse(out);assert.equal(persisted.phase,'READ');assert.equal(persisted.incremental.reread,4);assert.equal(persisted.cursor,0);
 await untilComplete();assert.equal(new Set(calls.read).size,4);
}));

test('checkpoint validation rejects malformed incremental state; completedBalances only serves the exact verified block',()=>fixture(async()=>{
 const s=previous();await storage.save(name,s);
 const base={...s,phase:'READ',result:undefined,completedAt:undefined,block:'0xc',balances:[],balanceCursor:0};delete base.result;delete base.completedAt;
 assert.equal(storage.validCheckpoint({...base,incremental:{fromBlock:'0xa',reread:4,carried:59}},a),true);
 assert.equal(storage.validCheckpoint({...base,incremental:{fromBlock:'zz',reread:4}},a),false);
 assert.equal(storage.validCheckpoint({...base,incremental:{fromBlock:'0xa',reread:999}},a),false);
 assert.equal(storage.validCheckpoint({...base,incremental:{fromBlock:'0xa',touched:['0xnot']}},a),false);
 assert.equal(storage.validCheckpoint({...base,incremental:null},a),false);
 assert.equal(storage.validCheckpoint({...base,lastFullReadAt:Date.now()+600000},a),false);
 const m=await storage.completedBalances(name,'0xa');assert.equal(m.size,62);assert.equal(m.get(HOLDERS[3]),'100');
 assert.equal(await storage.completedBalances(name,'0xb'),null);
}));

test('ARGUS-scale refresh (26,562 candidates, production 2026-11-05): balance eth_calls per refresh drop from 133 to 1',async()=>{
 const N=26562,many=Array.from({length:N},(_,i)=>'0x'+(i+0x1000).toString(16).padStart(40,'0'));
 const count=async mode=>{
  const chain={total:BigInt(N)*100n,balances:new Map([...many.map(x=>[x,100n]),[NEW,0n]])};chain.balances.set(many[0],70n);chain.balances.set(NEW,30n);
  let invocations=0;
  await fixture(async()=>{
   if(mode==='off')process.env.ARC_HOLDER_INCREMENTAL_REFRESH='off';
   const at=Date.now()-700000,addresses=[...many.slice(0),...c.BURNS],balances=addresses.map(x=>[x,c.BURNS.includes(x)?'0':'100']);
   const result={...index.aggregate(balances,BigInt(N)*100n,[{source:'t',block:'0xa',anchor,totalSupplyRaw:String(BigInt(N)*100n)}]),block:'0xa',snapshot:{block:'0xa',completedAt:new Date(at).toISOString(),maxCacheAgeSeconds:600}};
   await storage.save(name,{version:1,address:a,chainId:5042,phase:'COMPLETE',startedAt:at,completedAt:at,block:'0xa',anchor,total:String(BigInt(N)*100n),addresses,balances,balanceCursor:addresses.length,result,lastFullReadAt:at});
   const inner=reader.balances;reader.balances=async(...args)=>{invocations++;return inner(...args);};
   // the fixture's log stub emits HOLDERS[0] -> NEW; re-point it at this population's first holder
   const rpc=c.rpc;c.rpc=async(m,p)=>{const r=await rpc(m,p);if(m==='eth_getLogs'&&r.length)r[0].topics[1]=topic(many[0]);return r;};
   let done=false;for(let i=0;i<40&&!done;i++){await worker.advance(a,{maxPages:20,maxBatches:200});done=(await storage.load(name)).phase==='COMPLETE';}
   assert.ok(done);assert.equal((await storage.snapshot(name)).holderCount,N+1);
  },{chain});
  return invocations;
 };
 assert.equal(await count('off'),Math.ceil((N+3)/200),'full re-read: one 200-address multicall per batch');
 assert.equal(await count('on'),1,'incremental: one multicall for the 4 touched/new/burn candidates');
});

// Generic multi-cycle chain model: random Transfers in successive blocks; every refresh pins the next block.
async function chainFixture(fn){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'arcy-incremental-test-'));
 const keys=['ARC_INDEX_CACHE_DIR','ARC_INDEX_REDIS_URL','ARC_INDEX_REDIS_TOKEN','ARC_HOLDER_STORAGE','ARC_HOLDER_INCREMENTAL_REFRESH','ARC_HOLDER_FULL_REREAD_MS'];
 const env=Object.fromEntries(keys.map(k=>[k,process.env[k]])),old=[c.context,c.call,c.rpc,c.json,reader.balances];
 process.env.ARC_INDEX_CACHE_DIR=folder;process.env.ARC_HOLDER_STORAGE='local';delete process.env.ARC_INDEX_REDIS_URL;delete process.env.ARC_INDEX_REDIS_TOKEN;delete process.env.ARC_HOLDER_INCREMENTAL_REFRESH;delete process.env.ARC_HOLDER_FULL_REREAD_MS;fields.clearCache();
 const chain={head:10,logs:[],history:new Map([[10,new Map(HOLDERS.map(x=>[x,100n]))]]),total:6000n,reads:[]};
 chain.at=b=>{let best=0;for(const k of chain.history.keys())if(k<=b&&k>best)best=k;return chain.history.get(best);};
 c.context=async()=>({block:'0x'+chain.head.toString(16)});
 c.call=async()=>word(chain.total);
 c.rpc=async(method,params)=>{if(method==='eth_chainId')return '0x13b2';if(method==='eth_getBlockByNumber')return {hash:anchor};
  if(method==='eth_getLogs'){const from=Number(BigInt(params[0].fromBlock)),to=Number(BigInt(params[0].toBlock));return chain.logs.filter(l=>l.n>=from&&l.n<=to).map(l=>l.log);}
  throw Error('Unexpected RPC '+method);};
 c.json=async()=>{throw Object.assign(Error('no explorer'),{httpStatus:522});};
 reader.balances=async(_t,addresses,pinned)=>{const m=chain.at(Number(BigInt(pinned)));chain.reads.push(...addresses);return {method:'test',values:addresses.map(x=>word(m.get(x)||0n))};};
 // Apply n random transfers in block `b` (one log each) and advance head to b+1.
 chain.step=(rng,n)=>{const b=chain.head+1,m=new Map(chain.at(chain.head));const pool=[...m.keys(),'0x'+(0xabc000+b).toString(16).padStart(40,'0')];
  for(let i=0;i<n;i++){const from=pool[Math.floor(rng()*pool.length)],to=pool[Math.floor(rng()*pool.length)],bal=m.get(from)||0n;if(bal===0n||from===to)continue;const amt=1n+BigInt(Math.floor(rng()*Number(bal)));m.set(from,bal-amt);m.set(to,(m.get(to)||0n)+amt);
   chain.logs.push({n:b,log:{address:a,topics:[TRANSFER,topic(from),topic(to)],data:word(amt),blockHash:anchor,logIndex:'0x'+i.toString(16),blockNumber:'0x'+b.toString(16),removed:false}});}
  chain.history.set(b,m);chain.head=b+1;chain.history.set(chain.head,m);};
 try{await fn(chain);}
 finally{[c.context,c.call,c.rpc,c.json,reader.balances]=old;for(const k of keys)if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];fields.clearCache();
  const resolved=path.resolve(folder);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('arcy-incremental-test-'))await fs.rm(resolved,{recursive:true,force:true});}
}
const truth=(chain,b)=>index.aggregate([...chain.at(b)].filter(([x])=>!c.BURNS.includes(x)).map(([x,v])=>[x,v.toString()]).concat(c.BURNS.map(x=>[x,'0'])),chain.total,[]);
async function refreshToComplete(){for(let i=0;i<10;i++){await worker.advance(a,{maxPages:50,maxBatches:50});const s=await storage.load(name);assert.notEqual(s.phase,'DISCOVER');if(s.phase==='COMPLETE')return s;}throw Error('refresh did not complete');}
async function age(ms){const file=path.join(process.env.ARC_INDEX_CACHE_DIR,name+'.v2.json'),d=JSON.parse(await fs.readFile(file,'utf8'));const shift=x=>x-ms;
 const s=d.checkpoint;s.completedAt=shift(s.completedAt);s.startedAt=shift(s.startedAt);if(s.lastFullReadAt)s.lastFullReadAt=Math.min(Date.now(),s.lastFullReadAt);const iso=new Date(s.completedAt).toISOString();s.result.snapshot.completedAt=iso;d.completedSnapshot.snapshot.completedAt=iso;await fs.writeFile(file,JSON.stringify(d));}

test('property: across 12 refresh cycles of random Transfers, every incremental COMPLETE equals the exact full-state truth',()=>chainFixture(async chain=>{
 let seed=20261105;const rng=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
 const prev=previous({pinned:'0xa'});prev.lastFullReadAt=Date.now()-60000;await storage.save(name,prev);await age(700000);
 let incrementalCycles=0;
 for(let cycle=0;cycle<12;cycle++){
  chain.step(rng,1+Math.floor(rng()*8));chain.reads.length=0;
  await refreshToComplete();
  const snap=await storage.snapshot(name),want=truth(chain,chain.head);
  for(const k of ['holderCount','largestWalletPct','top10Pct','top20Pct'])assert.equal(snap[k],want[k],'cycle '+cycle+' '+k);
  const s=await storage.load(name);
  for(const [x,v] of s.balances)assert.equal(v,String(chain.at(chain.head).get(x)||0n),'cycle '+cycle+' balance '+x);
  if(snap.evidence.find(e=>e.block===snap.block).incrementalReconciliation){incrementalCycles++;assert.ok(new Set(chain.reads).size<s.addresses.length,'incremental read fewer candidates');}
  assert.equal(s.incremental,undefined,'COMPLETE checkpoint carries no stale incremental marker');
  await age(700000);
 }
 assert.ok(incrementalCycles>=10,'incremental path exercised: '+incrementalCycles);
}));

test('rollback/roll-forward gap: a TAIL range advanced by older code without touched-address records forces a full re-read',()=>chainFixture(async chain=>{
 const prev=previous({pinned:'0xa'});prev.lastFullReadAt=Date.now()-60000;await storage.save(name,prev);await age(700000);
 let seed=7;const rng=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
 // Sum-preserving transfers between EXISTING holders only: a wrong carry would still reconcile to totalSupply,
 // so only the touched-range bookkeeping (not the supply check) can catch an unrecorded range.
 const b=chain.head+1,m=new Map(chain.at(chain.head));m.set(HOLDERS[1],60n);m.set(HOLDERS[2],140n);
 chain.logs.push({n:b,log:{address:a,topics:[TRANSFER,topic(HOLDERS[1]),topic(HOLDERS[2])],data:word(40),blockHash:anchor,logIndex:'0x0',blockNumber:'0x'+b.toString(16),removed:false}});
 chain.history.set(b,m);chain.head=b+1;chain.history.set(chain.head,m);void rng;
 await worker.advance(a,{maxPages:0,maxBatches:0}); // COMPLETE -> TAIL, pin set, no ranges yet
 // simulate an older worker version scanning the whole tail: cursor/addresses advance, touched records do not
 const file=path.join(process.env.ARC_INDEX_CACHE_DIR,name+'.v2.json'),d=JSON.parse(await fs.readFile(file,'utf8')),s=d.checkpoint;
 assert.equal(s.phase,'TAIL');assert.ok(s.incremental);const head=Number(BigInt(s.block));
 const touched=new Set();for(const l of chain.logs)if(l.n<=head){touched.add('0x'+l.log.topics[1].slice(26));touched.add('0x'+l.log.topics[2].slice(26));}
 s.addresses=[...new Set([...s.addresses,...touched])];s.tailCursor=head+1;await fs.writeFile(file,JSON.stringify(d));
 chain.reads.length=0;await refreshToComplete();
 const snap=await storage.snapshot(name);assert.equal(snap.evidence.find(e=>e.block===snap.block).incrementalReconciliation,undefined,'no carry across an unrecorded range');
 assert.equal(new Set(chain.reads).size,snap.evidence.find(e=>e.block===snap.block).balanceOfReads,'every candidate re-read');
 const want=truth(chain,head);for(const k of ['holderCount','largestWalletPct','top10Pct','top20Pct'])assert.equal(snap[k],want[k],k);
}));

test('rollback compatibility: a READ checkpoint whose cursor passed the incremental re-read prefix (older code doing a full read) completes as a full read',()=>chainFixture(async chain=>{
 const prev=previous({pinned:'0xa'});prev.lastFullReadAt=Date.now()-60000;await storage.save(name,prev);await age(700000);
 let seed=11;const rng=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;chain.step(rng,5);
 await worker.advance(a,{maxPages:50,maxBatches:0});
 const file=path.join(process.env.ARC_INDEX_CACHE_DIR,name+'.v2.json'),d=JSON.parse(await fs.readFile(file,'utf8')),s=d.checkpoint;
 assert.equal(s.phase,'READ');const k=s.incremental.reread+3,m=chain.at(Number(BigInt(s.block)));
 s.balances=s.addresses.slice(0,k).map(x=>[x,String(m.get(x)||0n)]);s.balanceCursor=k;await fs.writeFile(file,JSON.stringify(d));
 await refreshToComplete();
 const snap=await storage.snapshot(name),want=truth(chain,Number(BigInt(snap.block)));
 for(const key of ['holderCount','largestWalletPct','top10Pct','top20Pct'])assert.equal(snap[key],want[key],key);
 assert.equal(snap.evidence.find(e=>e.block===snap.block).incrementalReconciliation,undefined);
}));
