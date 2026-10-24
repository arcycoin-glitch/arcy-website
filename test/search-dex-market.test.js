'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const dex=require('../search/server/lib/dex-market');
const eth='0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
 other='0xdac17f958d2ee523a2206206994597c13d831ec7',
 tsla='0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const pool=n=>'0x'+n.repeat(40);
function pair({chainId='ethereum',base=eth,quote=other,address=pool('a'),priceUsd='1.002',
 liq=1000,volume=3500,change=-1.25,marketCap=50000,fdv=55000,dexId='uniswap'}={}){
 return {chainId,pairAddress:address,baseToken:{address:base,name:'USD Coin',symbol:'USDC'},
 quoteToken:{address:quote,name:'Tether USD',symbol:'USDT'},priceUsd,liquidity:{usd:liq},
 volume:{h24:volume},priceChange:{h24:change},marketCap,fdv,dexId};
}
test('Exact network and contract only, duplicates omitted',()=>{
 const rows=dex.validPools([pair(),pair(),pair({chainId:'robinhood',address:pool('b')}),
  pair({base:other,quote:pool('c'),address:pool('e')})],'ethereum',eth);
 assert.equal(rows.length,1);
 assert.throws(()=>dex.validPools({},'ethereum',eth));
 assert.throws(()=>dex.validPools([],'unsupported',eth));
});
test('Source-backed price, market cap, percent change and tracked pool totals',()=>{
 const f=dex.parseMarket([pair(),pair({address:pool('b'),priceUsd:'1.003',liq:2000,
  volume:4000,dexId:'sushiswap'})],'ethereum',eth).fields;
 assert.equal(f.priceUsd.value,1.003);assert.equal(f.priceUsd.chainId,1);
 assert.equal(f.priceUsd.source,'DEX Screener');
 assert.equal(f.liquidityUsd.value,3000);assert.equal(f.volume24h.value,7500);
 assert.match(f.dexPairCount.value,/2 DEX · 2 tracked pools/);
 assert.equal(f.valuation.value,50000);assert.equal(f.valuation.kind,'MARKET_CAP');
 assert.equal(f.change24h.value,-1.25);assert.equal(f.lpStatus.dataState,'NOT_VERIFIED');
 assert.match(f.liquidityUsd.evidence[0].scope,/NOT total market/);
});
test('Quote token has no source-verified price, but its pool liquidity is valid',()=>{
 const f=dex.parseMarket([pair({base:other,quote:eth,address:pool('b')})],'ethereum',eth).fields;
 assert.equal(f.priceUsd.dataState,'NOT_VERIFIED');assert.equal(f.change24h.value,null);
 assert.equal(f.valuation.value,null);assert.equal(f.liquidityUsd.value,1000);
});
test('FDV is explicitly labelled and missing numeric values do not become zero',()=>{
 const a=dex.parseMarket([pair({marketCap:null,fdv:39000})],'ethereum',eth).fields;
 assert.equal(a.valuation.value,39000);assert.equal(a.valuation.kind,'FDV');
 const b=dex.parseMarket([pair({priceUsd:'',marketCap:null,fdv:null,liq:null,volume:null})],
  'ethereum',eth).fields;
 assert.equal(b.priceUsd.dataState,'NOT_VERIFIED');
 assert.equal(b.volume24h.value,null);assert.equal(b.valuation.value,null);
});
test('Robinhood market data cannot leak Ethereum pools',()=>{
 const f=dex.parseMarket([pair({chainId:'robinhood',base:tsla}),
  pair({chainId:'ethereum',base:tsla,address:pool('b')})],'robinhood',tsla).fields;
 assert.equal(f.priceUsd.value,1.002);
 assert.equal(f.priceUsd.network,'robinhood');assert.equal(f.priceUsd.chainId,4663);
});
test('DEX search returns unverified, chain-scoped candidates only',()=>{
 const body={pairs:[pair(),pair({chainId:'robinhood',base:tsla,address:pool('b')})]};
 const x=dex.parseSearch(body,'ethereum','USDC');
 assert.equal(x.length,1);assert.equal(x[0].address,eth);assert.equal(x[0].logoUrl,null);
 assert.equal(x[0].identityVerified,false);
 const y=dex.parseSearch(body,'robinhood','USD');
 assert.ok(y.length>=1);assert.equal(y[0].address,tsla);assert.equal(y[0].chainId,4663);
});
test('Upstream outage does not invent values',async()=>{
 const f=await dex.inspect('ethereum',eth,{fetcher:async()=>({ok:false,status:503})});
 assert.equal(f.priceUsd.dataState,'NOT_VERIFIED');assert.equal(f.liquidityUsd.value,null);
});
test('Fetch uses approved fixed host, exact chain and contract',async()=>{
 let requested;
 const fetcher=async url=>(requested=String(url),new Response(JSON.stringify([
  pair({chainId:'robinhood',base:tsla})]),{status:200,headers:{'content-type':'application/json'}}));
 const f=await dex.inspect('robinhood',tsla,{fetcher});
 assert.equal(requested,'https://api.dexscreener.com/token-pairs/v1/robinhood/'+tsla);
 assert.equal(f.priceUsd.value,1.002);
});
test('Production DEX market and discovery calls fail closed until explicit provider-use approval',async()=>{
 const before={VERCEL:process.env.VERCEL,VERCEL_ENV:process.env.VERCEL_ENV,APPROVED:process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED};let calls=0;
 try{
  process.env.VERCEL='1';process.env.VERCEL_ENV='production';delete process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED;
  const fields=await dex.inspect('ethereum',eth,{fetcher:async()=>{calls++;throw Error('must remain disabled');}});
  assert.equal(fields.priceUsd.dataState,'NOT_VERIFIED');assert.equal(fields.priceUsd.reasonCode,'PROVIDER_DISABLED_LICENSE_UNVERIFIED');
  assert.deepEqual(await dex.discover('ethereum','USDC',{fetcher:async()=>{calls++;throw Error('must remain disabled');}}),[]);
  assert.equal(calls,0);assert.equal(dex.productionDisplayAllowed(),false);
  process.env.DEXSCREENER_PUBLIC_DISPLAY_APPROVED='true';
  const enabled=await dex.inspect('ethereum',eth,{fetcher:async()=>{calls++;return new Response(JSON.stringify([pair()]),{status:200});}});
  assert.equal(enabled.priceUsd.value,1.002);assert.equal(calls,1);assert.equal(dex.productionDisplayAllowed(),true);
 }finally{
  for(const [key,value] of [['VERCEL',before.VERCEL],['VERCEL_ENV',before.VERCEL_ENV],['DEXSCREENER_PUBLIC_DISPLAY_APPROVED',before.APPROVED]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
