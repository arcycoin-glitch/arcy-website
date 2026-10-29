'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mine=require('../lib/radar-support'),chains=require('../search/server/lib/chains'),eth=require('../search/server/lib/eth');
test('radar-support chain/rpcUrl match search originals',()=>{
 for(const n of ['ethereum','arc','robinhood']){
  assert.equal(mine.chain(n).chainId,chains.chain(n).chainId);assert.equal(mine.chain(n).rpcEnv,chains.chain(n).rpcEnv);
  assert.equal(mine.rpcUrl(n,{}),chains.rpcUrl(n,{}));
  const env={[chains.chain(n).rpcEnv]:'https://x.example/k'};assert.equal(mine.rpcUrl(n,env),chains.rpcUrl(n,env));
 }
 for(const bad of ['ETHEREUM','nope',5])assert.throws(()=>mine.chain(bad));
 for(const url of ['http://evil.example','https://u:p@x.example','https://x.example/#h'])assert.throws(()=>mine.rpcUrl('arc',{ARC_RPC_URL:url}));
});
test('radar-support abiString matches the original',()=>{
 const word=s=>'0x'+Buffer.from(s).toString('hex').padEnd(64,'0');
 const dyn='0x'+'20'.padStart(64,'0')+'3'.padStart(64,'0')+Buffer.from('ABC').toString('hex').padEnd(64,'0');
 for(const v of [word('USDC'),dyn,'0x','zz',null,'0x1234'])assert.equal(mine.abiString(v),eth.abiString(v));
});
test('localLogo is optional and never throws',()=>{assert.equal(typeof mine.localLogo('arc','0x'+'1'.repeat(40)),'object');});
