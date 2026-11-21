'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const seeds=require('../lib/holder-chain-seeds');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40);
test('default Arc-only worker never seeds 4663 even if addresses are configured',async()=>{
 let calls=0;
 const result=await seeds.enqueue({env:{ARC_HOLDER_CHAINS:'5042',ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES:A},submit:async()=>{calls++;return [true]}});
 assert.equal(calls,0);assert.deepEqual(result,[]);
});
test('4663 seed list is validated, de-duplicated and chain-scoped',async()=>{
 const calls=[],events=[];
 const env={ARC_HOLDER_CHAINS:'5042,4663',ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES:A+','+B.toUpperCase().replace('0X','0x')+','+A};
 const result=await seeds.enqueue({env,submit:async(id,addresses)=>{calls.push({id,addresses});return addresses.map(()=>true);},emit:entry=>events.push(entry)});
 assert.deepEqual(calls,[{id:4663,addresses:[A,B]}]);
 assert.deepEqual(result,[{chainId:4663,state:'QUEUED',count:2}]);
 assert.deepEqual(events,result);
 assert.deepEqual(seeds.parse(5042,env),[]);
});
test('seeding fails closed on malformed addresses, quota breaches and queue rejection',async()=>{
 const env={ARC_HOLDER_CHAINS:'5042,4663',ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES:'0xnot-an-address'};
 assert.throws(()=>seeds.parse(4663,env),{code:'HOLDER_CHAIN_SEED_INVALID_ADDRESS'});
 env.ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES=Array.from({length:41},(_,i)=>'0x'+i.toString(16).padStart(40,'0')).join(',');
 assert.throws(()=>seeds.parse(4663,env),{code:'HOLDER_CHAIN_SEED_LIMIT'});
 env.ARC_HOLDER_CHAIN_4663_SEED_ADDRESSES=A;
 await assert.rejects(()=>seeds.enqueue({env,submit:async()=>[false]}),{code:'HOLDER_CHAIN_SEED_QUEUE_REJECTED'});
});
