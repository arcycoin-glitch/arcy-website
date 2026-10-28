'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const metrics=require('../search/server/lib/derived-metrics');
const schema=require('../search/server/schema');
const browserSchema=require('../search/schema');
const engine=require('../search/server/lib/data-engine');
const format=require('../search/format');
const ADDRESS='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40);
const IDS={arc:5042,ethereum:1,robinhood:4663};
function context(network='arc'){
 return {network,chainId:IDS[network],address:ADDRESS,block:'0x123',token:{decimals:18}};
}
function onchain(value,context,method='totalSupply()'){
 return {value,status:'ON_CHAIN',dataState:'DATA_FOUND',
  source:context.network+' RPC',network:context.network,chainId:context.chainId,
  evidence:[{network:context.network,chainId:context.chainId,address:context.address,block:context.block,method}]};
}
function market(value,context,{source='GeckoTerminal',timestamp='2026-10-28T16:30:00Z',url}={}){
 return {value,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',
  source,network:context.network,chainId:context.chainId,
  evidence:[{network:context.network,chainId:context.chainId,address:context.address,
   url:url||'https://api.geckoterminal.com/api/v2/networks/'+context.network+'/tokens/'+ADDRESS+'/pools',
   fetchedAt:timestamp,scope:'Only source-returned matching token pools'}]};
}
function supplyFixture(context,{total='1000000000',burn='27921688.82967170463598735'}={}){
 return {totalSupply:onchain(total,context),burnAddressBalance:onchain(burn,context,'balanceOf(zero/dead)')};
}
test('Supply & Burn and Liquidity & Trading are exactly four fields each on all three chains',()=>{
 assert.deepEqual(browserSchema,schema);
 assert.equal(schema.length,5);
 assert.equal(schema.reduce((sum,x)=>sum+x.fields.length,0),20);
 assert.deepEqual(schema.find(x=>x.id==='supply').fields.map(x=>x[0]),
  ['totalSupply','nonBurnSupply','burnAddressBalance','burnAddressPct']);
 assert.deepEqual(schema.find(x=>x.id==='liquidity').fields.map(x=>x[0]),
  ['liquidityUsd','volume24h','dexPairCount','liquidityTurnover24h']);
 assert.ok(!schema.some(x=>x.fields.some(f=>['nextUnlock','circulatingSupply','lpStatus'].includes(f[0]))));
});
test('Exact on-chain burn-address arithmetic never calls it circulating or historical burn',()=>{
 for(const network of Object.keys(IDS)){
  const ctx=context(network),base=supplyFixture(ctx);
  const r=metrics.supply(base,ctx);
  assert.equal(r.nonBurnSupply.value,'972078311.17032829536401265');
  assert.equal(r.nonBurnSupply.status,'ON_CHAIN_DERIVED');
  assert.equal(r.burnAddressPct.status,'ON_CHAIN_DERIVED');
  assert.ok(Math.abs(r.burnAddressPct.value-2.792168882967)<1e-10);
  assert.match(r.nonBurnSupply.evidence[0].scope,/not verified circulating/);
  assert.match(r.burnAddressPct.evidence[0].scope,/not.*historical destruction/i);
  const out=engine.formatCard('supply',{fields:{...base,circulatingSupply:{value:'0',dataState:'NOT_VERIFIED'}}},
   {id:ctx.network,chainId:ctx.chainId},ctx);
  assert.equal(out.status,'SOURCE_BACKED');
  assert.equal(out.fields.nonBurnSupply.value,r.nonBurnSupply.value);
  assert.equal(out.fields.burnAddressPct.value,r.burnAddressPct.value);
  assert.equal(out.fields.totalSupply.value,base.totalSupply.value);
  assert.equal(out.fields.burnAddressBalance.value,base.burnAddressBalance.value);
 }
});
test('Exact integer token outside-burn and true zero-share avoid rounding bugs',()=>{
 const ctx=context();
 assert.equal(metrics.supply(supplyFixture(ctx,{total:'1000.0000',burn:'0.0000'}),ctx).nonBurnSupply.value,'1000');
 assert.equal(metrics.supply(supplyFixture(ctx,{total:'1000',burn:'0'}),ctx).burnAddressPct.value,0);
 assert.equal(metrics.supply(supplyFixture(ctx,{total:'1000',burn:'1000'}),ctx).nonBurnSupply.value,'0');
 assert.equal(metrics.supply(supplyFixture(ctx,{total:'1.000000000000000001',burn:'0.000000000000000001'}),ctx).nonBurnSupply.value,'1');
});
test('Wrong chain/address/block/source, malformed decimal or excess burns cannot masquerade as verified supply',()=>{
 const ctx=context(),good=supplyFixture(ctx);
 const broken=[
  {...good,burnAddressBalance:{...good.burnAddressBalance,network:'ethereum'}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,evidence:[{...good.burnAddressBalance.evidence[0],block:'0x124'}]}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,evidence:[{...good.burnAddressBalance.evidence[0],address:OTHER}]}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,source:'Different RPC'}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,status:'SOURCE_REPORTED'}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,value:'1000000001'}},
  {...good,burnAddressBalance:{...good.burnAddressBalance,value:'1e4'}},
  {...good,totalSupply:{...good.totalSupply,value:'0'}},
 ];
 for(const sample of broken){
  const r=metrics.supply(sample,ctx);
  assert.equal(r.nonBurnSupply.value,null);
  assert.equal(r.burnAddressPct.value,null);
 }
});
test('24h tracked volume / liquidity is computed only for matching snapshots and exact contracts',()=>{
 for(const network of Object.keys(IDS)){
  const ctx=context(network);
  const raw={liquidityUsd:market(2925.6702,ctx),volume24h:market(0,ctx)};
  const ratio=metrics.liquidity(raw,ctx);
  assert.equal(ratio.value,0);
  assert.equal(ratio.status,'SOURCE_REPORTED');
  assert.match(ratio.evidence[0].scope,/not a liquidity lock/i);
  const rendered=engine.formatCard('liquidity',{fields:{...raw,dexPairCount:market('1 DEX · 1 pairs',ctx)}},
   {id:ctx.network,chainId:ctx.chainId},ctx);
  assert.equal(rendered.status,'SOURCE_BACKED');
  assert.equal(rendered.fields.liquidityTurnover24h.value,0);
  assert.equal(format.display(0,'liquidityTurnover24h'),'0%');
  assert.equal(format.display(rendered.fields.burnAddressPct?.value??2.79,'burnAddressPct'),'2.79%');
 }
});
test('Legacy Arc DexScreener same exact-pool dataset recovers 24h turnover without invented pool URL',()=>{
 const ctx=context('arc'),proof={chainId:5042,address:ADDRESS,
  scope:'Exact-contract source-returned pool dataset, not an exhaustive chain-wide inventory.',
  checkedAt:'2026-10-28T18:25:48.095Z'};
 const mk=value=>({value,status:'MARKET_API_VERIFIED',dataState:'DATA_FOUND',source:'DexScreener',
  network:'arc',chainId:5042,evidence:[{...proof}]});
 const ok=metrics.liquidity({liquidityUsd:mk(49236.06),volume24h:mk(12396.70)},ctx);
 assert.equal(ok.dataState,'DATA_FOUND');
 assert.ok(Math.abs(ok.value-25.1781)<0.001);
 assert.equal(ok.evidence[0].sourceUrl,undefined,'No fake provider URI is inserted');
 assert.equal(metrics.liquidity({liquidityUsd:mk(100),volume24h:{...mk(10),
  evidence:[{...proof,checkedAt:'2026-10-28T18:25:49Z'}]}},ctx).dataState,'NOT_VERIFIED');
});

test('Positive source-scoped turnover is not a fake liquidity safety rating',()=>{
 const ctx=context('ethereum');
 const r=metrics.liquidity({liquidityUsd:market(2500,ctx),volume24h:market(10000,ctx)},ctx);
 assert.equal(r.value,400);
 assert.match(r.evidence[0].scope,/not.*investment safety/i);
});
test('Non-comparable markets, zero reserves, missing volume and false source identities stay unverified',()=>{
 const ctx=context(),a=market(1000,ctx),v=market(200,ctx);
 const bad=[
  {liquidityUsd:a,volume24h:{...v,source:'Other provider'}},
  {liquidityUsd:a,volume24h:market(200,ctx,{timestamp:'2026-10-27T16:30:00Z'})},
  {liquidityUsd:a,volume24h:market(200,ctx,{url:'https://another.example/market'})},
  {liquidityUsd:a,volume24h:{...v,evidence:[{...v.evidence[0],address:OTHER}]}},
  {liquidityUsd:market(0,ctx),volume24h:v},
  {liquidityUsd:a,volume24h:market(-1,ctx)},
  {liquidityUsd:a,volume24h:{...v,dataState:'NOT_VERIFIED',value:null}},
  {liquidityUsd:{...a,network:'ethereum'},volume24h:v},
  {liquidityUsd:a,volume24h:{...v,evidence:[{...v.evidence[0],fetchedAt:undefined}]}},
 ];
 for(const fields of bad)assert.equal(metrics.liquidity(fields,ctx).dataState,'NOT_VERIFIED');
});
