'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const liquidity=require('../api/liquidity');
const market=require('../lib/market-activity');
const pools=require('../lib/gecko-pairs');
const identity=require('../lib/token-identity');

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
 assert.equal(result.conflictReasonCode,'CONFLICTING_DUPLICATE_POOLS');
 assert.match(result.conflictReason,/ambiguous pools were excluded/i);
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

const geckoEvidence=[{source:'GeckoTerminal',url:'https://api.geckoterminal.com/api/v2/networks/arc/tokens/'+token+'/pools',chainId:5042,address:token,scope:'First page only.'}];
async function withSources({dexRows=[],poolRead={pairs:[],evidence:geckoEvidence},marketRead=async()=>({attributes:{total_reserve_in_usd:null},priceUsd:{evidence:geckoEvidence}})},run){
 const originals=[identity.inspect,market.dexPairs,market.gecko,pools.read];
 try{
  identity.inspect=async()=>({address:token,chainId:5042});
  market.dexPairs=async()=>dexRows;
  market.gecko=marketRead;
  pools.read=async()=>typeof poolRead==='function'?poolRead():poolRead;
  return await run(await liquidity.read(token,{query:{summary:'1'}}));
 }finally{[identity.inspect,market.dexPairs,market.gecko,pools.read]=originals;}
}

test('integration: conflicting DEX rows stay visible when valid GeckoTerminal pools supply the result',()=>withSources({
 dexRows:[row(poolA,100),row(poolA,125)],
 poolRead:{pairs:[{...row(poolB,50,3),source:'GeckoTerminal'}],evidence:geckoEvidence}
},result=>{
 assert.equal(result.liquidityUsd,50);
 assert.equal(result.source,'GeckoTerminal');
 assert.equal(result.fields.liquidityUsd.source,'GeckoTerminal');
 assert.equal(result.fields.liquidityUsd.evidence[0].source,'GeckoTerminal');
 assert.equal(result.marketAttempts[0].source,'DexScreener');
 assert.equal(result.marketAttempts[0].conflictingPairCount,1);
 assert.equal(result.marketAttempts[0].reasonCode,'CONFLICTING_DUPLICATE_POOLS');
 assert.equal(result.marketAttempts[0].conflictReasonCode,'CONFLICTING_DUPLICATE_POOLS');
 assert.equal(result.marketAttempts[1].source,'GeckoTerminal pools');
 assert.equal(result.marketAttempts[1].conflictingPairCount,0);
}));

test('integration: failed GeckoTerminal fallback preserves the DEX conflict and each provider failure reason',()=>withSources({
 dexRows:[row(poolA,100),row(poolA,125)],
 poolRead:async()=>{throw Object.assign(Error('pool source unavailable'),{code:'GECKO_POOL_UNAVAILABLE'});},
 marketRead:async()=>{throw Object.assign(Error('reserve source unavailable'),{code:'GECKO_RESERVE_UNAVAILABLE'});}
},result=>{
 assert.equal(result.liquidityUsd,null);
 assert.equal(result.fields.liquidityUsd.dataState,'SOURCE_API_FAILED');
 assert.equal(result.marketAttempts[0].conflictingPairCount,1);
 assert.equal(result.marketAttempts[0].reasonCode,'CONFLICTING_DUPLICATE_POOLS');
 assert.equal(result.marketAttempts[1].reasonCode,'GECKO_POOL_UNAVAILABLE');
 assert.equal(result.marketAttempts[2].reasonCode,'GECKO_RESERVE_UNAVAILABLE');
 assert.ok(result.marketAttempts.every(a=>a.evidence?.[0]?.source));
}));

test('integration: reserve-only GeckoTerminal recovery attributes liquidity while preserving earlier pool conflicts',()=>withSources({
 dexRows:[row(poolA,100),row(poolA,125)],
 poolRead:{pairs:[],conflictingPairCount:1,reasonCode:'CONFLICTING_DUPLICATE_POOLS',reason:'Gecko pool duplicate conflict.',evidence:geckoEvidence},
 marketRead:async()=>({attributes:{total_reserve_in_usd:'321.5'},priceUsd:{evidence:[{pool:'arc_'+poolB,fetchedAt:'2026-11-11T08:00:00.000Z'}]}})
},result=>{
 assert.equal(result.liquidityUsd,321.5);
 assert.equal(result.fields.liquidityUsd.source,'GeckoTerminal');
 assert.equal(result.fields.liquidityUsd.evidence[0].method,'total_reserve_in_usd');
 assert.equal(result.marketAttempts[0].conflictingPairCount,1);
 assert.equal(result.marketAttempts[1].conflictingPairCount,1);
 assert.equal(result.marketAttempts[2].source,'GeckoTerminal token reserves');
 assert.equal(result.marketAttempts[2].value,321.5);
}));

test('GeckoTerminal normalization counts and excludes conflicting duplicate pool rows',()=>{
 const mk=reserve=>({type:'pool',id:'arc_'+poolA,attributes:{address:poolA,reserve_in_usd:String(reserve),volume_usd:{h24:'10'}},relationships:{base_token:{data:{id:'arc_'+token}},quote_token:{data:{id:'arc_'+quote}},dex:{data:{id:'uniswap-v2-arc'}}}});
 const normalized=pools.normalizeDetailed({data:[mk(10),mk(11)]},token);
 assert.deepEqual(normalized.pairs,[]);
 assert.equal(normalized.conflictingPairCount,1);
 assert.equal(normalized.reasonCode,'CONFLICTING_DUPLICATE_POOLS');
});
