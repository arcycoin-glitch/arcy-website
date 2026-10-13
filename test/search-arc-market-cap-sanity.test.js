'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateArcMarketCap}=require('../search/server/lib/arc-adapter');
const holderCount=require('../search/server/lib/arc-holder-count');
const A='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';

const base={totalSupply:'562514535.051482'};
const price={value:0.999824,dataState:'DATA_FOUND'};
const marketCap={value:72718521555.0668,kind:'MARKET_CAP',dataState:'DATA_FOUND'};

test('Arc market cap above exact-contract total supply value is withheld',()=>{
 const result=validateArcMarketCap(marketCap,base,price);
 assert.equal(result.value,null);
 assert.equal(result.dataState,'NOT_VERIFIED');
 assert.equal(result.reasonCode,'MARKET_CAP_EXCEEDS_ONCHAIN_SUPPLY_VALUE');
});

test('Arc market cap within the total-supply ceiling remains source-reported',()=>{
 const plausible={...marketCap,value:560000000};
 assert.equal(validateArcMarketCap(plausible,base,price),plausible);
});

test('Arc FDV is not relabeled or suppressed by the market-cap sanity check',()=>{
 const fdv={...marketCap,kind:'FDV'};
 assert.equal(validateArcMarketCap(fdv,base,price),fdv);
});

test('Arc market cap is left unchanged when on-chain cross-check inputs are unavailable',()=>{
 assert.equal(validateArcMarketCap(marketCap,null,price),marketCap);
 assert.equal(validateArcMarketCap(marketCap,base,{value:null}),marketCap);
});

test('Arc Blockscout counter is reported only as a current holder count, never whale distribution',async()=>{
 const publication=require('../search/server/lib/arc-holder-publication');
 const legacy=require('../search/server/lib/arc-legacy-evidence');
 const previousLoad=publication.load,previousCall=legacy.callOriginal,previousFetch=holderCount.fetchCount;
 try{
  publication.load=async()=>publication.empty();
  legacy.callOriginal=async()=>{throw Error('Historical worker unavailable')};
  holderCount.fetchCount=async address=>({value:1153254,status:'SOURCE_REPORTED',dataState:'DATA_FOUND',
   network:'arc',chainId:5042,source:'Arc Blockscout',evidence:[{contract:address}]});
  const result=await require('../search/server/lib/arc-adapter').holders({address:'0x3600000000000000000000000000000000000000'});
  assert.equal(result.fields.holderCount.value,1153254);
  assert.equal(result.fields.holderCount.source,'Arc Blockscout');
  for(const key of ['largestWalletPct','top10Pct','top20Pct'])
   assert.equal(result.fields[key].dataState,'NOT_VERIFIED');
 }finally{
  publication.load=previousLoad;legacy.callOriginal=previousCall;holderCount.fetchCount=previousFetch;
 }
});

test('Arc Blockscout counter parser rejects absent, zero and malformed values instead of inventing a count',()=>{
 assert.equal(holderCount.parseCount({token_holders_count:1153254}),1153254);
 assert.equal(holderCount.parseCount({token_holders_count:0}),null);
 assert.equal(holderCount.parseCount({token_holders_count:'1.5'}),null);
 assert.equal(holderCount.parseCount({}),null);
});

test('Arc Search market adapter never bridges to legacy endpoints that bypass provider permission gates',async()=>{
 const legacy=require('../search/server/lib/arc-legacy-evidence');
 const market=require('../search/server/lib/arc-market');
 const previousCall=legacy.callOriginal,previousInspect=market.inspect;
 try{
  legacy.callOriginal=async()=>{throw Error('legacy source must not be called')};
  market.inspect=async()=>({
   priceUsd:{value:null,dataState:'NOT_VERIFIED'},
   valuation:{value:null,kind:null,dataState:'NOT_VERIFIED'},
   change24h:{value:null,dataState:'NOT_VERIFIED'},
   volume24h:{value:null,dataState:'NOT_VERIFIED'},
   liquidityUsd:{value:null,dataState:'NOT_VERIFIED'},
   dexPairCount:{value:null,dataState:'NOT_VERIFIED'},
   lpStatus:{value:null,dataState:'NOT_VERIFIED'}
  });
  const arc=require('../search/server/lib/arc-adapter');
  const base={totalSupply:'1000000'};
  const activity=await arc.activity({address:A,base},'activity');
  const liquidity=await arc.activity({address:A,base},'liquidity');
  assert.equal(activity.fields.valuation.dataState,'NOT_VERIFIED');
  assert.equal(activity.fields.priceUsd.dataState,'NOT_VERIFIED');
  assert.equal(liquidity.fields.liquidityUsd.dataState,'NOT_VERIFIED');
 }finally{legacy.callOriginal=previousCall;market.inspect=previousInspect}
});

test('Arc Search supply and mechanics do not call shared legacy routes that fan out to unapproved providers',async()=>{
 const legacy=require('../search/server/lib/arc-legacy-evidence');
 const rpc=require('../search/server/lib/arc-rpc');
 const previousCall=legacy.callOriginal,previousRpc=rpc.rpc;
 const oldVercel=process.env.VERCEL,oldEnv=process.env.VERCEL_ENV;
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='preview';
  legacy.callOriginal=async()=>{throw Error('shared legacy provider route must not be called')};
  rpc.rpc=async()=> '0x'+'0'.repeat(64);
  const arc=require('../search/server/lib/arc-adapter');
  const base={address:A,block:'0x100',totalSupplyRaw:'1000000',totalSupply:'1',
   burnAddressRaw:'0',burnAddressBalance:'0'};
  const supply=await arc.supply(base);
  assert.equal(supply.fields.totalSupply.dataState,'DATA_FOUND');
  assert.equal(supply.fields.circulatingSupply.dataState,'NOT_VERIFIED');
  assert.equal(supply.fields.circulatingSupply.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
  const mechanics=await arc.mechanics({address:A,base});
  assert.equal(mechanics.fields.tradingTaxes.dataState,'NOT_VERIFIED');
  assert.equal(mechanics.fields.mintCapability.dataState,'NOT_VERIFIED');
 }finally{
  legacy.callOriginal=previousCall;rpc.rpc=previousRpc;
  if(oldVercel===undefined)delete process.env.VERCEL;else process.env.VERCEL=oldVercel;
  if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
 }
});
