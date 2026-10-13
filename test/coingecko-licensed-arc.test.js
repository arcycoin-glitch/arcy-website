'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('../lib/coingecko-adapter');
const core=require('../lib/core');
const supplyPath=require.resolve('../api/supply');
const ADDRESS='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
function response(){return {code:200,setHeader(){return this},status(n){this.code=n;return this},json(x){this.body=x;return x}};}
const vars=['COINGECKO_PUBLIC_DISPLAY_APPROVED','COINGECKO_ATTRIBUTION_READY','COINGECKO_PRO_API_KEY','COINGECKO_API_KEY'];
async function env(values,fn){
 const before=new Map(vars.map(k=>[k,process.env[k]]));
 try{for(const k of vars)delete process.env[k];Object.assign(process.env,values);return await fn();}
 finally{for(const [k,v] of before)if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
test('free/demo key or approval without visible attribution cannot trigger CoinGecko',async()=>{
 await env({COINGECKO_API_KEY:'demo-key',COINGECKO_PUBLIC_DISPLAY_APPROVED:'true'},async()=>{
  const r=response();await adapter({method:'GET',query:{address:ADDRESS}},r);
  assert.equal(r.code,200);assert.equal(r.body.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
  assert.equal(r.body.circulatingSupply,null);assert.equal(adapter.productionAllowed(),false);
 });
});
test('CoinGecko coin must exactly match Arc contract and return positive circulation',()=>{
 const ok={id:'example',platforms:{arc:ADDRESS},market_data:{circulating_supply:10,total_supply:100}};
 assert.equal(adapter.parse(ok,ADDRESS).circulatingSupply,10);
 assert.equal(adapter.parse(ok,'0x0000000000000000000000000000000000000001').reasonCode,'CONTRACT_IDENTITY_MISMATCH');
 assert.equal(adapter.parse({...ok,market_data:{circulating_supply:0}},ADDRESS).reasonCode,'NO_POSITIVE_CIRCULATING_SUPPLY');
 assert.equal(adapter.parse({...ok,market_data:{circulating_supply:101,total_supply:100}},ADDRESS).reasonCode,'CIRCULATING_EXCEEDS_SOURCE_SUPPLY');
});
test('licensed and attributed read checks contract and Arc total supply before publication',async()=>{
 await env({COINGECKO_PRO_API_KEY:'not-a-real-key',COINGECKO_PUBLIC_DISPLAY_APPROVED:'true',COINGECKO_ATTRIBUTION_READY:'true'},async()=>{
  const originalJson=core.json,originalSupply=require.cache[supplyPath].exports;
  try{
   core.json=async(url,options)=>{
    assert.equal(url,'https://pro-api.coingecko.com/api/v3/coins/arc/contract/'+ADDRESS);
    assert.equal(options.headers['x-cg-pro-api-key'],'not-a-real-key');
    return {id:'arcy-coin',platforms:{arc:ADDRESS},market_data:{circulating_supply:300,total_supply:1000}};
   };
   require.cache[supplyPath].exports=async()=>({ok:true,totalSupply:{amount:'1000'}});
   const r=response();await adapter({method:'GET',query:{address:ADDRESS}},r);
   assert.equal(r.code,200);assert.equal(r.body.circulatingSupply,300);
   assert.equal(r.body.dataState,'DATA_FOUND');
   assert.equal(r.body.attribution,'Data provided by CoinGecko');
   assert.equal(r.body.sourceUrl,'https://www.coingecko.com/en/api');
   require.cache[supplyPath].exports=async()=>({ok:true,totalSupply:{amount:'200'}});
   const bad=response();await adapter({method:'GET',query:{address:ADDRESS}},bad);
   assert.equal(bad.body.reasonCode,'CIRCULATING_EXCEEDS_ONCHAIN_SUPPLY');
  }finally{core.json=originalJson;require.cache[supplyPath].exports=originalSupply;}
 });
});
