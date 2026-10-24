const {test}=require('node:test'),assert=require('node:assert/strict'),m=require('../ui-model');
const fact=(value,status='ON_CHAIN')=>({value,status,dataState:value===null?'NOT_VERIFIED':'DATA_FOUND',evidence:[{source:'Exact-contract test evidence',block:'0x1'}]});
const addr='0x'+'1'.repeat(40),unknown=fact(null,'NOT_VERIFIED');
test('five cards map evidence without exposing authority addresses',()=>{
 const fixtures={supply:{unlock:{ok:true,lockedSupply:fact('250000000','ONCHAIN_VERIFIED'),unlockedSupply:fact('750000000','ONCHAIN_VERIFIED'),verifiedBurned:fact('0','ONCHAIN_VERIFIED'),nextUnlock:{date:'2099-12-01',status:'ONCHAIN_VERIFIED'}}},whales:{ok:true,holderCount:245000,largestWalletPct:12.5,top10Pct:40,top20Pct:60},control:{ok:true,mint:fact(true),pause:fact(false,'NOT_DETECTED'),blacklist:fact(true),owner:fact(addr),admin:unknown,proxy:fact(addr),accessControl:unknown},liquidity:{ok:true,liquidityUsd:1700000,volume24h:847200,dexCount:3,pairCount:30,primaryPair:addr,lpStatus:fact(true,'DETECTED')},claims:{ok:true,statusId:'COMPARISONS_COMPLETE',counts:{checked:4,verified:2,mismatch:1,unverified:1}},mechanics:{ok:true,buyTax:fact(1),sellTax:fact(2),transferTax:fact(0),burnMechanism:fact(true),buybackAndBurn:fact(true)}};
 fixtures.mechanics=require('../lib/contract-summary').present({...fixtures.mechanics,...fixtures.control,buyTax:fact(1),sellTax:fact(2),transferTax:fact(0),burnMechanism:fact(true),buybackAndBurn:fact(true)});for(const [name,d]of Object.entries(fixtures)){if(name==='control')continue;const v=m.summarize(name,d);assert.equal(v.fields.length,4);assert.ok(v.fields.every(x=>x.dataState==='DATA_FOUND'));assert.ok(!v.fields.some(x=>x.text.includes(addr)));}
 assert.deepEqual(m.summarize('liquidity',fixtures.liquidity).fields.map(x=>x.text),['$1.7M','$847.2K','3 DEX · 30 pairs','DETECTED']);
 assert.equal(m.summarize('supply',fixtures.supply).fields[2].text,'0');assert.equal(m.summarize('mechanics',fixtures.mechanics).fields[0].text,'Buy 1% · Sell 2% · Transfer 0% · VERIFIED');
});
test('renamed or missing response fields are mapping failures, never successful NOT VERIFIED',()=>{const v=m.summarize('whales',{ok:true,holders:41,largestWallet:20,top10:50,top20:70});assert.ok(v.fields.every(x=>x.dataState==='FRONTEND_MAPPING_FAILED'));assert.equal(v.badge,'MAPPING FAILED');assert.equal(m.summarize('liquidity',{ok:true,volume24h:1,dexCount:1,pairCount:1,lpStatus:unknown}).fields[0].text,'NOT VERIFIED');});
test('no-data, source-failure and insufficient evidence stay distinguishable',()=>{for(const dataState of ['SOURCE_HAS_NO_DATA','SOURCE_API_FAILED','NOT_VERIFIED']){const v=m.summarize('whales',{ok:true,holderCount:null,largestWalletPct:null,top10Pct:null,top20Pct:null,dataState,reason:'test'});assert.ok(v.fields.every(x=>x.dataState===dataState));}const v=m.summarize('liquidity',{ok:false,dataState:'SOURCE_API_FAILED'});assert.equal(v.badge,'SOURCE/API FAILED');});
test('no supplied project statements is a stable app status, not four zero counters',()=>{const v=m.summarize('claims',{ok:true,statusId:'NO_CLAIMS_SUPPLIED',counts:{checked:null,verified:null,mismatch:null,unverified:null}});assert.equal(v.badge,'NO CLAIMS SUPPLIED');assert.deepEqual(v.fields.map(x=>x.text),['—','—','—','—']);});
test('legacy burn custody and circulation estimates cannot fabricate the four supply metrics',()=>{
 const v=m.summarize('supply',{supply:{ok:true,totalSupply:{amount:'100'},burnAddressBalance:{amount:'70'}},market:{ok:true,circulatingSupply:30},unlock:{ok:true,lockedSupply:{value:null,status:'NOT_VERIFIED',reasonCode:'INCOMPLETE'},unlockedSupply:{value:null,status:'NOT_VERIFIED'},verifiedBurned:{value:null,status:'NOT_VERIFIED'},nextUnlock:{date:null}}});
 assert.deepEqual(v.fields.slice(0,3).map(f=>f.text),['NOT VERIFIED','NOT VERIFIED','NOT VERIFIED']);
 assert.equal(v.fields[3].text,'NO SOURCE-REPORTED SCHEDULE');
});
test('failed unlock source cannot become a verified zero',()=>{
 const v=m.summarize('supply',{unlock:{ok:false,dataState:'SOURCE_API_FAILED',reasonCode:'RPC_FAILED'}});
 assert.ok(v.fields.slice(0,3).every(f=>f.text==='NOT VERIFIED'&&f.dataState==='SOURCE_API_FAILED'));
});
test('false zero, empty evidence and source-reported amounts do not qualify as independently verified supply metrics',()=>{
 for(const candidate of [{value:0,status:'ONCHAIN_VERIFIED',dataState:'DATA_FOUND',evidence:[]},{value:'0',status:'PROJECT_REPORTED',dataState:'DATA_FOUND',evidence:[{source:'project'}]},{value:'1e12',status:'ONCHAIN_VERIFIED',dataState:'DATA_FOUND',evidence:[{source:'RPC'}]}]){
  const v=m.summarize('supply',{unlock:{ok:true,lockedSupply:candidate,unlockedSupply:candidate,verifiedBurned:candidate,nextUnlock:{date:null}}});
  assert.ok(v.fields.slice(0,3).every(f=>f.text==='NOT VERIFIED'));
 }
});
test('partial liquidity responses never count a null USD total as evidence',()=>{
 const data={ok:true,dataState:'DATA_FOUND',liquidityUsd:null,volume24h:28130.07,dexCount:1,pairCount:4,lpStatus:unknown,fields:{liquidityUsd:{value:null,dataState:'NOT_VERIFIED',reasonCode:'INCOMPLETE_PAIR_LIQUIDITY',reason:'One returned pair lacks liquidity.'}}};
 const view=m.summarize('liquidity',data);assert.equal(view.fields[0].text,'NOT VERIFIED');assert.equal(view.fields[0].dataState,'NOT_VERIFIED');assert.equal(view.fields[0].reasonCode,'INCOMPLETE_PAIR_LIQUIDITY');assert.equal(view.fields[0].reason,'One returned pair lacks liquidity.');assert.equal(view.fields.filter(f=>f.dataState==='DATA_FOUND').length,2);assert.equal(view.fields[1].text,'$28.1K');assert.equal(view.fields[2].text,'1 DEX · 4 pairs');
 delete data.fields;assert.equal(m.summarize('liquidity',data).fields[0].dataState,'NOT_VERIFIED');data.liquidityUsd=0;assert.equal(m.summarize('liquidity',data).fields[0].text,'$0');assert.equal(m.summarize('liquidity',data).fields[0].dataState,'DATA_FOUND');
 for(const state of ['SOURCE_API_FAILED','SOURCE_HAS_NO_DATA']){data.liquidityUsd=null;data.fields={liquidityUsd:{dataState:state}};assert.equal(m.summarize('liquidity',data).fields[0].dataState,state);}
});
