'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chain,identity,verifiedField}=require('../lib/search-chain-identity');
test('accepts only supported chain IDs',()=>{
 assert.equal(chain(5042).key,'arc');
 assert.equal(chain('1').key,'ethereum');
 assert.equal(chain('4663').key,'robinhood');
 for(const bad of [null,undefined,'',0,56,'4663x','01',{},-1])assert.equal(chain(bad),null);
});
test('isolates identical addresses across chains',()=>{
 const address='0x'+'A'.repeat(40);
 const arc=identity(5042,address),eth=identity(1,address),rh=identity(4663,address);
 assert.equal(arc.address,address.toLowerCase());
 assert.equal(new Set([arc.key,eth.key,rh.key]).size,3);
 assert.equal(identity(4663,'0x123'),null);
 assert.equal(identity(999,address),null);
});
test('never promotes missing or unsupported evidence',()=>{
 assert.equal(verifiedField(12,'RPC',[],new Date().toISOString()).status,'NOT_VERIFIED');
 assert.equal(verifiedField(null,'RPC',[{block:'0x1'}],new Date().toISOString()).status,'NOT_VERIFIED');
 assert.equal(verifiedField(12,'RPC',[{block:'0x1'}],'bad').status,'NOT_VERIFIED');
 const good=verifiedField(0,'RPC',[{block:'0x1'}],new Date().toISOString());
 assert.equal(good.status,'ONCHAIN_VERIFIED');
 assert.equal(good.value,0);
});
