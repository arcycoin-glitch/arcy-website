'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const address='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';

test('legacy CoinGecko circulating-supply route is fail-closed without upstream requests',async()=>{
 const previous=global.fetch;let calls=0;
 try{
  global.fetch=async()=>{calls++;throw Error('CoinGecko must not be requested')};
  const route=require('../lib/coingecko-adapter');
  const result=await route({method:'GET',query:{address}},{setHeader(){},status(){return this},json(body){return body}});
  assert.equal(calls,0);
  assert.equal(result.status,'NOT_VERIFIED');
  assert.equal(result.circulatingSupply,null);
  assert.equal(result.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 }finally{global.fetch=previous;}
});

test('CoinGecko-linked market fallback does not make provider calls',async()=>{
 const previous=global.fetch;let calls=0;
 try{
  global.fetch=async()=>{calls++;throw Error('CoinGecko must not be requested')};
  const result=await require('../lib/market-sources').linkedCoin(address);
  assert.equal(calls,0);
  assert.equal(result.value,null);
  assert.equal(result.status,'NOT_VERIFIED');
  assert.equal(result.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
 }finally{global.fetch=previous;}
});

test('homepage unlock logos use only source-provided HTTPS logos or initials fallback',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 assert.doesNotMatch(html,/api\.coingecko\.com/i);
 assert.doesNotMatch(html,/tokenCoinGeckoIds|tokenLogoCache|loadTokenLogos/);
 assert.match(html,/function tokenIcon\(symbol, directLogo\)/);
 assert.match(html,/parsed\.hostname!=="coingecko\.com"&&!parsed\.hostname\.endsWith\("\.coingecko\.com"\)/);
 assert.match(html,/token-icon-fallback/);
});
