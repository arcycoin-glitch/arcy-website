'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('../search/server/lib/robinhood-adapter');
const market=require('../search/server/lib/robinhood-market');

test('Robinhood market card describes source-reported pool data instead of saying market data is disabled',async()=>{
 const old=market.inspect;
 market.inspect=async()=>({
  priceUsd:{value:1.25,dataState:'DATA_FOUND',source:'DEX Screener'},
  valuation:{value:500000,dataState:'DATA_FOUND',source:'DEX Screener',kind:'MARKET_CAP'},
  change24h:{value:2,dataState:'DATA_FOUND',source:'DEX Screener'},
  volume24h:{value:1000,dataState:'DATA_FOUND',source:'DEX Screener'},
  liquidityUsd:{value:25000,dataState:'DATA_FOUND',source:'DEX Screener'},
  dexPairCount:{value:'1 DEX · 1 tracked pool',dataState:'DATA_FOUND',source:'DEX Screener'},
  lpStatus:{value:null,dataState:'NOT_VERIFIED',reason:'LP status unavailable'}
 });
 try{
  const identity={address:'0x322f0929c4625ed5bad873c95208d54e1c003b2d'};
  const activity=await adapter.inspectCard({...identity,cardId:'activity'});
  const liquidity=await adapter.inspectCard({...identity,cardId:'liquidity'});
  assert.match(activity.description,/source-reported/);
  assert.match(activity.description,/underlying company share price/);
  assert.doesNotMatch(activity.description,/pending commercial-use verification/i);
  assert.equal(activity.fields.priceUsd.dataState,'DATA_FOUND');
  assert.equal(activity.fields.valuation.kind,'MARKET_CAP');
  assert.equal(liquidity.fields.lpStatus.dataState,'NOT_VERIFIED');
 }finally{market.inspect=old;}
});
