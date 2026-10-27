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
 assert.deepEqual(supply.fields,[['totalSupply','Total Supply'],['circulatingSupply','Circulating Supply'],['burnAddressBalance','Burn Address Balance'],['nextUnlock','Next Unlock']]);
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
test('on-chain supply and burn-address custody are visible as primary metrics, without claiming actual burned supply',()=>{
 const fields={...unknown('arc'),verifiedBurned:fact('0'),nextUnlock:fact('2099-02-01T00:00:00Z'),
  totalSupply:fact('1000000'),burnAddressBalance:fact('200000'),burnAddressPct:fact(20)};
 const card=engine.formatCard('supply',{fields}, {id:'arc',chainId:5042},base('arc',5042));
 assert.deepEqual(Object.keys(card.fields),['totalSupply','circulatingSupply','burnAddressBalance','nextUnlock']);
 assert.equal(card.fields.totalSupply.value,'1000000');
 assert.equal(card.fields.burnAddressBalance.value,'200000');
 assert.equal(card.fields.circulatingSupply.dataState,'NOT_VERIFIED');
 assert.equal(card.fields.nextUnlock.value,'2099-02-01T00:00:00Z');
 assert.equal(card.context.totalSupply.value,'1000000');
 assert.equal(card.context.burnAddressBalance.value,'200000');
 assert.equal(card.context.burnAddressPct.value,20);
 assert.equal(card.status,'PARTIAL_EVIDENCE');
 assert.equal(Object.hasOwn(card.fields,'verifiedBurned'),false,'custody cannot be mislabeled as a burn event');
});
test('source-reported date must be future and exact; invalid or missing proof stays unknown',()=>{
 assert.equal(checks.eventTime('2020-01-01T00:00:00Z'),null);
 assert.equal(checks.eventTime('2099-02-31T00:00:00Z'),null,'calendar rollovers are invalid');
 const future='2099-03-12T00:00:00Z';
 assert.equal(checks.sourceSchedule('arc',address,{value:{date:future,amount:'150000'},dataState:'DATA_FOUND',status:'ONCHAIN_VERIFIED',evidence:[{source:'Exact vesting getter',address,chainId:5042}]},'Vesting','Verified scoped funded event').value,future);
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

test('new visible supply rows fail closed on a wrong contract or wrong on-chain block',()=>{
 const wrong=fact('123');wrong.evidence=[{address:'0x'+'b'.repeat(40),network:'arc',chainId:5042,block}];
 const stale=fact('10');stale.status='ON_CHAIN';stale.evidence=[{address,network:'arc',chainId:5042,block:'0x124'}];
 const fields={...unknown('arc'),totalSupply:wrong,circulatingSupply:fact('70'),burnAddressBalance:stale};
 const card=engine.formatCard('supply',{fields},{id:'arc',chainId:5042},base('arc',5042));
 assert.equal(card.fields.totalSupply.dataState,'NOT_VERIFIED');
 assert.equal(card.fields.burnAddressBalance.dataState,'NOT_VERIFIED');
 assert.equal(card.fields.circulatingSupply.value,'70');
});
