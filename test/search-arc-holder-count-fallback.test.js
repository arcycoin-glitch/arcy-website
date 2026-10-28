'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const arc=require('../search/server/lib/arc-holder-count');
const ADDRESS='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const AX='https://arcexplorer.org';
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
const blocked=()=>new Response('blocked',{status:403});
test('Arc returns exact-contract A/X source-reported holder count when Blockscout is blocked',async()=>{
 const seen=[];
 const fetcher=async url=>{
  seen.push(url);
  if(url.includes('explorer.arc.io'))return blocked();
  if(url===AX+'/api/v1/stats')return json({chainId:5042});
  if(url===AX+'/api/v1/tokens/'+ADDRESS)return json({address:ADDRESS,chainId:5042});
  if(url===AX+'/api/v1/tokens/'+ADDRESS+'/holders?limit=1&offset=0')
   return json({total:321,items:[{address:'0x'+'1'.repeat(40),balance:'100'}]});
  throw Error('Unexpected request '+url);
 };
 const result=await arc.fetchCount(ADDRESS,{fetcher,now:1000});
 assert.equal(result.value,321);
 assert.equal(result.status,'SOURCE_REPORTED');
 assert.equal(result.source,'A/X Explorer');
 assert.equal(result.chainId,5042);
 assert.equal(result.evidence[0].contract,ADDRESS);
 assert.match(result.evidence[0].scope,/not a pinned wallet census/i);
 assert.equal(seen.length,4);
});
test('Arc rejects wrong A/X chain identity without accepting any holder count',async()=>{
 const seen=[];
 const fetcher=async url=>{seen.push(url);return url.includes('explorer.arc.io')?blocked():json({chainId:1});};
 const result=await arc.fetchCount(ADDRESS,{fetcher});
 assert.equal(result,null);
 assert.equal(seen.length,2);
});
test('Arc rejects mismatched A/X token identity and malformed holder pagination',async()=>{
 for(const mode of ['wrong-token','malformed-count','invalid-wallet']){
  let requestedHolders=false;
  const fetcher=async url=>{
   if(url.includes('explorer.arc.io'))return blocked();
   if(url===AX+'/api/v1/stats')return json({chainId:5042});
   if(url===AX+'/api/v1/tokens/'+ADDRESS)
    return json({address:mode==='wrong-token'?'0x'+'2'.repeat(40):ADDRESS});
   if(url.endsWith('/holders?limit=1&offset=0')){
    requestedHolders=true;
    return json({total:mode==='malformed-count'?'999':999,
     items:[{address:mode==='invalid-wallet'?'bad':'0x'+'1'.repeat(40)}]});
   }
   throw Error('Unexpected request '+url);
  };
  assert.equal(await arc.fetchCount(ADDRESS,{fetcher}),null);
  if(mode==='wrong-token')assert.equal(requestedHolders,false);
 }
});
test('Arc invalid contract never triggers an explorer request',async()=>{
 const result=await arc.fetchCount('0xINVALID',{fetcher:async()=>{throw Error('must not fetch')}});
 assert.equal(result,null);
});
