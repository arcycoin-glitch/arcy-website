'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const w=require('../lib/holder-chain-worker');
test('wallet budget: default 100000 unchanged; only a bounded explicit operator value raises it',()=>{
 assert.equal(w.walletBudget({}),100000);assert.equal(w.walletBudget({ARC_HOLDER_MAX_WALLETS:''}),100000);
 assert.equal(w.walletBudget({ARC_HOLDER_MAX_WALLETS:'150000'}),150000);assert.equal(w.walletBudget({ARC_HOLDER_MAX_WALLETS:'250000'}),250000);
 for(const bad of ['250001','99999','0','-1','1e6','150000.5',' 150000','abc','100000000'])assert.equal(w.walletBudget({ARC_HOLDER_MAX_WALLETS:bad}),100000,bad);
});
test('research cap can never be combined with publication',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const r=spawnSync(process.execPath,[path.join(__dirname,'../scripts/holder-chain-census.cjs')],{env:{...process.env,ARC_HOLDER_STORAGE:'local',ARC_INDEX_CACHE_DIR:'/tmp/x-337',ARC_HOLDER_PUBLISHED_DIR:'/tmp/y-337',CENSUS_MAX_WALLETS_RESEARCH:'200000'},encoding:'utf8',timeout:20000});
 assert.notEqual(r.status,0);assert.match(r.stderr,/measurement-only/);
});
test('slice uses the operator budget for the over-cap check, and #330 backoff/terminal semantics still apply below it',async()=>{
 const path=require('node:path'),lib=p=>path.join(__dirname,'..','lib',p),seen=[];
 const stub=(f,e)=>{const id=lib(f);require.cache[id]={id,filename:id,loaded:true,exports:e};};
 stub('holder-storage.js',{due:async()=>['0x39dbed3a2bd333467115de45665cc57f813c4571'],enqueue:async()=>true});
 stub('holder-index.js',{advance:async(a,o)=>{seen.push(o.maxWallets);return {status:'NOT_VERIFIED',reasonCode:'BALANCE_RECONCILIATION_BUDGET_EXCEEDED',coverage:{}};}});
 stub('holder-publication.js',{publish:async()=>{throw Error('must not publish');}});
 delete require.cache[lib('holder-chain-worker.js')];const worker=require(lib('holder-chain-worker.js'));
 const rpc={rpc:async()=>{throw Error('no network');},metrics:{}};
 const saved=process.env.ARC_HOLDER_MAX_WALLETS;
 try{process.env.ARC_HOLDER_MAX_WALLETS='150000';const out=await worker.slice(4663,{rpc});
  delete process.env.ARC_HOLDER_MAX_WALLETS;await worker.slice(4663,{rpc});
  assert.deepEqual(seen,[150000,100000]);assert.equal(out[0].retryAfterMs,3600000);assert.equal(out[0].walletBudget,150000);
 }finally{if(saved===undefined)delete process.env.ARC_HOLDER_MAX_WALLETS;else process.env.ARC_HOLDER_MAX_WALLETS=saved;}
});
