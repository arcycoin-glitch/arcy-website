'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const read=require('../search/server/lib/robinhood-holder-count');
const adapter=require('../search/server/lib/robinhood-adapter');
const ADDRESS='0x'+'a'.repeat(40);
test('Robinhood Blockscout holder count has bounded exact contract validation',()=>{
 for(const value of [{token_holders_count:42},{token_holders_count:'42'},{holders_count:42}])
  assert.equal(read.parseCount(value),42);
 for(const value of [{holders_count:0},{holders_count:'0'},{holders_count:-10},{holders_count:'0x2a'},
  {holders_count:'999999999999999999999'},null,{}])
  assert.equal(read.parseCount(value),null);
});
test('Count from public Robinhood Blockscout is source-scoped, not pinned block',async()=>{
 const result=await read.fetchCount(ADDRESS,{key:'',now:Date.parse('2026-10-11T12:00:00Z'),
  fetcher:async url=>{
   assert.equal(url,'https://robinhoodchain.blockscout.com/api/v2/tokens/'+ADDRESS+'/counters');
   return new Response(JSON.stringify({token_holders_count:'1234'}));
  }
 });
 assert.equal(result.value,1234);assert.equal(result.network,'robinhood');
 assert.equal(result.chainId,4663);assert.match(result.evidence[0].scope,/No complete pinned wallet ranking/);
 assert.equal(result.evidence[0].checkedAt,'2026-10-11T12:00:00.000Z');
});
test('PRO fallback uses a secret only on server; never puts it in evidence or error',async()=>{
 const key='proapi_EXAMPLE_SAFE_TESTING_KEY',seen=[];
 const result=await read.fetchCount(ADDRESS,{key,fetcher:async url=>{
  seen.push(url);
  if(seen.length===1)return new Response('',{status:403});
  return new Response(JSON.stringify({token_holders_count:3456}));
 }});
 assert.equal(seen.length,2);
 assert.equal(new URL(seen[1]).searchParams.get('apikey'),key);
 assert.equal(result.value,3456);
 assert.equal(result.source,'Blockscout PRO Robinhood');
 assert.equal(JSON.stringify(result).includes(key),false);
 assert.equal(result.evidence[0].sourceUrl,'https://api.blockscout.com/4663/api/v2/tokens/'+ADDRESS+'/counters');
});
test('Invalid credential and failed providers never leak details or invent holder count',async()=>{
 let requests=0;
 const failed=await read.fetchCount(ADDRESS,{key:'nonsense',fetcher:async()=>{
  requests++;return new Response('blocked',{status:403});
 }});
 assert.equal(failed,null);assert.equal(requests,1);
 assert.equal(await read.fetchCount('not a contract',{fetcher:()=>{throw Error('Should not call')}}),null);
});
