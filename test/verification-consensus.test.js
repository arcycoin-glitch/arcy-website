'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const consensus=require('../lib/verification/consensus');
const radar=require('../lib/radar-v2/verify');

const block={number:'123',hash:'0x'+'a'.repeat(64)};
const at='2026-11-11T00:00:00.000Z';
function row(id,value,{operator=id,unit='usd',scope='token',anchor=null,time=at}={}){
 return {source:{id,operator},value,unit,scope,observedAt:time,block:anchor};
}

test('market presets preserve the already-deployed Radar V2 tolerances exactly',()=>{
 const pairs=[
  ['MARKET_PRICE_USD','priceUsd'],['MARKET_VOLUME_24H_USD','volume24hUsd'],['MARKET_LIQUIDITY_USD','liquidityUsd'],
  ['MARKET_FDV_USD','fdvUsd'],['MARKET_CAP_USD','marketCapUsd'],['MARKET_CHANGE_24H_PCT','change24hPct'],['POOL_CREATED_AT','poolCreatedAt']
 ];
 for(const [preset,field] of pairs){
  const p=consensus.PRESETS[preset],legacy=radar.TOLERANCE[field];
  if(field==='change24hPct')assert.equal(p.tolerance,legacy.abs);
  else if(field==='poolCreatedAt')assert.equal(p.tolerance,legacy.ms);
  else assert.equal(p.tolerance,legacy);
 }
});

test('exact on-chain agreement requires independent operators on the same block hash',()=>{
 const p=consensus.PRESETS.EXACT_ONCHAIN;
 const agreed=consensus.evaluate([
  row('rpc-a','100',{operator:'operator-a',unit:'raw-token',scope:null,anchor:block}),
  row('rpc-b','100',{operator:'operator-b',unit:'raw-token',scope:null,anchor:block})
 ],p);
 assert.deepEqual(agreed,{state:'AGREED',reasonCode:'EXACT_AGREEMENT',policy:p.id,operators:['operator-a','operator-b'],
  sources:['rpc-a','rpc-b'],selectedValue:'100',maxDifference:0});

 const hashConflict=consensus.evaluate([
  row('rpc-a','100',{operator:'operator-a',unit:'raw-token',scope:null,anchor:block}),
  row('rpc-b','100',{operator:'operator-b',unit:'raw-token',scope:null,anchor:{number:'123',hash:'0x'+'b'.repeat(64)}})
 ],p);
 assert.equal(hashConflict.state,'CONFLICTING');assert.equal(hashConflict.reasonCode,'BLOCK_HASH_MISMATCH');

 const differentBlock=consensus.evaluate([
  row('rpc-a','100',{operator:'operator-a',unit:'raw-token',scope:null,anchor:block}),
  row('rpc-b','100',{operator:'operator-b',unit:'raw-token',scope:null,anchor:{number:'124',hash:'0x'+'b'.repeat(64)}})
 ],p);
 assert.equal(differentBlock.state,'NOT_COMPARABLE');assert.equal(differentBlock.reasonCode,'BLOCK_NUMBER_MISMATCH');
});

test('two source labels owned by the same upstream remain single-source',()=>{
 const p=consensus.PRESETS.EXACT_ONCHAIN;
 const out=consensus.evaluate([
  row('rpc-primary','100',{operator:'same-operator',unit:'raw-token',scope:null,anchor:block}),
  row('rpc-backup','100',{operator:'same-operator',unit:'raw-token',scope:null,anchor:block})
 ],p);
 assert.equal(out.state,'SINGLE_SOURCE');assert.equal(out.reasonCode,'ONLY_ONE_OPERATOR');assert.deepEqual(out.operators,['same-operator']);
});

test('market agreement uses documented tolerance without fabricating one exact canonical value',()=>{
 const p=consensus.PRESETS.MARKET_PRICE_USD;
 const out=consensus.evaluate([row('gecko','100',{operator:'gecko'}),row('dex','102',{operator:'dex'})],p);
 assert.equal(out.state,'AGREED');assert.equal(out.reasonCode,'WITHIN_DOCUMENTED_TOLERANCE');assert.equal(out.selectedValue,null);
 assert.ok(out.maxDifference>0&&out.maxDifference<=0.03);

 const conflict=consensus.evaluate([row('gecko','100',{operator:'gecko'}),row('dex','104',{operator:'dex'})],p);
 assert.equal(conflict.state,'CONFLICTING');assert.equal(conflict.reasonCode,'VALUES_DISAGREE');assert.equal(conflict.selectedValue,null);
});

test('absolute and time policies match legacy boundary behavior',()=>{
 const change=consensus.PRESETS.MARKET_CHANGE_24H_PCT;
 assert.equal(consensus.evaluate([row('a',10,{operator:'a',unit:'percent'}),row('b',13,{operator:'b',unit:'percent'})],change).state,'AGREED');
 assert.equal(consensus.evaluate([row('a',10,{operator:'a',unit:'percent'}),row('b',13.01,{operator:'b',unit:'percent'})],change).state,'CONFLICTING');

 const age=consensus.PRESETS.POOL_CREATED_AT,t0='2026-11-11T00:00:00.000Z',t1='2026-11-11T00:10:00.000Z',t2='2026-11-11T00:10:00.001Z';
 assert.equal(consensus.evaluate([row('a',t0,{operator:'a',unit:'timestamp'}),row('b',t1,{operator:'b',unit:'timestamp'})],age).state,'AGREED');
 assert.equal(consensus.evaluate([row('a',t0,{operator:'a',unit:'timestamp'}),row('b',t2,{operator:'b',unit:'timestamp'})],age).state,'CONFLICTING');
});

test('scope/unit mismatch is not falsely called a conflict and a majority cannot hide an outlier',()=>{
 const p=consensus.PRESETS.MARKET_LIQUIDITY_USD;
 const scope=consensus.evaluate([row('a','100',{operator:'a',scope:'token'}),row('b','100',{operator:'b',scope:'pool'})],p);
 assert.equal(scope.state,'NOT_COMPARABLE');assert.equal(scope.reasonCode,'SCOPE_MISMATCH');
 const unit=consensus.evaluate([row('a','100',{operator:'a',unit:'usd'}),row('b','100',{operator:'b',unit:'token'})],p);
 assert.equal(unit.state,'NOT_COMPARABLE');assert.equal(unit.reasonCode,'UNIT_MISMATCH');

 const outlier=consensus.evaluate([
  row('a','100',{operator:'a'}),row('b','101',{operator:'b'}),row('c','200',{operator:'c'})
 ],p);
 assert.equal(outlier.state,'CONFLICTING');assert.equal(outlier.selectedValue,null);
});

test('empty, invalid and duplicate evidence fail deterministically',()=>{
 const p=consensus.PRESETS.MARKET_PRICE_USD;
 assert.equal(consensus.evaluate([],p).state,'NO_EVIDENCE');
 assert.throws(()=>consensus.evaluate([row('a','100'),row('a','100')],p),e=>e.code==='CONSENSUS_DUPLICATE_SOURCE');
 assert.throws(()=>consensus.evaluate([row('bad source','100')],p),e=>e.code==='CONSENSUS_INVALID_SOURCE');
 assert.throws(()=>consensus.evaluate(new Array(9).fill(0).map((_,i)=>row('s'+i,'100')),p),e=>e.code==='CONSENSUS_TOO_MANY_OBSERVATIONS');
});

test('exact on-chain disagreement at the same block is CONFLICTING; only differing value types are NOT_COMPARABLE',()=>{
 const p=consensus.PRESETS.EXACT_ONCHAIN,anchor={number:'100',hash:'0x'+'11'.repeat(32)};
 const at='2026-11-12T11:59:00.000Z',r=(id,operator,value)=>({source:{id,operator},value,unit:'raw-token',scope:null,observedAt:at,block:anchor});
 const out=consensus.evaluate([r('rpc-a','op-a','1000'),r('rpc-b','op-b','999')],p);
 assert.equal(out.state,'CONFLICTING');assert.equal(out.reasonCode,'VALUES_DISAGREE');assert.equal(out.selectedValue,null);
 // Existing EXACT semantics compare String(value), so '1000' and 1000 agree; a boolean against a number does not.
 const types=consensus.evaluate([r('rpc-a','op-a','1000'),r('rpc-b','op-b',true)],p);
 assert.equal(types.state,'NOT_COMPARABLE');assert.equal(types.reasonCode,'VALUE_TYPE_MISMATCH');
 assert.equal(consensus.evaluate([r('rpc-a','op-a','1000'),r('rpc-b','op-b','1000')],p).state,'AGREED');
});
