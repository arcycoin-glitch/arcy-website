'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const issuer=require('../search/server/lib/issuer-supply-context');
const address=issuer.TOKEN;
const total='10000000000000000000000000000',block='0x10e';
const token={decimals:18};
const input={network:'ethereum',chainId:1,address,block,totalSupplyRaw:total,token};
const walletData='0x70a08231'+issuer.WALLET.slice(2).padStart(64,'0');
test('OND issuer disclosure adds pinned exact-contract custody proof, not circulating supply',async()=>{
 const expected=4422519707n*10n**18n;
 const v=await issuer.inspect({...input,rpcReader:async(method,args,options)=>{
  assert.equal(method,'eth_call');assert.equal(args[0].to,address);
  assert.equal(args[0].data,walletData);assert.equal(args[1],block);
  assert.equal(options.timeoutMs,2900);
  return '0x'+expected.toString(16).padStart(64,'0');
 }});
 assert.equal(v.observations[0].balance,'4422519707');
 assert.equal(v.observations[0].sourceUrl,issuer.OFFICIAL);
 assert.equal(v.observations[0].block,block);
 assert.equal(v.observations[0].wallet,issuer.WALLET);
 assert.equal(v.observations[0].kind,'ISSUER_DISCLOSED_WALLET_CURRENT_CUSTODY');
 assert.match(v.observations[0].limitation,/does not establish current locked amount/);
 assert(!('circulatingSupply' in v));
 assert(!('nextUnlock' in v));
});
test('no token-symbol fallback, foreign chain or invalid decimal/identity',async()=>{
 let calls=0;const rpcReader=async()=>{calls++;return '0x'+'0'.repeat(64)};
 const mutated=[
  {address:'0x'+'f'.repeat(40)},
  {chainId:5042},{network:'arc'},{block:'latest'},
  {token:{decimals:-1}},{token:{decimals:38}},{totalSupplyRaw:'-1'},
  {totalSupplyRaw:'0'}
 ];
 for(const patch of mutated)assert.equal(await issuer.inspect({...input,...patch,rpcReader}),null);
 assert.equal(calls,0);
});
test('empty, malformed, out-of-range or RPC timeout cannot yield supply information',async()=>{
 assert.equal(await issuer.inspect({...input,rpcReader:async()=>''}),null);
 assert.equal(await issuer.inspect({...input,rpcReader:async()=>'0xdead'}),null);
 assert.equal(await issuer.inspect({...input,rpcReader:async()=> '0x'+(BigInt(total)+1n).toString(16).padStart(64,'0')}),null);
 assert.equal(await issuer.inspect({...input,rpcReader:async()=>{throw Error('RPC offline')}}),null);
});
test('issuer note never changes four primary source-checked fields',()=>{
 const s=require('../search/server/schema');
 assert.deepEqual(s.find(x=>x.id==='supply').fields.map(([k])=>k),
 ['totalSupply','circulatingSupply','burnAddressBalance','nextUnlock']);
});
