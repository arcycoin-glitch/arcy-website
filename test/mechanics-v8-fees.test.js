'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ledger,strengthen}=require('../search/server/lib/mechanics-v8-fees');
const {reviewed}=require('../lib/mechanics-hook');
const make=x=>'0x'+x.repeat(40),address=make('1'),block='0xf000',
 ctx={network:'arc',address,block,chainId:5042,provider:'RPC Test'};
const subject={address,block,chainId:5042};
const hook={...subject,hook:make('2'),poolManager:make('3'),poolId:'0x'+'a'.repeat(64),
 hookSourceDigest:reviewed.hook,portalSourceDigest:reviewed.portal,runtimeMatch:'exact_match',
 baseBuyBps:'100',baseSellBps:'120',antiSnipeBps:'20',lpFeeMillionths:'3000'};
test('pool and hook observations remain separate; unknown route supplies no invented gas or router fee',()=>{
 const r=ledger({status:'SOURCE_REPORTED',value:'Buy 1.2% · Sell 1.4% · Transfer 0%',evidence:[hook]},ctx);
 assert.deepEqual(r.POOL_SWAP_FEE.value,{rate:'3000',denominator:'1000000'});
 assert.equal(r.HOOK_FEE.value.ordinaryBuy,'120');assert.equal(r.HOOK_FEE.value.ordinarySell,'140');
 for(const type of ['TOKEN_CONTRACT_TAX','DEX_PROTOCOL_FEE','ROUTER_FEE','AGGREGATOR_FEE','GAS','SLIPPAGE'])assert.equal(r[type].verificationStatus,'UNKNOWN');
 assert.equal(ledger({evidence:[{...hook,block:'0xe000'}]},ctx).HOOK_FEE.verificationStatus,'UNKNOWN');
 const conflict=ledger({evidence:[hook,{...hook,lpFeeMillionths:'999'}]},ctx);
 assert.equal(conflict.HOOK_FEE.verificationStatus,'CONFLICTED');
 assert.equal(conflict.POOL_SWAP_FEE.observations.length,2);
});
test('conditional token sell surcharge is not an all-route rate or a pool fee',()=>{
 const e={...subject,feeMechanism:'ARGUS_V3_TOKEN_TAX',method:'currentTaxes() / graduated()',
  sourceDigest:'c96f888a58e671d77378eddde2e6fb195bea44201ab50006478377d312156ba6',pool:make('2'),implementation:make('3'),
  buyBps:'100',sellBps:'120',configuredBuyBps:'100',configuredSellBps:'120',graduated:true};
 const r=ledger({evidence:[e]},ctx);
 assert.equal(r.TOKEN_CONTRACT_TAX.value.sellSurchargeCap,'REMAINING_SELLER_BALANCE');
 assert.equal(r.TOKEN_CONTRACT_TAX.verificationStatus,'PARTIALLY_VERIFIED');
 assert.equal(r.POOL_SWAP_FEE.verificationStatus,'UNKNOWN');
 assert.equal(ledger({evidence:[{...e,graduated:false}]},ctx).TOKEN_CONTRACT_TAX.verificationStatus,'UNKNOWN');
});
test('transfer-only strengthening requires matching source, block and direct runtime evidence',()=>{
 const original={...subject,sourceDigest:'a'.repeat(64)};
 const cand={...original,coverage:'TOKEN_TAX_ALL_TRANSFERS',tokenTaxScope:'TOKEN_CONTRACT_ONLY',
  sourceBoundNonDelegatingRuntime:true,observationStatus:'VERIFIED_SOURCE_AND_STATE',observationValue:'Buy 0% · Sell 0% · Transfer 0%'};
 const wrap=p=>({fields:{tradingTaxes:{value:'Transfer 0% · DEX/hook fees NOT VERIFIED',status:'VERIFIED_SOURCE',evidence:[original,p]}}});
 assert.equal(strengthen(wrap(cand),ctx).fields.tradingTaxes.value,cand.observationValue);
 for(const p of [{...cand,block:'0xef'},{...cand,sourceBoundNonDelegatingRuntime:false},{...cand,sourceDigest:'b'.repeat(64)}]){
  const card=wrap(p);assert.equal(strengthen(card,ctx),card);
 }
});
