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

// On Robinhood, the positive-only ledger deletes zero-balance entries after
// every range. Its size cannot be represented as lifetime unique holders.
test('scale diagnostic distinguishes retained ledger entries from historical wallets',()=>{
 const d=worker.scaleDiagnostics({positiveLedgerAddresses:100001,historicalWallets:100001,
  budgetPopulation:'POSITIVE_LEDGER',walletBudget:100000},100000,worker.SCALE_RETRY_MS);
 assert.deepEqual(d,{positiveLedgerAddresses:100001,retainedLedgerAddresses:100001,
  walletBudget:100000,budgetPopulation:'POSITIVE_LEDGER',retryAfterMs:3600000});
 assert.equal(Object.hasOwn(d,'historicalLedgerAddresses'),false,
  'positive-only compaction cannot establish all historical participants');
 const unknown=worker.scaleDiagnostics(undefined,100000,worker.SCALE_RETRY_MS);
 assert.equal(unknown.positiveLedgerAddresses,null);
 assert.equal(unknown.retainedLedgerAddresses,null);
 assert.equal(unknown.walletBudget,100000);
});

test('bounded census stops at COMPLETE or deterministic budget breach, but keeps waiting on transient states',()=>{
 const p=worker.censusPending;
 assert.equal(p([{state:'COMPLETE'},{state:'NOT_VERIFIED',reasonCode:'BALANCE_RECONCILIATION_BUDGET_EXCEEDED'}]),false,'PONS-like breach must not burn the whole budget');
 assert.equal(p([{state:'COMPLETE'},{state:'BUILDING',reasonCode:'TRANSFER_BACKFILL_IN_PROGRESS'}]),true);
 assert.equal(p([{state:'NOT_VERIFIED',reasonCode:'HOLDER_RPC_UNAVAILABLE'}]),true,'transient failures are retried within budget');
 assert.equal(p([{state:'FAILED',reasonCode:'RPC_CALL_FAILED'}]),true);
 assert.equal(p([{}]),true,'a contract with no result yet is still pending');
 assert.equal(p([]),false);
});
