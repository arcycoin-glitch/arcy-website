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
test('AAVE, LINK and DAI read only pinned Ethereum Chainlink USD references',async()=>{
 const addresses=[
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
  '0x514910771af9ca656af840dff83e8264ecf986ca',
  '0x6b175474e89094c44da98b954eedeac495271d0f',
  '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
  '0xc00e94cb662c3520282e6f5717214004a7f26888'
 ];
 for(const address of addresses){
  const m=mock(),result=await oracle.inspect(address,block,{rpcCall:m.rpcCall,now});
  assert.equal(result.priceUsd.dataState,'DATA_FOUND');
  assert.equal(result.priceUsd.value,2500.12345678);
  assert.equal(result.priceUsd.evidence[0].token,address);
  assert.equal(result.priceUsd.evidence[0].block,block);
  assert.equal(Object.keys(result).length,1);
  assert.equal(m.calls.length,3);
 }
});
test('UNI and CRV extend the USD price card using only official Ethereum contract and pinned Chainlink oracle',async()=>{
 const sources=[
  {token:'0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
   feed:'0x553303d460ee0afb37edff9be42922d8ff63220e',symbol:'UNI'},
  {token:'0xd533a949740bb3306d119cc777fa900ba034cd52',
   feed:'0xcd627aa160a6fa45eb793d19ef54f5062f20f33f',symbol:'CRV'}
 ];
 for(const {token,feed,symbol} of sources){
  assert.equal(oracle.ASSETS[token].feed,feed);
  assert.equal(oracle.ASSETS[token].symbol,symbol);
  const inner=mock();
  const received=await oracle.inspect(token,block,{now,rpcCall:async(method,params)=>{
   if(method==='eth_call'){
    assert.equal(params[0].to,feed);
    assert.equal(params[1],block);
   }
   return inner.rpcCall(method,params);
  }});
  assert.equal(received.priceUsd.dataState,'DATA_FOUND');
  assert.equal(received.priceUsd.status,'ON_CHAIN_ORACLE');
  assert.equal(received.priceUsd.value,2500.12345678);
  assert.equal(received.priceUsd.evidence[0].feed,feed);
  assert.equal(received.priceUsd.evidence[0].block,block);
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
