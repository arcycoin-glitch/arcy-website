const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const refresh=require('../lib/holder-refresh'),storage=require('../lib/holder-storage'),worker=require('../lib/holder-candidates'),budget=require('../lib/holder-budget');
const address=n=>'0x'+n.toString(16).padStart(40,'0');

test('Vercel leaves holder processing to the persistent worker and preserves Pulse cron and function limit',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json')));assert.ok(!config.crons.some(c=>c.path==='/api/holderrefresh'));assert.deepEqual(config.crons.find(c=>c.path==='/api/pulse'),{path:'/api/pulse',schedule:'0 6 * * 1'});assert.ok(fs.readdirSync(path.join(__dirname,'../api')).filter(f=>f.endsWith('.js')).length<=12);
});

test('scheduled queue processes multiple batches and rotates unfinished jobs behind untouched work',async()=>{
 const original=[storage.due,storage.enqueue,worker.advance],jobs=new Map(Array.from({length:6},(_,i)=>[address(i+1),Date.now()-1000])),queued=[];
 storage.due=async limit=>[...jobs].filter(([,at])=>at<=Date.now()).sort((a,b)=>a[1]-b[1]).slice(0,limit).map(([a])=>a);
 storage.enqueue=async(a,at)=>{queued.push({a,at});jobs.set(a,at);return true;};worker.advance=async(a,options)=>{assert.ok(options.budgetMs<=12000);return a===address(1)?{value:null,reasonCode:'HOLDER_PINNED_RECONCILIATION_IN_PROGRESS'}:{value:{block:'0xa',snapshot:{freshness:'FRESH'}}};};
 try{const start=Date.now(),r=await refresh.run();assert.equal(r.length,6);assert.equal(r[0].state,'BUILDING');assert.ok(r.slice(1).every(x=>x.state==='COMPLETE'));assert.ok(queued[0].at>=start+60000);assert.ok(queued[1].at>=start+600000);assert.deepEqual(await storage.due(5),[]);}finally{[storage.due,storage.enqueue,worker.advance]=original;}
});

test('scheduled work has one shared invocation budget and yields a slow job without false completion',async()=>{
 const original=[worker.advance,storage.enqueue];worker.advance=()=>new Promise(()=>{});let queued=false;storage.enqueue=async()=>{queued=true;};
 try{const start=Date.now(),r=await refresh.run({addresses:[address(1),address(2)],budgetMs:2200});assert.ok(Date.now()-start<1000);assert.equal(r.length,1);assert.equal(r[0].state,'BUILDING');assert.equal(r[0].reasonCode,'HOLDER_WORKER_BUDGET_EXHAUSTED');assert.ok(queued);}finally{[worker.advance,storage.enqueue]=original;}
});

test('request-local worker deadline does not cancel an ordinary concurrent scan',async()=>{
 const read=()=>new Promise(resolve=>setTimeout(()=>resolve('public onchain data'),60));const limited=budget.run(10,()=>budget.operation(read));const ordinary=budget.operation(read);await assert.rejects(limited,{code:'HOLDER_WORKER_BUDGET_EXHAUSTED'});assert.equal(await ordinary,'public onchain data');assert.equal(budget.remaining(),Infinity);
});

test('persistent batches continue incomplete work quickly but back off a failed stale refresh',async()=>{
 const previous=[worker.advance,storage.enqueue],queued=[];storage.enqueue=async(a,at)=>{queued.push(at);return true;};
 try{worker.advance=async()=>({value:null,reasonCode:'HOLDER_PINNED_RECONCILIATION_IN_PROGRESS'});let start=Date.now();await refresh.run({addresses:[address(1)],incompleteDelayMs:5000});assert.ok(queued[0]>=start+5000&&queued[0]<start+10000);
 worker.advance=async()=>({value:{block:'0xa',snapshot:{freshness:'STALE',refresh:{state:'FAILED',httpStatus:429}}}});start=Date.now();const r=await refresh.run({addresses:[address(1)],incompleteDelayMs:5000});assert.equal(r[0].state,'STALE');assert.equal(r[0].httpStatus,429);assert.ok(queued[1]>=start+60000);
 }finally{[worker.advance,storage.enqueue]=previous;}
});
