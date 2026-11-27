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
