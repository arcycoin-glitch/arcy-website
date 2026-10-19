'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspect}=require('../search/server/lib/market');
const token='0x'+'a'.repeat(40),block='0x123';
const verified={value:5,status:'ON_CHAIN_ORACLE',dataState:'DATA_FOUND',source:'Chainlink',evidence:[{block}],network:'ethereum',chainId:1};
test('oracle fills price when DEX fails, without inventing liquidity',async()=>{
 const report=await inspect(token,block,{dexInspect:async()=>{throw Error('provider 403')},oracleInspect:async()=>({priceUsd:verified})});
 assert.equal(report.fields.priceUsd.value,5);
 assert.equal(report.fields.liquidityUsd.dataState,'NOT_VERIFIED');
 assert.equal(report.fields.volume24h.dataState,'NOT_VERIFIED');
});
test('valid DEX price takes precedence over reference oracle',async()=>{
 const quote={...verified,value:7,source:'Authorized DEX'};
 const result=await inspect(token,block,{dexInspect:async()=>({priceUsd:quote}),oracleInspect:async()=>({priceUsd:verified})});
 assert.equal(result.fields.priceUsd.value,7);
});
test('oracle failure never discards otherwise valid DEX fields',async()=>{
 const liquidity={...verified,value:900};
 const result=await inspect(token,block,{dexInspect:async()=>({liquidityUsd:liquidity}),oracleInspect:async()=>{throw Error('rpc unavailable')}});
 assert.equal(result.fields.liquidityUsd.value,900);
});
test('neither source available returns only nonverified defaults',async()=>{
 const r=await inspect(token,block,{dexInspect:async()=>{throw Error('403')},oracleInspect:async()=>{throw Error('timeout')}});
 assert.equal(r.fields.priceUsd.dataState,'NOT_VERIFIED');
});
test('both sources are started before either resolves',async()=>{
 let resolveDex,resolveOracle,started=0;
 const task=inspect(token,block,{dexInspect:()=>{started++;return new Promise(r=>resolveDex=r)},oracleInspect:()=>{started++;return new Promise(r=>resolveOracle=r)}});
 await Promise.resolve();
 assert.equal(started,2);
 resolveDex({});resolveOracle({priceUsd:verified});
 assert.equal((await task).fields.priceUsd.value,5);
});
