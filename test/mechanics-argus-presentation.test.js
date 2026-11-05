'use strict';
// 2026-11-05 audit: ARGUS showed "Mint Capability: FALSE" (other reviewed tokens: "NONE DETECTED ✓"), and its reviewed
// on-chain currentTaxes()/graduated() rates were relabelled SOURCE_REPORTED, so the page did not count the row although the
// underlying class was ON_CHAIN_VERIFIED_UNITS. Values are never changed or invented here.
const test=require('node:test'),assert=require('node:assert/strict');
const fmt=require('../search/format.js'),legacy=require('../search/server/lib/arc-legacy-evidence'),policy=require('../search/mechanics-policy');
const A='0x'+'e'.repeat(40),block='0x1c534df';
const rate=(value,status)=>({value,status,dataState:'DATA_FOUND',source:'Sourcify',unit:'percent',evidence:[{source:'Sourcify',method:'currentTaxes() / graduated()',address:A,block,chainId:5042}]});

test('mint absence boolean renders with the shared wording; other booleans and keys are untouched',()=>{
 assert.equal(fmt.display(false,'mintCapability'),'NONE DETECTED ✓');assert.equal(fmt.full(false,'mintCapability'),'NONE DETECTED ✓');
 assert.equal(fmt.display(true,'mintCapability'),'TRUE','a detected mint is never rendered as absence');
 assert.equal(fmt.display(false,'ownerAdmin'),'FALSE');assert.equal(fmt.display(false,'tradingTaxes'),'FALSE');
});

test('both reviewed on-chain unit rates keep ON_CHAIN_VERIFIED_UNITS; the page now counts the complete row',()=>{
 const f=legacy.contract({contractFields:{buyTax:rate(1,'ON_CHAIN_VERIFIED_UNITS'),sellTax:rate(1,'ON_CHAIN_VERIFIED_UNITS'),transferTax:rate(0,'VERIFIED_SOURCE')}},A).tradingTaxes;
 assert.equal(f.value,'Buy 1% · Sell 1% · Transfer 0%','value unchanged');assert.equal(f.status,'ON_CHAIN_VERIFIED_UNITS');
 const card={fields:{tradingTaxes:f}};
 assert.equal(policy.assess(card,{chainId:5042,network:'arc',address:A,block}).rows[0],true);
});

test('any weaker or mixed class keeps the conservative SOURCE_REPORTED label; a missing rate is never filled',()=>{
 for(const [b,s] of [['ON_CHAIN_VERIFIED_UNITS','VERIFIED_SOURCE'],['SOURCE_REPORTED','ON_CHAIN_VERIFIED_UNITS'],['GETTER_REPORTED','GETTER_REPORTED']]){
  const f=legacy.contract({contractFields:{buyTax:rate(1,b),sellTax:rate(1,s),transferTax:rate(0,'VERIFIED_SOURCE')}},A).tradingTaxes;
  assert.equal(f.status,'SOURCE_REPORTED',b+'/'+s);
 }
 const missing=legacy.contract({contractFields:{buyTax:rate(1,'ON_CHAIN_VERIFIED_UNITS'),sellTax:{value:null,status:'NOT_VERIFIED',dataState:'NOT_VERIFIED'}}},A).tradingTaxes;
 assert.equal(missing.dataState,'NOT_VERIFIED');assert.equal(missing.value,null);
});
