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

test('Arc Search activity returns no market values when its exact-contract sources fail',async()=>{
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

test('Arc Search restores exact-contract activity fields from its existing market route before DEX fallback',async()=>{
 const legacy=require('../search/server/lib/arc-legacy-evidence');
 const market=require('../search/server/lib/arc-market');
 const previousCall=legacy.callOriginal,previousInspect=market.inspect;
 try{
  legacy.callOriginal=async(name,address)=>({ok:true,address,chainId:5042,fields:{
   priceUsd:{value:1,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'GeckoTerminal',evidence:[{address,chainId:5042}]},
   valuation:{value:5000000000,kind:'MARKET_CAP',status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'GeckoTerminal',evidence:[{address,chainId:5042}]},
   change24h:{value:0.2,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'GeckoTerminal',evidence:[{address,chainId:5042}]},
   volume24h:{value:1000,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'DexScreener',evidence:[{address,chainId:5042}]}
  }});
  market.inspect=async()=>({priceUsd:{value:null,dataState:'NOT_VERIFIED'},valuation:{value:null,dataState:'NOT_VERIFIED'},
   change24h:{value:null,dataState:'NOT_VERIFIED'},volume24h:{value:null,dataState:'NOT_VERIFIED'}});
  const result=await require('../search/server/lib/arc-adapter').activity({address:A,base:{totalSupply:'6000000000'}},'activity');
  assert.equal(result.fields.priceUsd.source,'GeckoTerminal');
  assert.equal(result.fields.valuation.kind,'MARKET_CAP');
  assert.equal(result.fields.change24h.value,0.2);
  assert.equal(result.fields.volume24h.source,'DexScreener');
 }finally{legacy.callOriginal=previousCall;market.inspect=previousInspect}
});

test('Arc Search supply remains on pinned RPC and mechanics fails closed when reviewed source data is unavailable',async()=>{
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

test('Arc mechanics restores exact-contract reviewed fields while unapproved GoPlus stays gated on Preview',async()=>{
 const legacy=require('../search/server/lib/arc-legacy-evidence');
 const rpc=require('../search/server/lib/arc-rpc');
 const previousCall=legacy.callOriginal,previousRpc=rpc.rpc,previousFetch=global.fetch;
 const oldVercel=process.env.VERCEL,oldEnv=process.env.VERCEL_ENV,oldApproval=process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
 let goPlusCalls=0;
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='preview';delete process.env.GOPLUS_PUBLIC_DISPLAY_APPROVED;
  legacy.callOriginal=async(name,address)=>{
   assert.equal(name,'mechanics');
   return {ok:true,address,chainId:5042,contractFields:{
    buyTax:{value:3,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',source:'Sourcify',evidence:[{source:'Sourcify'}]},
    sellTax:{value:3,status:'VERIFIED_SOURCE',dataState:'DATA_FOUND',source:'Sourcify',evidence:[{source:'Sourcify'}]},
    mint:{value:false,status:'NOT_DETECTED',dataState:'DATA_FOUND',source:'Sourcify',evidence:[{source:'Sourcify'}]},
    proxyUpgradeable:{value:'0x'+'1'.repeat(40),status:'GETTER_REPORTED',dataState:'DATA_FOUND',source:'Arc RPC',evidence:[{source:'Arc RPC'}]}
   }};
  };
  rpc.rpc=async()=> '0x'+'0'.repeat(64);
  global.fetch=async url=>{if(String(url).includes('gopluslabs.io'))goPlusCalls++;throw Error('unexpected provider request')};
  const result=await require('../search/server/lib/arc-adapter').mechanics({address:A,base:{block:'0x100'}});
  assert.equal(result.fields.tradingTaxes.value,'Buy 3% · Sell 3%');
  assert.equal(result.fields.mintCapability.value,false);
  assert.equal(result.fields.contractArchitecture.dataState,'DATA_FOUND');
  assert.equal(goPlusCalls,0);
 }finally{
  legacy.callOriginal=previousCall;rpc.rpc=previousRpc;global.fetch=previousFetch;
  for(const [key,value] of [['VERCEL',oldVercel],['VERCEL_ENV',oldEnv],['GOPLUS_PUBLIC_DISPLAY_APPROVED',oldApproval]])
   if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
