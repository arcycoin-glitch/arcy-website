'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {combineDiscoveryResults}=require('../search/server/lib/multichain-service');
const ADDR='0x39dbed3a2bd333467115de45665cc57f813c4571';
const OTHER='0x'+'1'.repeat(40);
function source(network,id,address=ADDR,identity='NOT_VERIFIED'){
 return {ok:true,network,chainId:id,matches:[{
  network,chainId:id,address,name:'Pons',symbol:'PONS',
  identity:{status:identity},source:'chain-scoped market index'
 }],providerError:false};
}
const fulfilled=value=>({status:'fulfilled',value});
test('one query finds Robinhood PONS even when Arc is empty and Ethereum explorer errors',()=>{
 const out=combineDiscoveryResults('PONS',[
  fulfilled({...source('arc',5042),matches:[]}),
  {status:'rejected',reason:Error('Explorer temporarily unavailable')},
  fulfilled(source('robinhood',4663))
 ]);
 assert.equal(out.network,'all');
 assert.equal(out.chainId,null);
 assert.equal(out.matches.length,1);
 assert.equal(out.matches[0].address,ADDR);
 assert.equal(out.matches[0].network,'robinhood');
 assert.deepEqual(out.counts,{arc:0,ethereum:0,robinhood:1});
 assert(out.unavailableNetworks.includes('ethereum'));
});
test('identical names and identical hexadecimal address on different chains are NOT coalesced',()=>{
 const out=combineDiscoveryResults('PONS',[
  fulfilled(source('arc',5042)),
  fulfilled(source('ethereum',1)),
  fulfilled({...source('robinhood',4663),matches:[...source('robinhood',4663).matches,
   ...source('robinhood',4663).matches]})
 ]);
 assert.equal(out.matches.length,3);
 assert.deepEqual(out.matches.map(x=>x.network),['arc','ethereum','robinhood']);
 assert.deepEqual(out.counts,{arc:1,ethereum:1,robinhood:1});
});
test('wrong chain id, foreign chain and malformed candidate addresses fail closed',()=>{
 const evil=source('arc',5042);
 evil.matches.push({network:'ethereum',chainId:5042,address:OTHER,symbol:'PONS'});
 evil.matches.push({network:'arc',chainId:1,address:OTHER,symbol:'PONS'});
 evil.matches.push({network:'arc',chainId:5042,address:'0xbroken',symbol:'PONS'});
 const out=combineDiscoveryResults('PONS',[fulfilled(evil),fulfilled(source('ethereum',1)),fulfilled(source('robinhood',4663))]);
 assert.equal(out.matches.length,3);
});
test('all three unavailable is an error, not a fabricated empty successful search',()=>{
 assert.throws(()=>combineDiscoveryResults('PONS',[0,1,2].map(()=>({status:'rejected',reason:Error('down')}))),/All network discovery/);
});
test('source candidates never become issuer verified because of a ticker match',()=>{
 const out=combineDiscoveryResults('PONS',[
  fulfilled({...source('arc',5042),matches:[]}),
  fulfilled({...source('ethereum',1),matches:[]}),
  fulfilled(source('robinhood',4663))
 ]);
 assert.equal(out.matches[0].identity.status,'NOT_VERIFIED');
});
test('existing unified search frontend code is valid JavaScript and both entrypoints use all networks by default',()=>{
 const file=fs.readFileSync(path.join(__dirname,'../search-upgrade.js'),'utf8');
 new vm.Script(file,{filename:'search-upgrade.js'});
 assert.match(file,/let selected='all'/);
 assert.match(file,/chain=.+encodeURIComponent\(selected\)/);
 const html=fs.readFileSync(path.join(__dirname,'../search/index.html'),'utf8');
 assert.match(html,/id="chain" value="all"/);
 assert.match(html,/data-chain="all"/);
 assert.match(html,/id="detailSearchChain"/);
 assert.match(html,/<option value="all">All networks<\/option>/);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 for(const [,script] of scripts)if(script.trim())new vm.Script(script,{filename:'search/index.html inline'});
});

test('previously live-indexed PONS remains findable on Robinhood when optional providers time out',()=>{
 const hints=require('../search/server/lib/prefix-catalog');
 const data=hints.discover('robinhood','PONS');
 assert.equal(data.length,1);
 assert.equal(data[0].address,ADDR);
 assert.equal(data[0].chainId,4663);
 assert.equal(data[0].identityVerified,false);
 assert.equal(data[0].registryMatched,false);
 assert.equal(hints.discover('arc','PONS').length,0);
});
