'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {quoteExactIn,reserveWords,addressWord,inspect}=require('../lib/liquidity-v2-reserves');
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),PAIR='0x'+'c'.repeat(40);
const word=x=>BigInt(x).toString(16).padStart(64,'0');
test('constant product quote uses integer arithmetic and requires an explicit reviewed fee',()=>{
 const r=quoteExactIn({amountIn:1000n,reserveIn:100000n,reserveOut:200000n,feeBps:30});
 assert.equal(r.amountOut,'1974');
 assert.equal(r.remainingReserveOut,'198026');
 assert.ok(r.spotPriceImpactBps>0);
 assert.throws(()=>quoteExactIn({amountIn:1000n,reserveIn:100000n,reserveOut:200000n}),/UNVERIFIED_OR_INVALID_FEE/);
 assert.throws(()=>quoteExactIn({amountIn:1n,reserveIn:1n,reserveOut:1n,feeBps:30}),/QUOTE_UNAVAILABLE/);
 assert.throws(()=>quoteExactIn({amountIn:0n,reserveIn:1n,reserveOut:1n,feeBps:30}),/INVALID_QUOTE_AMOUNT/);
});
test('ABI parsing rejects overflow and malformed values',()=>{
 assert.throws(()=>addressWord('0x'+'f'.repeat(64)),/INVALID_POOL_TOKEN_RESPONSE/);
 assert.throws(()=>reserveWords('0x'+word(1n<<112n)+word(3)+word(0)),/INVALID_RESERVE_RESPONSE/);
 assert.throws(()=>reserveWords('0x1234'),/INVALID_RESERVE_RESPONSE/);
});
function node({chainId='0x1',failMethod,token0=A,token1=B}={}){
 const calls=[];
 const fetcher=async(_url,init)=>{
  const q=JSON.parse(init.body);calls.push(q);
  if(q.method===failMethod)return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'rate limited'}}));
  let result;
  if(q.method==='eth_chainId')result=chainId;
  if(q.method==='eth_blockNumber')result='0x1234';
  if(q.method==='eth_getCode')result='0x60016000';
  if(q.method==='eth_call'){
   if(q.params[0].data==='0x0dfe1681')result='0x'+token0.slice(2).padStart(64,'0');
   if(q.params[0].data==='0xd21220a7')result='0x'+token1.slice(2).padStart(64,'0');
   if(q.params[0].data==='0x0902f1ac')result='0x'+word(100000)+word(200000)+word(15);
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 };
 return {calls,fetcher};
}
test('six bounded read-only calls pinned to one block return attributed quote',async()=>{
 const n=node();
 const r=await inspect({network:'ethereum',pair:PAIR,tokenIn:A,amountIn:'1000',feeBps:30,fetcher:n.fetcher});
 assert.equal(r.quote.amountOut,'1974');
 assert.equal(r.evidence.rpcCalls,6);
 assert.equal(r.evidence.verificationClass,'SINGLE_SOURCE_ONCHAIN');
 assert.ok(n.calls.every(c=>['eth_chainId','eth_blockNumber','eth_getCode','eth_call'].includes(c.method)));
 assert.ok(n.calls.filter(c=>c.method==='eth_call').every(c=>c.params[1]==='0x1234'));
});
test('wrong chain, foreign input token, missing fee and RPC failures are fail-closed',async()=>{
 const args={network:'ethereum',pair:PAIR,tokenIn:A,amountIn:'1000',feeBps:30};
 await assert.rejects(inspect({...args,fetcher:node({chainId:'0x13b2'}).fetcher}),/RPC chain ID mismatch/);
 await assert.rejects(inspect({...args,tokenIn:'0x'+'d'.repeat(40),fetcher:node().fetcher}),/TOKEN_NOT_IN_POOL/);
 await assert.rejects(inspect({...args,feeBps:undefined,fetcher:node().fetcher}),/UNVERIFIED_OR_INVALID_FEE/);
 await assert.rejects(inspect({...args,fetcher:node({failMethod:'eth_call'}).fetcher}),/RPC_RESPONSE_ERROR/);
});
