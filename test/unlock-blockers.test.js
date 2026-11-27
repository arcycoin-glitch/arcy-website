'use strict';
// Next Unlock blocker taxonomy (#77/#337): diagnostic only. A blocker never changes status/value and never means "no unlock exists".
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../search/server/lib/supply-insights');
const ENA='0x57e114b691db790c35207b2e685d4a43181e6061',RH='0x39dbed3a2bd333467115de45665cc57f813c4571';
test('Ethereum without a reviewed exact-contract schedule: NO_REVIEWED_CONTRACT_SCHEDULE, still NOT_VERIFIED, value null',async()=>{
 const r=await S.inspect({network:'ethereum',base:{address:ENA,network:'ethereum',chainId:1}});
 assert.equal(r.nextUnlock.status,'NOT_VERIFIED');assert.equal(r.nextUnlock.value,null);assert.equal(r.nextUnlock.reasonCode,'NO_VERIFIED_NEXT_UNLOCK');
 assert.equal(r.nextUnlock.blocker.category,'NO_REVIEWED_CONTRACT_SCHEDULE');assert.equal(r.nextUnlock.blocker.doesNotImplyNoUnlock,true);
});
test('Robinhood/Pons has no Next Unlock source adapter: reported as such, never as zero unlocks',async()=>{
 const r=await S.inspect({network:'robinhood',base:{address:RH,network:'robinhood',chainId:4663}});
 assert.equal(r.nextUnlock.blocker.category,'NO_SOURCE_ADAPTER_FOR_CHAIN');assert.equal(r.nextUnlock.value,null);
});
test('withBlocker only decorates NOT_VERIFIED fields; a found schedule is returned untouched',()=>{
 const found={value:'2026-12-01T00:00:00Z',status:'SOURCE_REPORTED',dataState:'DATA_FOUND'};
 assert.equal(S.withBlocker(found,'X'),found);assert.equal(S.withBlocker(null,'X'),null);
 const unk=S.baseline('ethereum').nextUnlock;assert.equal(S.withBlocker(unk,'Y').blocker.category,'Y');assert.equal(unk.blocker,undefined,'input is not mutated');
});
test('Arc: failed lookups are SOURCE_LOOKUP_FAILED, missing contract-linked sources are NO_CONTRACT_LINKED_SOURCE',async()=>{
 const Module=require('node:module'),path=require.resolve('../lib/unlock-sources');
 const original=require.cache[path];
 const stub=(vesting,documentation)=>{require.cache[path]={id:path,filename:path,loaded:true,exports:{vesting,documentation}};};
 try{
  stub(async()=>{throw new Error('rpc down');},async()=>({value:null,status:'NOT_VERIFIED',reasonCode:'NO_VERIFIED_SCHEDULE'}));
  let r=await S.arcNext({address:'0x'+'1'.repeat(40)});assert.equal(r.blocker.category,'SOURCE_LOOKUP_FAILED');
  stub(async()=>({value:null,status:'NOT_VERIFIED',reasonCode:'NO_CONTRACT_LINKED_VESTING_ADDRESSES'}),async()=>({value:null,status:'NOT_VERIFIED',reasonCode:'NO_VERIFIED_SCHEDULE'}));
  r=await S.arcNext({address:'0x'+'1'.repeat(40)});assert.equal(r.blocker.category,'NO_CONTRACT_LINKED_SOURCE');assert.equal(r.value,null);
 }finally{if(original)require.cache[path]=original;else delete require.cache[path];void Module;}
});
