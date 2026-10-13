'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const arc=require('../search/server/lib/arc-rpc');
const A='0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b';
const ZERO='0x0000000000000000000000000000000000000000';
const DEAD='0x000000000000000000000000000000000000dead';
const word=v=>'0x'+BigInt(v).toString(16).padStart(64,'0');
function mock({chain=5042,burn=200n,supply=1000n}={}){
 const calls=[];
 const core={
  CHAIN:chain,BURNS:[ZERO,DEAD],
  context:async address=>{calls.push(['context',address]);return {block:'0x2a',code:'0x6000'}},
  call:async(_address,method,block)=>{calls.push([method,block]);
   if(method==='0x18160ddd')return word(supply);
   if(method==='0x313ce567')return word(2n);
   if(method==='0x06fdde03'||method==='0x95d89b41')throw Error('optional metadata getter unavailable');
   if(method==='0x70a08231'+ZERO.slice(2).padStart(64,'0'))return word(0n);
   if(method==='0x70a08231'+DEAD.slice(2).padStart(64,'0'))return word(burn);
   throw Error('Unknown call '+method);
  },
  uint:h=>BigInt(h),
  string:()=>null,
  units:(value,decimal)=>{const s=value.toString().padStart(decimal+1,'0');return s.slice(0,-decimal)+'.'+s.slice(-decimal)}
 };
 return {core,calls};
}
test('original Arc fallback returns five-card compatible, chain-pinned source fields',async()=>{
 const m=mock();
 const v=await arc.inspectUsingLegacyCore(A,{core:m.core});
 assert.equal(v.address,A);assert.equal(v.network,'arc');assert.equal(v.chainId,5042);
 assert.equal(v.block,'0x2a');assert.equal(v.totalSupplyRaw,'1000');
 assert.equal(v.totalSupply,'10.00');assert.equal(v.burnAddressRaw,'200');
 assert.equal(v.burnAddressBalance,'2.00');
 assert.equal(v.token.decimals,2);assert.equal(v.token.name,null);
 assert.equal(v.rpcFallback,'ORIGINAL_ARC_READ_ONLY_PINNED_RPC');
 assert.ok(m.calls.slice(1).every(x=>x[1]==='0x2a'));
 const card=await require('../search/server/lib/arc-adapter').supply(v);
 assert.equal(card.fields.totalSupply.dataState,'DATA_FOUND');
 assert.equal(card.fields.burnAddressBalance.dataState,'DATA_FOUND');
 assert.equal(card.fields.burnAddressPct.dataState,'DATA_FOUND');
});
test('Arc fallback refuses wrong chain and contract inputs before sending calls',async()=>{
 const other=mock({chain:1});
 await assert.rejects(()=>arc.inspectUsingLegacyCore(A,{core:other.core}),/chain mismatch/);
 assert.equal(other.calls.length,0);
 const normal=mock();
 await assert.rejects(()=>arc.inspectUsingLegacyCore('USDC',{core:normal.core}),/Invalid Arc/);
 assert.equal(normal.calls.length,0);
});
test('Arc fallback with malformed burn evidence does not manufacture a burn value',async()=>{
 const tooLarge=mock({burn:2000n});
 const result=await arc.inspectUsingLegacyCore(A,{core:tooLarge.core});
 assert.equal(result.burnAddressBalance,null);
 assert.equal(result.burnAddressRaw,null);
 const card=await require('../search/server/lib/arc-adapter').supply(result);
 assert.equal(card.fields.burnAddressBalance.dataState,'NOT_VERIFIED');
 assert.equal(card.fields.burnAddressPct.dataState,'NOT_VERIFIED');
});
test('Arc source failure does not use another chain or missing contract as verified identity',async()=>{
 const m=mock();
 m.core.context=async()=>{throw Error('Wrong chain')};
 await assert.rejects(()=>arc.inspectUsingLegacyCore(A,{core:m.core}),/Wrong chain/);
});
