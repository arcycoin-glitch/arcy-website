'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../search/server/lib/market-verify-snapshot'),mc=require('../search/server/lib/market-cross');
const NOW=Date.parse('2026-11-27T20:00:00Z'),T='0x'+'1'.repeat(40),P1='0x'+'a'.repeat(40),P2='0x'+'b'.repeat(40),P3='0x'+'c'.repeat(64);
const rec=(o={})=>({value:960,status:'ON_CHAIN_DERIVED',dataState:'DATA_FOUND',source:'Robinhood Chain RPC pool state',evidence:[{pairs:[P1,P3],coverageOfProviderVolume:0.96,...o}]});
const doc=(gen=new Date(NOW-3600000).toISOString(),entry={volume24h:rec()})=>({schema:S.SCHEMA,generatedAt:gen,entries:{['robinhood:'+T]:entry}});
const primary={volume24h:{value:1000,source:'DEX Screener',dataState:'DATA_FOUND',evidence:[{pairs:[P1,P2,P3]}]}};
test('MVS-1 fresh, scope-compatible record becomes the secondary volume field',()=>{
 const r=S.volumeField(doc(),'robinhood',T,primary,{now:NOW});assert.ok(r.field);assert.equal(r.field.freshness.state,'SNAPSHOT');
 const x=mc.merge(primary,{volume24h:r.field},{now:NOW});assert.equal(x.volume24h.crossCheck.state,'AGREE');assert.equal(x.volume24h.crossCheck.scope,'COVERAGE');assert.equal(x.volume24h.value,1000,'displayed value stays the provider total');
});
test('MVS-2 stale, future, wrong chain/token, changed scope, low coverage or invalid schema never produce a field',()=>{
 assert.equal(S.volumeField(doc(new Date(NOW-4*3600000).toISOString()),'robinhood',T,primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_STALE');
 assert.equal(S.volumeField(doc(new Date(NOW+3600000).toISOString()),'robinhood',T,primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_STALE');
 assert.equal(S.volumeField(doc(),'arc',T,primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_NO_RECORD');
 assert.equal(S.volumeField(doc(),'robinhood','0x'+'2'.repeat(40),primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_NO_RECORD');
 assert.equal(S.volumeField(doc(),'robinhood',T,{volume24h:{...primary.volume24h,evidence:[{pairs:[P2,P3]}]}},{now:NOW}).reason,'VOLUME_SNAPSHOT_SCOPE_CHANGED');
 assert.equal(S.volumeField(doc(undefined,{volume24h:rec({coverageOfProviderVolume:0.9})}),'robinhood',T,primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_RECORD_INVALID');
 assert.equal(S.volumeField(null,'robinhood',T,primary,{now:NOW}).reason,'VOLUME_SNAPSHOT_UNAVAILABLE');
 assert.equal(S.valid({...doc(),schema:'x'},NOW),false);assert.equal(S.valid({...doc(),entries:[]},NOW),false);
});
test('MVS-3 a disagreeing snapshot is never promoted; other fields keep the exact-scope rule',()=>{
 const x=mc.merge(primary,{volume24h:{...rec(),value:500}},{now:NOW});assert.equal(x.volume24h.crossCheck.state,'DISAGREE');
});
test('MVS-4 loader: immutable commit URL, bounded, fails closed, opt-out switch',async()=>{
 S._reset();const urls=[];const sha='a'.repeat(40);
 const fetcher=async u=>{urls.push(u);if(u.includes('/git/ref/heads/'))return new Response(JSON.stringify({object:{sha}}));return new Response(JSON.stringify(doc()));};
 const d=await S.load({fetcher,now:NOW,env:{}});assert.equal(d.schema,S.SCHEMA);assert.match(urls[1],new RegExp('/'+sha+'/market-verify/snapshot.json$'));
 S._reset();assert.equal(await S.load({fetcher:async()=>{throw Error('down');},now:NOW,env:{}}),null);
 S._reset();assert.equal(await S.load({fetcher,now:NOW,env:{SEARCH_MARKET_VERIFY_SNAPSHOT:'off'}}),null);
});
test('MVS-5 request path keeps the Arc/pool-count guards; only durable callers lift them',async()=>{
 const MV=require('../search/server/lib/market-volume');const prim={volume24h:{evidence:[{pairs:['0x'+'a'.repeat(40)]}]}};
 const r=await MV.inspect('arc','0x'+'1'.repeat(40),prim,{rpc:async()=>{throw Error('no read in request path');}});assert.equal(r.profile.reason,'VOLUME_WINDOW_EXCEEDS_RPC_BUDGET');
 const many={volume24h:{evidence:[{pairs:Array.from({length:13},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'))}]}};
 assert.match((await MV.inspect('robinhood','0x'+'1'.repeat(40),many,{rpc:async()=>{throw Error('x');}})).profile.reason,/VOLUME_SCOPE_EXCEEDS_BUDGET/);
});
