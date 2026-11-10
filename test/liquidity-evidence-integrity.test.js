'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const liquidity=require('../api/liquidity');

const token='0x'+'a'.repeat(40),quote='0x'+'b'.repeat(40),poolA='0x'+'1'.repeat(40),poolB='0x'+'2'.repeat(40);
const row=(pair,usd,volume=5)=>({chainId:'arc',dexId:'uniswap',pairAddress:pair,
 baseToken:{address:token},quoteToken:{address:quote},liquidity:{usd},volume:{h24:volume}});

test('Arc liquidity counts identical duplicate pool rows once and excludes conflicting duplicate observations',()=>{
 const first=row(poolA,100),second=row(poolB,50,3);
 const result=liquidity.aggregate([first,{...first,baseToken:{...first.baseToken}},row(poolA,900,5),second],token);
 assert.equal(result.conflictingPairCount,1);
 assert.deepEqual(result.pairs.map(p=>p.pairAddress),[poolB]);
 assert.equal(result.pairCount,1);
 assert.equal(result.liquidityUsd,50);
 assert.equal(result.volume24h,3);
 assert.match(result.methodology,/conflicting duplicate pool observations are excluded/i);
});

test('Arc liquidity does not treat one conflicting pool observation as a valid source total',()=>{
 const result=liquidity.aggregate([row(poolA,100),row(poolA,125)],token);
 assert.equal(result.conflictingPairCount,1);
 assert.deepEqual(result.pairs,[]);
 assert.equal(result.liquidityUsd,null);
 assert.equal(result.volume24h,null);
 assert.equal(result.pairCount,null);
 assert.equal(result.reasonCode,'CONFLICTING_DUPLICATE_POOLS');
 assert.match(result.reason,/conflicting duplicate observations/i);
});

test('GeckoTerminal reserve fallback evidence identifies the reserve method and exact token source',()=>{
 const fetchedAt='2026-11-11T08:00:00.000Z';
 const evidence=liquidity.reserveEvidence(token,{priceUsd:{evidence:[{pool:'arc_'+poolA,fetchedAt}]}})[0];
 assert.equal(evidence.source,'GeckoTerminal');
 assert.equal(evidence.chainId,5042);
 assert.equal(evidence.address,token);
 assert.equal(evidence.method,'total_reserve_in_usd');
 assert.equal(evidence.pool,'arc_'+poolA);
 assert.equal(evidence.fetchedAt,fetchedAt);
 assert.match(evidence.url,/\/networks\/arc\/tokens\//);
 assert.match(evidence.scope,/not executable exit liquidity/i);
});
