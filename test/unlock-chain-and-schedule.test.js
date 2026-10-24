const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../lib/core');
const model=require('../ui-model');
const address='0x'+'a'.repeat(40);
const response={setHeader(){},status(){return this},json(data){return data}};
test('Ethereum and Robinhood requests cannot accidentally use Arc-only unlock proof',async()=>{
 const original=core.context;let called=false;
 core.context=async()=>{called=true;throw Error('Wrong chain RPC must not execute');};
 try{
  for(const chainId of ['1','4663','ethereum','robinhood']){
   const result=await require('../api/unlock')({query:{address,chainId}},response);
   assert.equal(result.reasonCode,'UNLOCK_CHAIN_NOT_SUPPORTED');
   assert.equal(result.verifiedBurned.value,null);
   assert.equal(result.lockedSupply.value,null);
   assert.equal(result.unlockedSupply.value,null);
   const ui=model.summarize('supply',{unlock:result});
   assert.equal(ui.fields[3].text,'CHAIN NOT SUPPORTED');
  }
  assert.equal(called,false);
 }finally{core.context=original;}
});
test('expired unlock dates are rejected rather than displayed as a future event',()=>{
 const unknown={value:null,status:'NOT_VERIFIED'};
 const r=model.summarize('supply',{unlock:{ok:true,lockedSupply:unknown,unlockedSupply:unknown,verifiedBurned:unknown,nextUnlock:{date:'2020-01-01',status:'ONCHAIN_VERIFIED'}}});
 assert.equal(r.fields[3].dataState,'FRONTEND_MAPPING_FAILED');
 assert.notEqual(r.fields[3].text,'2020-01-01');
});
test('verified next-unlock metadata preserves source distinction and supported amount',()=>{
 const unknown={value:null,status:'NOT_VERIFIED'};
 const r=model.summarize('supply',{unlock:{ok:true,lockedSupply:unknown,unlockedSupply:unknown,verifiedBurned:unknown,nextUnlock:{date:'2099-03-01T00:00:00Z',amount:'2000000',status:'OFFICIAL_DOCUMENTATION',evidence:[{source:'Contract-linked project metadata'}]}}});
 assert.equal(r.fields[3].sourceScope,'PROJECT REPORTED');
 assert.equal(r.fields[3].amount,'2M');
});
