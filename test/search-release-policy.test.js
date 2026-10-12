'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

test('Search external source failures fail closed, and no unsupported market numbers are invented',async()=>{
 const original=global.fetch;let requests=0;
 global.fetch=async()=>{requests++;throw Error('Simulated market provider outage')};
 try{
  for(const adapter of [
   require('../search/server/lib/market'),
   require('../search/server/lib/arc-market'),
   require('../search/server/lib/robinhood-market')
  ]){
   const result=await adapter.inspect('0x'+'a'.repeat(40));
   const fields=result.fields||result;
   for(const key of ['priceUsd','valuation','liquidityUsd','volume24h']){
    assert.equal(fields[key].value,null);
    assert.ok(['PROVIDER_DISABLED_LICENSE_UNVERIFIED','DEXSCREENER_SOURCE_UNAVAILABLE'].includes(fields[key].reasonCode));
   }
  }
  assert.equal(requests,2); // Ethereum and Robinhood each attempt one market source; Arc remains gated.
 }finally{global.fetch=original}
});

test('Chart API keeps range validation and returns a sourced-data-pending status without provider calls',async()=>{
 const original=global.fetch;let requests=0;
 global.fetch=async()=>{requests++;throw Error('Chart provider must remain disabled')};
 const handler=require('../search/server/api/chart');
 const res={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v},
  status(v){this.statusCode=v;return this},json(value){this.body=value;return this}};
 try{
  await handler({method:'GET',query:{chain:'ethereum',address:'0x'+'a'.repeat(40),range:'4H'},headers:{},socket:{remoteAddress:'127.0.0.1'}},res);
  assert.equal(res.statusCode,503);
  assert.equal(res.body.error,'CHART_SOURCE_PENDING');
  assert.equal(res.body.range,'4H');
  assert.match(res.body.reason,/No estimated or synthetic candles/);
  assert.equal(requests,0);
 }finally{global.fetch=original}
});

test('Official Arc and Ethereum search survives blocked network explorers without false verification',async()=>{
 const original=global.fetch;let requests=0;
 global.fetch=async url=>{
  requests++;
  assert.ok(/\/api\/v2\/search\?q=|\/latest\/dex\/search\?q=/.test(String(url)));
  return {ok:false,status:403};
 };
 try{
  const service=require('../search/server/lib/multichain-service');
  const arc=await service.discover({network:'arc',query:'ARCY'});
  const eth=await service.discover({network:'ethereum',query:'USDC'});
  assert.equal(arc.matches[0].address,'0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b');
  assert.equal(arc.matches[0].identity.status,'OFFICIAL_CONTRACT_MATCHED');
  assert.ok(eth.matches.some(x=>x.symbol==='USDC'&&x.identity.status==='OFFICIAL_CONTRACT_MATCHED'));
  assert.equal(requests,4); // Two independent discovery sources per chain.
  assert.equal(arc.providerError,true);
  assert.equal(eth.providerError,true);
 }finally{global.fetch=original}
});
