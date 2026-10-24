'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const schema=require('../search/server/schema');
const browserSchema=require('../search/schema');
const checks=require('../search/server/lib/supply-insights');
const engine=require('../search/server/lib/data-engine');
const address='0x'+'a'.repeat(40),block='0x123';
const base=(network,chainId)=>({network,chainId,address,block,totalSupplyRaw:'1000000000000000000000',token:{decimals:18}});
const unknown=network=>checks.baseline(network);
const fact=(value,network='arc',chainId=5042)=>({value,dataState:'DATA_FOUND',status:'SOURCE_REPORTED',source:'Verified fixture',
 network,chainId,evidence:[{address,network,chainId,block,method:'contract-exact fixture'}]});
test('existing Search second-page supply card has exactly four requested fields, with no extra card',()=>{
 assert.deepEqual(browserSchema,schema);
 assert.equal(schema.length,5);
 assert.equal(schema.reduce((n,card)=>n+card.fields.length,0),20);
 const supply=schema.find(card=>card.id==='supply');
 assert.deepEqual(supply.fields,[['lockedSupply','Locked Supply'],['unlockedSupply','Unlocked Supply'],['verifiedBurned','Verified Burned'],['nextUnlock','Next Unlock']]);
 const html=fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
 assert.match(html,/id="deepResearch"/);
 assert.match(html,/id="cards" class="grid"/);
 assert.match(html,/spec.id!=='supply'\)missingRows.push\(row\)/);
 assert.match(html,/present===0&&spec.id!=='supply'\)withoutEvidence.push\(section\)/);
 assert.doesNotMatch(html,/href="\/research\/unlock-supply-lab\.html"/);
});
test('missing source coverage never becomes fabricated locked, unlocked or burned quantities',()=>{
 for(const [network,id] of [['arc',5042],['ethereum',1],['robinhood',4663]]){
  const fields=unknown(network);
  for(const key of ['lockedSupply','unlockedSupply','verifiedBurned','nextUnlock']){
   assert.equal(fields[key].value,null);
   assert.equal(fields[key].status,'NOT_VERIFIED');
   assert.equal(fields[key].network,network);
   assert.equal(fields[key].chainId,id);
  }
 }
});
test('exactly known source facts remain separate from 20 checks and legacy quick supply facts',()=>{
 const fields={...unknown('arc'),verifiedBurned:fact('0'),nextUnlock:fact('2099-02-01T00:00:00Z'),
  totalSupply:fact('1000000'),burnAddressBalance:fact('200000'),burnAddressPct:fact(20)};
 const card=engine.formatCard('supply',{fields}, {id:'arc',chainId:5042},base('arc',5042));
 assert.deepEqual(Object.keys(card.fields),['lockedSupply','unlockedSupply','verifiedBurned','nextUnlock']);
 assert.equal(card.fields.verifiedBurned.value,'0');
 assert.equal(card.fields.lockedSupply.value,null);
 assert.equal(card.context.totalSupply.value,'1000000');
 assert.equal(card.context.burnAddressBalance.value,'200000');
 assert.equal(card.context.burnAddressPct.value,20);
 assert.equal(card.status,'PARTIAL_EVIDENCE');
});
test('source-reported date must be future and exact; invalid or missing proof stays unknown',()=>{
 assert.equal(checks.eventTime('2020-01-01T00:00:00Z'),null);
 assert.equal(checks.eventTime('2099-02-31T00:00:00Z'),null,'calendar rollovers are invalid');
 const future='2099-03-12T00:00:00Z';
 assert.equal(checks.sourceSchedule('arc',address,{value:{date:future,amount:'150000'},dataState:'DATA_FOUND',status:'ONCHAIN_VERIFIED',evidence:[{source:'Exact vesting getter'}]},'Vesting','Verified scoped funded event').value,future);
 assert.equal(checks.sourceSchedule('arc',address,{value:{date:future,amount:'150000'},dataState:'DATA_FOUND',status:'ONCHAIN_VERIFIED',evidence:[]},'Vesting','Missing proof'),null);
 assert.equal(checks.sourceSchedule('arc',address,{value:{date:'2020-01-01T00:00:00Z',amount:'150000'},dataState:'DATA_FOUND',status:'ONCHAIN_VERIFIED',evidence:[{}]},'Vesting','Expired'),null);
});
test('unsupported contract identity fails closed before reading chain-specific sources',async()=>{
 await assert.rejects(()=>checks.inspect({network:'arc',base:base('ethereum',1)}),/identity mismatch/);
 assert.deepEqual(Object.keys(await checks.inspect({network:'robinhood',base:base('robinhood',4663)})),['lockedSupply','unlockedSupply','verifiedBurned','nextUnlock']);
});
test('nonburnable zero requires exact reviewed source and immutable nondelegating code',async()=>{
 const c=require('../search/server/lib/arc-rpc');
 const review=require('../lib/verified-source');
 const runtime=require('../lib/mechanics-runtime');
 const old={rpc:c.rpc,lookup:review.lookup,nonDelegating:runtime.nonDelegating};
 try{
  c.rpc=async(method,args)=>{assert.equal(method,'eth_getCode');assert.deepEqual(args,[address,block]);return '0x6000'};
  runtime.nonDelegating=()=>true;
  review.lookup=async()=>({dataState:'DATA_FOUND',address,runtimeMatch:'exact_match',profile:{id:'FIXED_SUPPLY_CAPPED_ERC20'},sourceDigest:'exact'});
  const good=await checks.arcNonburnableZero(base('arc',5042));
  assert.equal(good.value,'0');assert.equal(good.dataState,'DATA_FOUND');
  assert.equal(good.evidence[0].block,block);
  review.lookup=async()=>({dataState:'DATA_FOUND',address,runtimeMatch:'partial_match',profile:{id:'FIXED_SUPPLY_CAPPED_ERC20'}});
  assert.equal((await checks.arcNonburnableZero(base('arc',5042))).value,null);
  runtime.nonDelegating=()=>false;
  assert.equal((await checks.arcNonburnableZero(base('arc',5042))).value,null);
 }finally{c.rpc=old.rpc;review.lookup=old.lookup;runtime.nonDelegating=old.nonDelegating;}
});
