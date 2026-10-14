'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const logos=require('../search/server/lib/search-logo');
test('AAVE BAT CRV have exact-network local icons',()=>{
const assets=[['0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9','aave'],['0x0d8775f648430679a709e98d2b0cb6250d2887ef','bat'],['0xd533a949740bb3306d119cc777fa900ba034cd52','crv']];
for(const [address,name] of assets){assert.equal(logos.localLogo('ethereum',address),'/search/assets/token-icons/'+name+'.svg');assert.equal(logos.localLogo('arc',address),null);}
});
