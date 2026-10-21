'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../lib/core'),market=require('../lib/market-activity'),sources=require('../lib/holder-source'),fields=require('../lib/fields');
const address='0x'+'a'.repeat(40),pair={pairAddress:'0x'+'b'.repeat(40),baseToken:{address},quoteToken:{address:'0x'+'c'.repeat(40)}};
test('market pairs are filtered by the selected network and exact token contract',async()=>{
 const rows=[{...pair,chainId:'arc'},{...pair,pairAddress:'0x'+'d'.repeat(40),chainId:'ethereum'},{...pair,pairAddress:'0x'+'e'.repeat(40),chainId:'robinhood'},{...pair,pairAddress:'0x'+'f'.repeat(40),chainId:'ethereum',baseToken:{address:'0x'+'9'.repeat(40)}}];
 for(const [id,expected] of [[5042,'arc'],[1,'ethereum'],[4663,'robinhood']])await core.runWithChain(id,async()=>{const found=market.matched(rows,address);assert.equal(found.length,1);assert.equal(found[0].chainId,expected);});
});
test('holder sources use chain-specific indexer hosts and reject unsupported chain IDs',async()=>{
 const original=global.fetch,urls=[];try{global.fetch=async url=>{urls.push(String(url));return {ok:true,status:200,json:async()=>String(url).includes('/holders?')?{items:[]}:{total_blocks:'123'}};};
 for(const [id,host] of [[1,'eth.blockscout.com'],[4663,'robinhoodchain.blockscout.com']])await core.runWithChain(id,async()=>{const d=await sources.stats();assert.equal(d.chainId,id);assert.ok(urls.at(-1).includes(host));const page=await sources.page(address);assert.deepEqual(page.rows,[]);assert.ok(urls.at(-1).includes(host));});
 }finally{global.fetch=original;}
});
test('API cache values are isolated by chain for identical contract keys',async()=>{
 fields.clearCache();let calls=0;
 for(const id of [5042,1,4663])await core.runWithChain(id,async()=>{const value=await fields.cached('same-contract:'+address,60000,async()=>({chainId:id,call:++calls}));assert.equal(value.chainId,id);});
 assert.equal(calls,3);fields.clearCache();
});
test('publications for an identical address use a chain-scoped cache identity',async()=>{
 const storage=require('../lib/holder-storage'),anchor='0x'+'f'.repeat(64);
 const snapshots=[];for(const id of [5042,1,4663])snapshots.push(await core.runWithChain(id,async()=>({...require('../lib/holder-index').aggregate([[address,'5']],5n,[{block:'0x1',anchor,chainId:id}]),address,block:'0x1',snapshot:{block:'0x1',completedAt:new Date().toISOString()}})));
 for(let i=0;i<3;i++)assert.equal(await core.runWithChain([5042,1,4663][i],async()=>storage.validSnapshot(snapshots[i],address)),true);
 assert.equal(await core.runWithChain(1,async()=>storage.validSnapshot(snapshots[0],address)),false);
});
