'use strict';
// #337 Phase 1: Ethereum (chain 1) full Transfer-ledger census building blocks. Adversarial cases for the creation start block.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../lib/holder-creation'),chains=require('../lib/holder-chains');
const A='0x56072c95faa701256059aa122697b133aded9279',TX='0x'+'ab'.repeat(32);
const meta=(o={})=>({hash:'0x56072C95FAA701256059aa122697B133aDEd9279',creation_transaction_hash:TX,...o});
const rcpt=(o={})=>({transactionHash:TX,status:'0x1',contractAddress:A,blockNumber:'0x1395c8b',...o});
const run=(m,r)=>C.creationBlock(A,{chainId:1,getJson:async()=>m,rpc:async(method,p)=>{assert.equal(method,'eth_getTransactionReceipt');assert.equal(p[0],TX);return r;}});
test('creation block = receipt block of a direct deployment confirmed on the chain RPC',async()=>{
 const x=await run(meta(),rcpt());assert.equal(x.block,0x1395c8b);assert.equal(x.transactionHash,TX);assert.match(x.method,/contractAddress == token/);
});
test('explorer data alone is never trusted: every mismatch fails closed with a stable code',async()=>{
 const cases=[[meta({hash:'0x'+'1'.repeat(40)}),rcpt(),'CREATION_EXPLORER_IDENTITY_MISMATCH'],[meta({creation_transaction_hash:null}),rcpt(),'CREATION_TRANSACTION_UNKNOWN'],
  [meta(),null,'CREATION_RECEIPT_UNAVAILABLE'],[meta(),rcpt({transactionHash:'0x'+'cd'.repeat(32)}),'CREATION_RECEIPT_UNAVAILABLE'],[meta(),rcpt({status:'0x0'}),'CREATION_RECEIPT_FAILED'],
  [meta(),rcpt({contractAddress:null}),'CREATION_NOT_DIRECT_DEPLOYMENT'],[meta(),rcpt({contractAddress:'0x'+'2'.repeat(40)}),'CREATION_NOT_DIRECT_DEPLOYMENT'],[meta(),rcpt({blockNumber:'0x'}),'CREATION_BLOCK_INVALID']];
 for(const [m,r,code] of cases)await assert.rejects(()=>run(m,r),e=>{assert.equal(e.code,code);return true;});
 await assert.rejects(()=>C.creationBlock(A,{chainId:4663,getJson:async()=>meta(),rpc:async()=>rcpt()}),{code:'CREATION_LOOKUP_UNSUPPORTED_CHAIN'});
 await assert.rejects(()=>C.creationBlock('bad',{chainId:1,getJson:async()=>meta(),rpc:async()=>rcpt()}),{code:'CREATION_ADDRESS_INVALID'});
 await assert.rejects(()=>C.creationBlock(A,{chainId:1,getJson:async()=>{throw Error('down');},rpc:async()=>rcpt()}),{code:'CREATION_EXPLORER_UNAVAILABLE'});
});
test('Ethereum chain config matches the measured public-RPC limits and keeps existing chains untouched',()=>{
 const e=chains.get(1).ledger;
 assert.equal(chains.get(1).id,'ethereum');assert.equal(e.maxRange,1999,'flashbots: block range greater than 2000 max');assert.equal(e.grow,false);
 assert.equal(e.positiveOnly,true);assert.equal(e.startFromCreation,true);assert(e.confirmations>=64);
 assert.equal(chains.get(5042).ledger.startFromCreation,undefined);assert.equal(chains.get(4663).ledger.startFromCreation,undefined);
 assert.deepEqual(chains.enabledChains({}),[5042],'production default stays Arc-only until ARC_HOLDER_CHAINS is changed by release');
});

test('receipt-free fallback: plain CREATE whose rlp([from, nonce]) address equals the token, with current code',async()=>{
 const from='0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0',tok='0xfffd933a0bc612844eaf0c6fe3e5b8e9b6c1d19c';
 const m={hash:tok,creation_transaction_hash:TX};
 const txo=(o={})=>({hash:TX,blockNumber:'0x10',from,nonce:'0x3',to:null,...o});
 const go=(t,code='0x6001')=>C.creationBlock(tok,{chainId:1,getJson:async()=>m,rpc:async(method)=>method==='eth_getTransactionReceipt'?null:method==='eth_getTransactionByHash'?t:code});
 const ok=await go(txo());assert.equal(ok.block,16);assert.match(ok.method,/rlp\(\[from, nonce\]\)/);
 await assert.rejects(()=>go(txo({nonce:'0x2'})),{code:'CREATION_NOT_DIRECT_DEPLOYMENT'});
 await assert.rejects(()=>go(txo({to:'0x'+'9'.repeat(40)})),{code:'CREATION_NOT_DIRECT_DEPLOYMENT'},'factory/CREATE2 fails closed');
 await assert.rejects(()=>go(txo(),'0x'),{code:'CREATION_CODE_ABSENT'});
 await assert.rejects(()=>go(null),{code:'CREATION_RECEIPT_UNAVAILABLE'});
 await assert.rejects(()=>go(txo({blockNumber:null})),{code:'CREATION_RECEIPT_UNAVAILABLE'},'pending tx is not a creation proof');
 await assert.rejects(()=>go(txo({hash:'0x'+'cd'.repeat(32)})),{code:'CREATION_RECEIPT_UNAVAILABLE'});
 await assert.rejects(()=>go(txo({from:'0x12'})),{code:'CREATION_TRANSACTION_INVALID'});
 assert.equal(C.createAddress(from,0n),'0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d');
});
