'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {outcome}=require('../scripts/search-coverage-outcome.cjs');

test('coverage outcome separates verified, source-only, stale, incomplete and unavailable data',()=>{
 assert.equal(outcome({field:{dataState:'DATA_FOUND'},reportAvailable:true,evidenceClass:'ON_CHAIN_VERIFIED'}),'VERIFIED');
 assert.equal(outcome({field:{dataState:'DATA_FOUND'},reportAvailable:true,evidenceClass:'CROSS_VERIFIED'}),'VERIFIED');
 assert.equal(outcome({field:{dataState:'DATA_FOUND'},reportAvailable:true,evidenceClass:'SINGLE_SOURCE'}),'SINGLE_SOURCE');
 assert.equal(outcome({field:{dataState:'DATA_FOUND'},reportAvailable:true,evidenceClass:'STALE'}),'STALE');
 assert.equal(outcome({field:{dataState:'NOT_VERIFIED'},reportAvailable:true,cardStatus:'PARTIAL_EVIDENCE'}),'INCOMPLETE');
 assert.equal(outcome({field:{dataState:'SOURCE_API_FAILED'},reportAvailable:true}),'UNAVAILABLE');
 assert.equal(outcome({reportAvailable:false}),'UNAVAILABLE');
 assert.equal(outcome({reportAvailable:true,cardStatus:'SOURCE_BACKED'}),'INCOMPLETE');
});
