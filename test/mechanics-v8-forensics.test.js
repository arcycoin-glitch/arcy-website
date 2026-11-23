'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describe,verifiedBurnReceipt,TRANSFER}=require('../search/server/lib/mechanics-v8-forensics');
const {recorder}=require('../search/server/lib/mechanics-v8-evidence');
const {collect}=require('../search/server/lib/mechanics-v8-history');
const {SLOTS,selector}=require('../search/server/lib/mechanics-deep');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),D='0x'+'d'.repeat(40);
const H='0x'+'1'.repeat(64),I='0x'+'2'.repeat(64),T='0x'+'3'.repeat(64);
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),block='0x10';
const stamp=recorder({chainId:1,network:'ethereum',address:A,block,provider:'test RPC'});
const taxSource='f'.repeat(64);

test('capability, current permissions, realized burns and buybacks are separate',()=>{
 const r=describe({profile:'FIXED_SUPPLY_OZ_BURNABLE',proof:{sourceDigest:taxSource},stamp,details:{}});
 assert.equal(r.burnCapability.value,true);
 for(const name of ['burnExecution','buybackExecution','buybackConfiguration','irrecoverableBalance'])assert.equal(r[name].verificationStatus,'UNKNOWN');
 const spx=describe({profile:'LAUNCH_TAX_DECAY_FIXED_SUPPLY',proof:{sourceDigest:taxSource},stamp,details:{}});
 assert.equal(spx.buybackConfiguration.value,false);
 assert.equal(spx.buybackExecution.verificationStatus,'UNKNOWN');
 assert.equal(spx.burnCapability.value,false);
});

test('direct reviewed burn with a canonical receipt reduces supply; transfers to dead or zero without reviewed burn do not prove it',()=>{
 const proof={address:A,implementation:A,block,profile:'FIXED_SUPPLY_OZ_BURNABLE',verificationStatus:'VERIFIED',sourceDigest:taxSource};
 const transaction={hash:T,blockNumber:block,blockHash:H,to:A,from:B,input:selector('burn(uint256)')+word(9).slice(2)};
 const log={address:A,blockHash:H,transactionHash:T,topics:[TRANSFER,word(B),word(0)],data:word(9),logIndex:'0x0'};
 const receipt={transactionHash:T,blockNumber:block,blockHash:H,from:B,to:A,status:'0x1',logs:[log]};
 const params={token:A,proof,transaction,receipt,canonicalHash:H,stamp};
 assert.equal(verifiedBurnReceipt(params).value,'9');
 for(const invalid of [
  {proof:{...proof,implementation:C}},{canonicalHash:I},{receipt:{...receipt,status:'0x0'}},
  {receipt:{...receipt,logs:[{...log,topics:[TRANSFER,word(B),word(0xdead)]}]}},
  {receipt:{...receipt,logs:[{...log,address:C}]}},{receipt:{...receipt,logs:[log,log]}},
  {transaction:{...transaction,input:selector('transfer(address,uint256)')+word(0).slice(2)+word(9).slice(2)}}
 ])assert.equal(verifiedBurnReceipt({...params,...invalid}),null);
});

const provider=(id,{current=C,changeHash=false,chain='0x1',failSlot=false,log=[]}={})=>{
 let reads=0;
 return {id,rpc:async(method,p)=>{
  log.push([method,p]);
  if(method==='eth_chainId')return chain;
  if(method==='eth_getBlockByNumber'){reads++;return {number:p[0],hash:changeHash&&reads%2===0?I:p[0]==='0x10'?H:I};}
  if(method==='eth_getStorageAt'){
   if(failSlot&&p[1]===SLOTS.implementation)throw Error('archive missing');
   return p[1]===SLOTS.implementation?word(p[2]==='0x10'?B:current):p[1]===SLOTS.beacon?word(D):word(0);
  }
  if(method==='eth_call'){assert.equal(p[0].from,A);assert.equal(p[0].to,D);return word(B);}
  throw Error('Unexpected read');
 }};
};
test('historical changes require matching requested blocks and reuse only matching checkpoint hashes',async()=>{
 const log=[],base={network:'ethereum',token:A,blocks:[block,'0x11'],providers:[provider('public.a',{log})]};
 const r=await collect(base);
 assert.deepEqual(r.changes.map(x=>[x.kind,x.from,x.to]),[['implementationSlot',B,C]]);
 assert.equal(r.observations[0].blockHash,H);
 const resumedLog=[],resumed=await collect({...base,providers:[provider('public.a',{log:resumedLog})],checkpoint:r.observations});
 assert(resumed.observations.every(x=>x.reusedCheckpoint));
 assert(resumedLog.every(([method])=>['eth_chainId','eth_getBlockByNumber'].includes(method)));
 const reorg=await collect({...base,providers:[provider('public.a',{changeHash:true})],checkpoint:r.observations});
 assert.equal(reorg.snapshots[0].verificationStatus,'CONFLICTED');
 assert.equal(reorg.changes.length,0);
});
test('conflicting providers are preserved; an unavailable provider cannot erase complete evidence',async()=>{
 const base={network:'ethereum',token:A,blocks:['0x11']};
 let r=await collect({...base,providers:[provider('public.a'),provider('public.b',{current:B})]});
 assert.equal(r.snapshots[0].verificationStatus,'CONFLICTED');
 assert.equal(r.observations.length,2);
 r=await collect({...base,providers:[provider('public.a'),provider('public.b',{failSlot:true})]});
 assert.equal(r.snapshots[0].verificationStatus,'OBSERVED');
 assert.equal(r.snapshots[0].value.implementationSlot,C);
 assert.equal(r.observations[1].verificationStatus,'PARTIALLY_VERIFIED');
});
