'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const V=require('../search/server/lib/v4-tvl');
const Q=2n**96n;
test('V4-1 range math: full range at price 1 gives equal amounts; ranges above/below the price are single-sided',()=>{
 const L=10n**18n;let r=V.amounts([{tick:-887220,net:L},{tick:887220,net:-L}],{tick:0,sqrtPriceX96:Q});
 assert.ok(Math.abs(r.amount0Raw/1e18-1)<1e-6&&Math.abs(r.amount1Raw/1e18-1)<1e-6);assert.equal(r.activeLiquidity,L);
 r=V.amounts([{tick:60,net:L},{tick:120,net:-L}],{tick:0,sqrtPriceX96:Q});assert.ok(r.amount0Raw>0);assert.equal(r.amount1Raw,0);assert.equal(r.activeLiquidity,0n);
 r=V.amounts([{tick:-120,net:L},{tick:-60,net:-L}],{tick:0,sqrtPriceX96:Q});assert.equal(r.amount0Raw,0);assert.ok(r.amount1Raw>0);
});
test('V4-2 incomplete or negative tick sets are rejected',()=>{
 assert.throws(()=>V.amounts([{tick:-60,net:5n}],{tick:0,sqrtPriceX96:Q}),{code:'V4_TICK_SET_INCOMPLETE'});
 assert.throws(()=>V.amounts([{tick:-60,net:-5n},{tick:60,net:5n}],{tick:0,sqrtPriceX96:Q}),{code:'V4_TICK_LIQUIDITY_NEGATIVE'});
});
test('V4-3 multicall aggregate encoding round-trips variable-length calldata',()=>{
 const enc=V.encodeAggregate([{to:'0x'+'a'.repeat(40),data:'0x1c7ccb4c'+'00'.repeat(64)},{to:'0x'+'b'.repeat(40),data:'0xfa6793d5'+'11'.repeat(32)}]);
 assert.ok(enc.startsWith('0x252dba42'));assert.equal((enc.length-10)%64,0);
 const w=n=>BigInt(n).toString(16).padStart(64,'0');
 const ret='0x'+w(99)+w(64)+w(2)+w(64)+w(128)+w(32)+w(7)+w(32)+w(9);
 assert.deepEqual(V.decodeAggregate(ret,2),['0x'+w(7),'0x'+w(9)]);
 assert.throws(()=>V.decodeAggregate(ret,3),{code:'V4_MULTICALL_MALFORMED'});
});
test('V4-4 custom-accounting hooks fail closed before any read; tick scan bounded by spacing',async()=>{
 const key={currency0:'0x'+'0'.repeat(40),currency1:'0x'+'1'.repeat(40),fee:3000,tickSpacing:60,hooks:'0x'+'4'.repeat(39)+'4'};
 await assert.rejects(()=>V.poolPrincipal({call:async()=>{throw Error('no read');},getCode:async()=>{throw Error('no read');},stateView:'0x'+'5'.repeat(40),poolId:'0x'+'6'.repeat(64),key,tick:0,sqrtPriceX96:Q}),{code:'V4_HOOK_CUSTOM_ACCOUNTING'});
 assert.deepEqual(V.wordRange(60),[-58,57]);assert.ok(V.wordRange(1)[1]-V.wordRange(1)[0]+1>640,'tickSpacing 1 exceeds the scan budget');
});
