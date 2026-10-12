'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const address='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
test('CoinGecko API adapter makes no network request and does not infer circulation',async()=>{
 const original=global.fetch;let called=false;
 try{
  global.fetch=async()=>{called=true;throw Error('Unexpected CoinGecko request')};
  const result=await require('../lib/coingecko-adapter')({query:{address}},
   {setHeader(){},status(){return this},json(value){return value}});
  assert.equal(called,false);assert.equal(result.circulatingSupply,null);
  assert.equal(result.contractMatched,false);
  assert.equal(result.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 }finally{global.fetch=original}
});
test('DEX Screener market adapter is explicitly disabled without making a request',async()=>{
 const original=global.fetch;let called=false;
 try{
  global.fetch=async()=>{called=true;throw Error('Unexpected DEX Screener request')};
  await assert.rejects(require('../lib/market-activity').dexPairs(address),
   error=>error.code==='PROVIDER_DISABLED_LICENSE_UNVERIFIED');
  assert.equal(called,false);
 }finally{global.fetch=original}
});
