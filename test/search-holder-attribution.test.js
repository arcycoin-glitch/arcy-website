'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {classify}=require('../search/server/lib/holder-attribution');
const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40);
test('unknown whale stays unknown despite concentration',()=>{
 assert.equal(classify({network:'ethereum',chainId:1,address:a,sharePct:89}).role,'UNKNOWN');
});
test('zero and dead are custody, not verified issuer burns',()=>{
 for(const address of ['0x'+'0'.repeat(40),'0x'+'0'.repeat(36)+'dead']){
  const result=classify({network:'ethereum',chainId:1,address});
  assert.equal(result.role,'BURN_ADDRESS'); assert.match(result.scope,/NOT proof/);
 }
});
test('reject wrong network, wrong contract and unreviewed evidence',()=>{
 const proof={chainId:1,address:a,role:'VESTING',sourceType:'ISSUER_OFFICIAL',sourceUrl:'https://example.org/vesting',reviewed:true};
 assert.equal(classify({network:'arc',chainId:1,address:a,proof}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:b,proof}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:{...proof,reviewed:false}}).role,'UNKNOWN');
});
test('reject ticker-only, insecure URLs, forged burn claims',()=>{
 const p={chainId:1,address:a,role:'EXCHANGE_CUSTODY',sourceType:'VERIFIED_REGISTRY',sourceUrl:'http://example.org',reviewed:true};
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:p}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:{...p,sourceUrl:'https://example.org',role:'BURN_ADDRESS'}}).role,'UNKNOWN');
});
test('reviewed exact evidence yields role but not owner identity',()=>{
 const proof={chainId:1,address:a,role:'VESTING',sourceType:'ISSUER_OFFICIAL',sourceUrl:'https://example.org/vesting',reviewed:true};
 const result=classify({network:'ethereum',chainId:1,address:a,proof});
 assert.equal(result.role,'VESTING');assert.equal(result.verified,true);
 assert.match(result.scope,/does not establish ultimate beneficial ownership/);
});

test('pinned candidate ranking includes addresses, but withholds ownership labels',()=>{
 const {evaluate,TOP_SIZE}=require('../search/server/lib/large-holders');
 const rows=Array.from({length:TOP_SIZE},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),balance:BigInt(100-i)}));
 const page={ok:true,rows};
 const balances=rows.map(r=>r.balance);
 const result=evaluate(page,balances,10000n,'0x1','0x'+'f'.repeat(40),500);
 assert.equal(result.ok,true);
 assert.equal(result.holderCandidates.length,20);
 assert.equal(result.holderCandidates[0].rank,1);
 assert.equal(result.holderCandidates[0].role,'UNKNOWN');
 assert.match(result.holderCandidates[0].scope,/not proof of global rank/);
 assert.equal(result.holderCandidates[19].address,rows[19].address);
});
test('invalid pinned balances never yield published candidate roles',()=>{
 const {evaluate,TOP_SIZE}=require('../search/server/lib/large-holders');
 const rows=Array.from({length:TOP_SIZE},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),balance:1n}));
 const result=evaluate({ok:true,rows},rows.map(()=>0n),100n,'0x1','0x'+'f'.repeat(40),500);
 assert.equal(result.ok,false);
 assert.equal(result.holderCandidates,undefined);
});

test('report formatter forwards only block-matched Ethereum candidate metadata',()=>{
 const {formatCard}=require('../search/server/lib/data-engine');
 const cfg={id:'ethereum',chainId:1};
 const proof=[{block:'0x123',method:'balanceOf',address:'0x'+'a'.repeat(40)}];
 const value=n=>({dataState:'DATA_FOUND',value:n,status:'SOURCE_REPORTED_RPC_RECONCILED',
   source:'Blockscout candidate addresses + Ethereum RPC',evidence:proof,chainId:1,network:'ethereum'});
 const fields={holderCount:value(500),largestWalletPct:value(10),top10Pct:value(30),top20Pct:value(60)};
 const row={address:'0x'+'a'.repeat(40),rank:1,sharePct:10,role:'UNKNOWN',block:'0x123'};
 const good=formatCard('holders',{fields,holderCandidates:[row]},cfg);
 assert.equal(good.holderCandidates?.[0]?.address,row.address);
 const wrongBlock=formatCard('holders',{fields,holderCandidates:[{...row,block:'0x124'}]},cfg);
 assert.equal(wrongBlock.holderCandidates,undefined);
 const wrongChain=formatCard('holders',{fields,holderCandidates:[row]},{id:'arc',chainId:5042});
 assert.equal(wrongChain.holderCandidates,undefined);
 const impersonation=formatCard('holders',{fields,holderCandidates:[{...row,role:'ISSUER_TREASURY'}]},cfg);
 assert.equal(impersonation.holderCandidates,undefined);
});
