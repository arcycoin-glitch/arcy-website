'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const oracle=require('../search/server/lib/oracle-market');
const WETH='0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const block='0x1234',now=Date.parse('2026-10-14T12:00:00Z');
const hex=n=>BigInt(n).toString(16).padStart(64,'0');
const words=(round,answer,updated)=>'0x'+[round,answer,1000,updated,round].map(hex).join('');
function mock({updatedAt=now/1000-60,answer=250012345678n}={}){
 const calls=[];
 return {calls,async rpcCall(method,params){calls.push({method,params});
  if(method==='eth_getBlockByNumber')return {timestamp:'0x'+(now/1000).toString(16)};
  if(params[0].data==='0x313ce567')return '0x'+hex(8);
  return words(12,answer,updatedAt);
 }};
}
test('exact Ethereum WETH and USDC Chainlink feeds return only a fresh pinned-block USD reference',async()=>{
 for(const [address,price] of [[WETH,2500.12345678],[USDC,2500.12345678]]){
  const m=mock(),r=await oracle.inspect(address,block,{rpcCall:m.rpcCall,now});
  assert.equal(r.priceUsd.dataState,'DATA_FOUND');assert.equal(r.priceUsd.value,price);
  assert.equal(r.priceUsd.chainId,1);assert.equal(r.priceUsd.evidence[0].block,block);
  assert.equal(r.priceUsd.evidence[0].ageSeconds,60);
  assert.equal(m.calls.length,3);assert.ok(m.calls.every(c=>c.method==='eth_call'||c.method==='eth_getBlockByNumber'));
 }
});
test('unsupported contract and stale/future oracle observations remain NOT VERIFIED',async()=>{
 const unsupported=await oracle.inspect('0x'+'1'.repeat(40),block,{rpcCall:mock().rpcCall,now});
 assert.equal(unsupported.priceUsd.dataState,'NOT_VERIFIED');assert.equal(unsupported.priceUsd.reasonCode,'NO_EXACT_ORACLE_FEED');
 for(const updatedAt of [now/1000-86401,now/1000+1]){
  const r=await oracle.inspect(WETH,block,{rpcCall:mock({updatedAt}).rpcCall,now});
  assert.equal(r.priceUsd.dataState,'NOT_VERIFIED');
 }
});
test('Ethereum market fallback adds no unsupported cap, volume, change or liquidity values',async()=>{
 const market=require('../search/server/lib/market'),dex=require('../search/server/lib/dex-market'),
  oracleModule=require('../search/server/lib/oracle-market');
 const old=dex.inspect,oldOracle=oracleModule.inspect;
 try{
  dex.inspect=async()=>({priceUsd:{value:null,dataState:'NOT_VERIFIED'},valuation:{value:null,dataState:'NOT_VERIFIED'},
   volume24h:{value:null,dataState:'NOT_VERIFIED'},change24h:{value:null,dataState:'NOT_VERIFIED'},
   liquidityUsd:{value:null,dataState:'NOT_VERIFIED'}});
  oracleModule.inspect=async address=>({priceUsd:{value:2500,dataState:'DATA_FOUND',source:'Chainlink Data Feed',
   evidence:[{token:address,block}]}});
  const result=await market.inspect(WETH,block);
  assert.equal(result.fields.priceUsd.dataState,'DATA_FOUND');
  for(const key of ['valuation','volume24h','change24h','liquidityUsd'])assert.equal(result.fields[key].value,null);
 }finally{dex.inspect=old;oracleModule.inspect=oldOracle}
});
