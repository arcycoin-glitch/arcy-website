'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{measure}=require('../scripts/measure-mechanics-v6.cjs');
const address='0x'+'11'.repeat(20),token={network:'ethereum',address};
const row=f=>({chain:'ethereum',address,block:'0x10',ms:2,net:{rpc:1,sourcify:1},f});
test('fixed-cohort measurement never promotes transfer-only source findings to strict verified tax coverage',()=>{
 const before={rows:[row({})]},after={rows:[row({tradingTaxes:{ok:true,value:'Transfer 0% · DEX/hook fees NOT VERIFIED',cls:'SINGLE_SOURCE',status:'VERIFIED_SOURCE',evidence:[]},mintCapability:{ok:true,cls:'ON_CHAIN_VERIFIED',status:'VERIFIED_SOURCE_AND_STATE'}})]};
 const r=measure(before,after,[token]);
 assert.equal(r.fields.tradingTaxes.afterFound,1);assert.equal(r.fields.tradingTaxes.afterVerified,0);
 assert.equal(r.fields.mintCapability.afterVerified,1);assert.deepEqual(r.taxScope.after,{complete:0,partial:1});
 assert.equal(r.fields.ownerAdmin.expected,1);assert.equal(r.fields.ownerAdmin.remainingNotVerified,1);
 assert.equal(r.gains.find(g=>g.field==='tradingTaxes').gain,'SOURCE_BACKED_FINDING');
});
test('measurement refuses changed blocks and missing cohort members instead of shrinking the denominator',()=>{
 const before={rows:[row({})]},after={rows:[{...row({}),block:'0x11'}]};
 assert.throws(()=>measure(before,after,[token]),/different pinned block/);
 assert.throws(()=>measure(before,{rows:[]},[token]),/missing measured token/);
 assert.throws(()=>measure(before,before,[token,token]),/duplicate token identity/);
});
