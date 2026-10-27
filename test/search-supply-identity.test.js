'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceSchedule}=require('../search/server/lib/supply-insights');
const address='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const record=evidence=>({dataState:'DATA_FOUND',status:'SOURCE_REPORTED',value:{date:'2099-03-12T00:00:00Z',amount:'12.000000000000000001'},evidence});
test('unlock normalization requires exact subject and rejects conflicting network, chain and token',()=>{
 const inspect=e=>sourceSchedule('arc',address,record(e),'Issuer','Scoped event');
 assert.equal(inspect([{address,chainId:5042}]).value,'2099-03-12T00:00:00Z');
 assert.equal(inspect([{source:'good sounding name'}]),null);
 for(const evidence of [[{address:other}],[{address,chainId:1}],[{address,network:'ethereum'}],[{address},{token:other,chainId:5042}],[{address:other,token:address}]])assert.equal(inspect(evidence),null);
 const r=inspect([{address,chainId:5042},{token:address,vestingContract:other,chainId:5042}]);assert.equal(r.evidence[0].eventAmount,'12.000000000000000001');
});

