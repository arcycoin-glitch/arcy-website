'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const bridge=require('../search/server/lib/arc-legacy-evidence');
const ADDRESS='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const evidence={source:'Sourcify',address:ADDRESS,block:'0xabc',sourceDigest:'f'.repeat(64)};
const field=(value,status='VERIFIED')=>({value,status,dataState:'DATA_FOUND',
 source:'Arc RPC + Sourcify',evidence:[evidence]});
test('Original Arc contract authority and taxes map into exact-chain new cards',()=>{
 const result=bridge.contract({contractFields:{
  buyTax:field(3,'ONCHAIN_VERIFIED'),sellTax:field(3,'ONCHAIN_VERIFIED'),
  mint:field(true),ownerAdmin:field(true),
  proxyUpgradeable:{...field('0x'+'a'.repeat(40)),upgradeable:field(true)}
 }},ADDRESS);
 assert.equal(result.tradingTaxes.value,'Buy 3% · Sell 3%');
 assert.equal(result.tradingTaxes.chainId,5042);
 assert.equal(result.mintCapability.value,true);
 assert.equal(result.ownerAdmin.value,true);
 assert.match(result.contractArchitecture.value,/Observed proxy/);
 assert.equal(result.tradingTaxes.evidence.some(x=>x.address===ADDRESS),true);
});
test('No tax or LP lock guesses from incomplete issuer and custody evidence',()=>{
 const values=bridge.contract({contractFields:{
  buyTax:field(3,'ONCHAIN_VERIFIED'),
  sellTax:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED'}
 }},ADDRESS);
 assert.equal(values.tradingTaxes.dataState,'NOT_VERIFIED');
 assert.equal(bridge.liquidity({lpStatus:field('LOCKED')},ADDRESS).dataState,'NOT_VERIFIED');
 assert.equal(bridge.liquidity({lpStatus:field('BURNED','ONCHAIN_VERIFIED')},ADDRESS).value,'BURNED');
 assert.equal(bridge.liquidity({lpStatus:field('UNLOCKED','ONCHAIN_VERIFIED')},ADDRESS).value,'UNLOCKED');
 assert.equal(bridge.liquidity({lpStatus:field('UNLOCKED (POSITION)','ONCHAIN_VERIFIED')},ADDRESS).value,'UNLOCKED (POSITION)');
});
test('Legacy circulation requires original source evidence and exact Arc identity',()=>{
 const result=bridge.circulation({field:field(950000,'MARKET_API_VERIFIED')},ADDRESS);
 assert.equal(result.value,950000);
 assert.equal(result.chainId,5042);
 assert.equal(bridge.circulation({field:{...field(900000),source:''}},ADDRESS).dataState,'NOT_VERIFIED');
 assert.equal(bridge.circulation({field:field(950000)},'0x'+'z'.repeat(40)).dataState,'NOT_VERIFIED');
});
test('Only original reconciled COMPLETE holder snapshots are admitted',()=>{
 const holderNames=['holderCount','largestWalletPct','top10Pct','top20Pct'];
 const now=Date.parse('2026-10-11T19:00:00Z');
 const data={coverage:{complete:true},snapshot:{completedAt:new Date(now-3600000).toISOString()},
  fields:Object.fromEntries(holderNames.map((name,i)=>
  [name,field(i===0?1495:(i+1)*2,'ONCHAIN_VERIFIED')]))};
 const good=bridge.holders(data,ADDRESS,{now});
 assert.equal(good.holderCount.value,1495);
 assert.equal(good.top20Pct.dataState,'DATA_FOUND');
 const unsafe=bridge.holders({...data,coverage:{complete:false}},ADDRESS,{now});
 assert.equal(unsafe.holderCount.dataState,'NOT_VERIFIED');
 assert.equal(unsafe.top20Pct.dataState,'NOT_VERIFIED');
 const archival=bridge.holders({...data,snapshot:{completedAt:'2026-10-02T10:44:08.667Z'}},
  ADDRESS,{now});
 assert.equal(archival.holderCount.dataState,'DATA_FOUND');
 assert.equal(archival.holderCount.freshness.state,'LAST_VERIFIED');
 assert.equal(archival.top20Pct.status,'HISTORICAL_ONCHAIN_VERIFIED');
 assert.match(archival.top20Pct.reason,/2026-10-02/);
});
test('Search legacy bridge allows only known Arc read-only evidence routes, never worker actions',async()=>{
 const request=async(req,res)=>{
  assert.equal(req.method,'GET');
  assert.equal(req.query.address,ADDRESS);
  return res.status(200).json({ok:true,chainId:5042,address:ADDRESS,
   fields:{totalSupply:field('1000000')}});
 };
 const output=await bridge.callOriginal('holders',ADDRESS,{},request);
 assert.equal(output.fields.totalSupply.value,'1000000');
 const market=await bridge.callOriginal('market',ADDRESS,{},request);
 assert.equal(market.chainId,5042);
 const liquidity=await bridge.callOriginal('liquidity',ADDRESS,{},request);
 assert.equal(liquidity.address,ADDRESS);
 await assert.rejects(()=>bridge.callOriginal('holderrefresh',ADDRESS,{},request),/Invalid Arc/);
});
