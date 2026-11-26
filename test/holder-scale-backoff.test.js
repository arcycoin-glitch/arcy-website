'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const index=require('../lib/holder-index');
const worker=require('../lib/holder-chain-worker');

test('Robinhood positive-only ledger bound uses positive addresses, not historical zeroed addresses',()=>{
 const bound=index.reconciliationOverBudget;
 assert.equal(bound(100000,150000,100000,true),false,'exactly 100k positive addresses is in budget');
 assert.equal(bound(100001,100001,100000,true),true,'the 100001st positive entry exceeds the cap');
 assert.equal(bound(80000,150000,100000,true),false,'zeroed historical wallets do not create a false cap breach');
 assert.equal(bound(80000,150000,100000,false),true,'other chains may use full historical ledger budget');
 assert.equal(bound(100000,100000,100000,false),false);
});

test('deterministic scale exhaustion backs off without changing transient recovery cadence',()=>{
 assert.equal(worker.SCALE_RETRY_MS,60*60*1000);
 assert.equal(worker.retryDelay('BALANCE_RECONCILIATION_BUDGET_EXCEEDED'),worker.SCALE_RETRY_MS);
 assert.equal(worker.retryDelay('TRANSFER_BACKFILL_IN_PROGRESS'),1000);
 assert.equal(worker.retryDelay('HOLDER_RPC_UNAVAILABLE'),60*1000);
 assert.equal(worker.retryDelay(null),60*1000);
 assert.equal(worker.REFRESH_MS,10*60*1000,'healthy publication refresh cadence must be unchanged');
});
