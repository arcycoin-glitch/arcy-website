'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../lib/core'),market=require('../lib/market-activity'),sources=require('../lib/holder-source'),fields=require('../lib/fields');
const address='0x'+'a'.repeat(40),pair={pairAddress:'0x'+'b'.repeat(40),baseToken:{address},quoteToken:{address:'0x'+'c'.repeat(40)}};
test('market pairs are filtered by the selected network and exact token contract',async()=>{
 const rows=[{...pair,chainId:'arc'},{...pair,pairAddress:'0x'+'d'.repeat(40),chainId:'ethereum'},{...pair,pairAddress:'0x'+'e'.repeat(40),chainId:'robinhood'},{...pair,pairAddress:'0x'+'f'.repeat(40),chainId:'ethereum',baseToken:{address:'0x'+'9'.repeat(40)}}];
 for(const [id,expected] of [[5042,'arc'],[1,'ethereum'],[4663,'robinhood']])await core.runWithChain(id,async()=>{const found=market.matched(rows,address);assert.equal(found.length,1);assert.equal(found[0].chainId,expected);});
});
test('holder sources use chain-specific indexer hosts and reject unsupported chain IDs',async()=>{
 const original=global.fetch,urls=[],oldKey=process.env.BLOCKSCOUT_API_KEY;try{process.env.BLOCKSCOUT_API_KEY='test-only-blockscout-key';global.fetch=async url=>{urls.push(String(url));return {ok:true,status:200,json:async()=>String(url).includes('/holders?')?{items:[]}:{total_blocks:'123'}};};
 for(const [id,host] of [[1,'eth.blockscout.com'],[4663,'api.blockscout.com/4663/api/v2']])await core.runWithChain(id,async()=>{const d=await sources.stats();assert.equal(d.chainId,id);assert.ok(urls.at(-1).includes(host));const page=await sources.page(address);assert.deepEqual(page.rows,[]);assert.ok(urls.at(-1).includes(host));});
 }finally{global.fetch=original;if(oldKey===undefined)delete process.env.BLOCKSCOUT_API_KEY;else process.env.BLOCKSCOUT_API_KEY=oldKey;}
});
test('Robinhood Blockscout uses its documented multichain REST route with a server-only key and redacted evidence URLs',async()=>{
 const original=global.fetch,oldKey=process.env.BLOCKSCOUT_API_KEY;const urls=[];
 try{
  process.env.BLOCKSCOUT_API_KEY='test-only-blockscout-key';
  global.fetch=async url=>{urls.push(String(url));const value=String(url).includes('/stats')?{total_blocks:'456'}:String(url).includes('/holders?')?{items:[{address:{hash:address}}],next_page_params:{address_hash:address,value:'7'}}:{address, name:'Fixture'};return {ok:true,status:200,json:async()=>value};};
  await core.runWithChain(4663,async()=>{
   const stat=await sources.stats(),meta=await sources.metadata(address),page=await sources.page(address);
   assert.equal(stat.chainId,4663);assert.equal(meta.metadata.address,address);assert.equal(page.rows[0],address);
   assert.match(urls[0],/^https:\/\/api\.blockscout\.com\/4663\/api\/v2\/stats\?apikey=test-only-blockscout-key$/);
   assert.ok(urls.some(url=>url.includes('/tokens/'+address+'/holders?')));
   assert.ok(page.url.includes('apikey=%5BREDACTED%5D'));
   assert.equal(page.url.includes('test-only-blockscout-key'),false);
   assert.match(page.cursor,/address_hash=/);
  });
 }finally{global.fetch=original;if(oldKey===undefined)delete process.env.BLOCKSCOUT_API_KEY;else process.env.BLOCKSCOUT_API_KEY=oldKey;}
});
test('Robinhood holder discovery without an API key selects the RPC fallback without contacting the blocked explorer',async()=>{
 const original=global.fetch,oldKey=process.env.BLOCKSCOUT_API_KEY;let calls=0;
 try{delete process.env.BLOCKSCOUT_API_KEY;global.fetch=async()=>{calls++;throw Error('unexpected explorer request');};await assert.rejects(core.runWithChain(4663,()=>sources.stats()),{code:'BLOCKSCOUT_API_KEY_REQUIRED'});assert.equal(calls,0);}
 finally{global.fetch=original;if(oldKey===undefined)delete process.env.BLOCKSCOUT_API_KEY;else process.env.BLOCKSCOUT_API_KEY=oldKey;}
});
test('Ethereum RPC prefers ETHEREUM_RPC_URL and does not fall through to another chain',async()=>{
 const keys=['ETHEREUM_RPC_URL','ETH_RPC_URL','ETHEREUM_RPC_FALLBACK_URLS','ETH_RPC_FALLBACK_URLS'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.ETHEREUM_RPC_URL='https://ethereum-primary.example.invalid';process.env.ETH_RPC_URL='https://legacy-ethereum.example.invalid';process.env.ETHEREUM_RPC_FALLBACK_URLS='https://ethereum-fallback.example.invalid';
  assert.deepEqual(core.rpcProviders(1),['https://ethereum-primary.example.invalid','https://ethereum-fallback.example.invalid']);
 }finally{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}
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
