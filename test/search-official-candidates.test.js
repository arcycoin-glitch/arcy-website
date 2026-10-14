'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const identity=require('../search/server/lib/token-identity');
const FLOKI='0xcf0c122c6b73ff809c693db761e7baebe62b6a2e';
const ARC_USDC='0x3600000000000000000000000000000000000000';
const ARCARG='0x7d10b4331a990017938d66542f43fa4a72aacb73';
test('Official issuer records are exact chain plus contract; no ticker-based verification',()=>{
 const f=identity.verified('ethereum',FLOKI);
 assert.equal(f.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(f.issuer,'Floki');
 assert.equal(f.proofUrl,'https://floki.com/');
 assert.equal(identity.verified('arc',FLOKI),null);
 assert.equal(identity.verified('ethereum','0x'+'f'.repeat(40)),null);
 const circle=identity.verified('arc',ARC_USDC);
 assert.equal(circle.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(circle.issuer,'Circle');
 assert.equal(identity.verified('ethereum',ARC_USDC),null);
 const argus=identity.verified('arc',ARCARG);
 assert.equal(argus.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(argus.issuer,'Argus');
 assert.equal(identity.verified('ethereum',ARCARG),null);
});
test('Exact FLOKI issuer match ranks first ahead of lookalike with same ticker',()=>{
 const fakes=[{network:'ethereum',chainId:1,address:'0x'+'a'.repeat(40),
  name:'FLOKI',symbol:'FLOKI',source:'DexScreener',logoUrl:'https://cdn.dexscreener.com/test.png'}];
 const ranked=identity.rank('ethereum','Floki',fakes);
 assert.equal(ranked[0].address,FLOKI);
 assert.equal(ranked[0].identity.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(ranked[0].identityVerified,true);
 assert.equal(ranked[1].identity.status,'NOT_VERIFIED');
 assert.equal(ranked[1].identityVerified,false);
});
test('Arc USDC official first-party source ranks ahead of similarly named candidates',()=>{
 const ranked=identity.rank('arc','USDC',[{network:'arc',chainId:5042,address:'0x'+'b'.repeat(40),
  name:'USD Coin',symbol:'USDC',source:'market'}]);
 assert.equal(ranked[0].address,ARC_USDC);
 assert.equal(ranked[0].identity.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(ranked[1].identity.status,'NOT_VERIFIED');
});
test('Arc ARGUS name search returns the first-party ARCARG contract without changing its ticker',()=>{
 const ranked=identity.rank('arc','ARGUS',[]);
 assert.equal(ranked.length,1);
 assert.equal(ranked[0].address,ARCARG);
 assert.equal(ranked[0].name,'angel of arc argus');
 assert.equal(ranked[0].symbol,'ARCARG');
 assert.equal(ranked[0].identity.status,'OFFICIAL_CONTRACT_MATCHED');
 assert.equal(Boolean(ranked[0].logoUrl),false);
});
