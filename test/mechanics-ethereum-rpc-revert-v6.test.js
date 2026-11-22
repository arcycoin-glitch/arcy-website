'use strict';
// Ethereum read-only RPC errors must carry enough execution evidence for the
// Mechanics differential proxy proof. An opaque provider failure is not a revert.
const test=require('node:test');
const assert=require('node:assert/strict');

test('Ethereum RPC distinguishes explicit EVM revert from provider failure without a new call',async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 let issue={code:-32000,message:'execution reverted'};
 let calls=0;
 globalThis.fetch=async(_url,opts)=>{
  calls++;
  const q=JSON.parse(opts.body);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:issue}),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
 const {rpc}=require('../search/server/lib/eth');
 const tx={to:'0x0000000000000000000000000000000000000001',data:'0x'};
 const read=()=>rpc('eth_call',[tx,'0x123']);
 await assert.rejects(read(),error=>error.code==='GETTER_REVERTED'&&error.rpcCode===-32000);
 issue={code:3,message:'execution reverted: unauthorized'};
 await assert.rejects(read(),error=>error.code==='GETTER_REVERTED'&&error.rpcCode===3);
 issue={code:-32000,message:'upstream internal error'};
 await assert.rejects(read(),error=>error.code==='RPC_METHOD_FAILED'&&error.rpcCode===-32000);
 issue={code:-32603,message:'request failed'};
 await assert.rejects(read(),error=>error.code==='RPC_METHOD_FAILED'&&error.rpcCode===-32603);
 assert.equal(calls,4);
});
