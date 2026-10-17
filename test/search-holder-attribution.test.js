'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {classify}=require('../search/server/lib/holder-attribution');
const a='0x'+'a'.repeat(40),b='0x'+'b'.repeat(40);
test('unknown whale stays unknown despite concentration',()=>{
 assert.equal(classify({network:'ethereum',chainId:1,address:a,sharePct:89}).role,'UNKNOWN');
});
test('zero and dead are custody, not verified issuer burns',()=>{
 for(const address of ['0x'+'0'.repeat(40),'0x'+'0'.repeat(36)+'dead']){
  const result=classify({network:'ethereum',chainId:1,address});
  assert.equal(result.role,'BURN_ADDRESS'); assert.match(result.scope,/NOT proof/);
 }
});
test('reject wrong network, wrong contract and unreviewed evidence',()=>{
 const proof={chainId:1,address:a,role:'VESTING',sourceType:'ISSUER_OFFICIAL',sourceUrl:'https://example.org/vesting',reviewed:true};
 assert.equal(classify({network:'arc',chainId:1,address:a,proof}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:b,proof}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:{...proof,reviewed:false}}).role,'UNKNOWN');
});
test('reject ticker-only, insecure URLs, forged burn claims',()=>{
 const p={chainId:1,address:a,role:'EXCHANGE_CUSTODY',sourceType:'VERIFIED_REGISTRY',sourceUrl:'http://example.org',reviewed:true};
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:p}).role,'UNKNOWN');
 assert.equal(classify({network:'ethereum',chainId:1,address:a,proof:{...p,sourceUrl:'https://example.org',role:'BURN_ADDRESS'}}).role,'UNKNOWN');
});
test('reviewed exact evidence yields role but not owner identity',()=>{
 const proof={chainId:1,address:a,role:'VESTING',sourceType:'ISSUER_OFFICIAL',sourceUrl:'https://example.org/vesting',reviewed:true};
 const result=classify({network:'ethereum',chainId:1,address:a,proof});
 assert.equal(result.role,'VESTING');assert.equal(result.verified,true);
 assert.match(result.scope,/does not establish ultimate beneficial ownership/);
});
