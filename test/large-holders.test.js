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

test('ranked candidates reject an explicit wrong chain or token identity',()=>{
 assert.equal(holders.parsePage({items:rows,token_address:'0x'+'e'.repeat(40)},token).reasonCode,'RANK_SOURCE_IDENTITY_MISMATCH');
 assert.equal(holders.parsePage({items:rows,chain_id:4663},token).reasonCode,'RANK_SOURCE_IDENTITY_MISMATCH');
 assert.equal(holders.parsePage({items:rows,token:{address_hash:token},chain_id:1},token).ok,true);
});
test('warm candidate reads coalesce while each analysis still reconciles its own pinned block',async()=>{
 const a='0x'+'a'.repeat(40);let fetches=0;const fetcher=async()=>{fetches++;await new Promise(r=>setTimeout(r,5));return new Response(JSON.stringify({items:rows}),{headers:{'content-type':'application/json'}})};
 await Promise.all([holders.fetchPage(a,{fetcher}),holders.fetchPage(a,{fetcher})]);assert.equal(fetches,1);
 await holders.fetchPage(a,{fetcher});assert.equal(fetches,1);
 const blocks=[];for(const block of ['0x10','0x11']){const result=await holders.inspect(a,block,'100000',1000,{getPage:()=>holders.fetchPage(a,{fetcher}),getBalances:async(t,r,b)=>{blocks.push(b);return r.map(()=>1n)}});assert.equal(result.fields.top20Pct.dataState,'DATA_FOUND');assert.equal(result.fields.top20Pct.evidence[0].block,block);assert.equal(result.fields.top20Pct.status,'SOURCE_REPORTED_RPC_RECONCILED');}
 assert.deepEqual(blocks,['0x10','0x11']);assert.equal(fetches,1);
});
test('provider and RPC failures remain unknown with separate actionable evidence',async()=>{
 const a=await holders.inspect(token,'0x10','100000',1000,{getPage:async()=>{throw Object.assign(Error('credential must never appear'),{httpStatus:403})}});
 assert.equal(a.fields.top20Pct.value,null);assert.equal(a.fields.top20Pct.reasonCode,'HOLDER_CANDIDATE_SOURCE_HTTP_403');assert.doesNotMatch(JSON.stringify(a),/credential must never appear/);
 const b=await holders.inspect(token,'0x10','100000',1000,{getPage:async()=>({items:rows}),getBalances:async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'})}});
 assert.equal(b.fields.top20Pct.value,null);assert.equal(b.fields.top20Pct.reasonCode,'HOLDER_PINNED_RPC_TIMEOUT');
});

