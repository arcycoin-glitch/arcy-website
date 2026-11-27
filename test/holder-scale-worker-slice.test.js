'use strict';
// #330/#335: end-to-end worker.slice behaviour with the storage/index/publication modules replaced in-process.
// Proves the queue cadence actually written, that an over-budget census never publishes (last-known-good untouched),
// and that one over-budget contract does not starve a healthy control in the same slice.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const lib=p=>path.join(__dirname,'..','lib',p);
const BIG='0x39dbed3a2bd333467115de45665cc57f813c4571',CTRL='0x1111111111111111111111111111111111111111',ERR='0x2222222222222222222222222222222222222222',BUSY='0x3333333333333333333333333333333333333333';
function stub(file,exports){const id=lib(file);require.cache[id]={id,filename:id,loaded:true,exports};}
const T=1_800_000_000_000;
function setup(results){
 const enq=[],pub=[];
 stub('holder-storage.js',{due:async()=>Object.keys(results),enqueue:async(a,at)=>{enq.push([a,at-T]);return true;}});
 stub('holder-index.js',{advance:async a=>{const r=results[a];if(r instanceof Error)throw r;return r;}});
 stub('holder-publication.js',{publish:async(a,v)=>{pub.push([a,v]);}});
 return {enq,pub};
}
const fakeRpc={rpc:async()=>{throw Error('no network in unit test');},metrics:{calls:0}};
const over={value:null,status:'NOT_VERIFIED',reasonCode:'BALANCE_RECONCILIATION_BUDGET_EXCEEDED',
 coverage:{complete:false,toBlock:9,targetBlock:9,historicalWallets:100001,positiveLedgerAddresses:100001,walletBudget:100000,budgetPopulation:'POSITIVE_LEDGER'}};
const ok={status:'ONCHAIN_VERIFIED',value:{block:'0x9',holderCount:42,top10Pct:50,fields:{}}};

test('over-budget contract: 60-minute recheck, NOT_VERIFIED, unreconciled diagnostics only, nothing published',async()=>{
 process.env.ARC_HOLDER_PUBLISHED_DIR='/nonexistent-test-only';
 const {enq,pub}=setup({[BIG]:over,[CTRL]:ok,[ERR]:Object.assign(Error('x'),{code:'RPC_CALL_FAILED'}),[BUSY]:{value:null,status:'NOT_VERIFIED',reasonCode:'TRANSFER_BACKFILL_IN_PROGRESS',coverage:{toBlock:5,targetBlock:9}}});
 delete require.cache[lib('holder-chain-worker.js')];const worker=require(lib('holder-chain-worker.js'));
 const out=await worker.slice(4663,{limit:4,rpc:fakeRpc,now:()=>T});
 const by=Object.fromEntries(out.map(o=>[o.contract,o]));
 assert.equal(by[BIG].state,'NOT_VERIFIED');assert.equal(by[BIG].reasonCode,'BALANCE_RECONCILIATION_BUDGET_EXCEEDED');
 assert.equal(by[BIG].holderCount,undefined,'no holder count is ever emitted for an over-budget census');
 assert.equal(by[BIG].positiveLedgerAddresses,100001);assert.equal(by[BIG].retainedLedgerAddresses,100001);assert.equal(by[BIG].retryAfterMs,3600000);
 assert.equal(by[CTRL].state,'COMPLETE','healthy control in the same slice is still processed');
 assert.equal(by[ERR].state,'FAILED');assert.equal(by[BUSY].state,'BUILDING');
 assert.deepEqual(Object.fromEntries(enq),{[BIG]:3600000,[CTRL]:600000,[ERR]:60000,[BUSY]:1000});
 assert.deepEqual(pub.map(x=>x[0]),[CTRL],'only the reconciled control is published; the last-known-good snapshot of BIG is not overwritten');
 delete process.env.ARC_HOLDER_PUBLISHED_DIR;
});

test('repeat-rate: over a 3-hour window the over-budget contract is re-attempted at most 4 times (was 181 at 60s)',()=>{
 const worker=require(lib('holder-chain-worker.js'));const windowMs=3*3600000;
 assert.equal(Math.floor(windowMs/worker.retryDelay('BALANCE_RECONCILIATION_BUDGET_EXCEEDED'))+1,4);
 assert.equal(Math.floor(windowMs/worker.retryDelay('HOLDER_RPC_UNAVAILABLE'))+1,181);
});
