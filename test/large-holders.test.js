'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const holders=require('../search/server/lib/large-holders');

const token='0x'+'f'.repeat(40);
const rows=Array.from({length:21},(_,i)=>({
 address:{hash:'0x'+(i+1).toString(16).padStart(40,'0')},
 value:String(210-i)
}));

test('stale Blockscout balances are replaced by locally ranked pinned RPC candidate balances',()=>{
 const page=holders.parsePage({items:rows},token);
 assert.equal(page.ok,true);
 // The source values are 210..190, while the pinned balances are in the
 // reverse address order. Published percentages must use RPC balances only.
 const balances=Array.from({length:21},(_,i)=>BigInt(80+i));
 const result=holders.evaluate(page,balances,100000n,'0x1234',token,1000);
 assert.equal(result.ok,true);
 assert.equal(result.fields.largestWalletPct.value,0.1);
 assert.equal(result.fields.top10Pct.value,0.955);
 assert.equal(result.fields.top20Pct.value,1.81);
 const proof=result.fields.top20Pct.evidence[0];
 assert.equal(proof.block,'0x1234');
 assert.equal(proof.rpcBalancesUsedForPublishedMetrics,true);
 assert.match(proof.limitation,/candidate membership and holder count are explorer-reported/i);
 assert.doesNotMatch(proof.method,/Blockscout.*values/i);
});

test('ranked holder metrics fail closed for zero, malformed or supply-exceeding pinned balances',()=>{
 const page=holders.parsePage({items:rows},token);
 const zero=Array(21).fill(1n);zero[4]=0n;
 assert.equal(holders.evaluate(page,zero,100000n,'0x1234',token,1000).reasonCode,
  'INVALID_PINNED_CANDIDATE_BALANCE');
 const tooLarge=Array(21).fill(1n);tooLarge[0]=100001n;
 assert.equal(holders.evaluate(page,tooLarge,100000n,'0x1234',token,1000).reasonCode,
  'INVALID_PINNED_CANDIDATE_BALANCE');
 assert.equal(holders.evaluate(page,[1n],100000n,'0x1234',token,1000).reasonCode,
  'MISSING_PINNED_RANK_EVIDENCE');
});

