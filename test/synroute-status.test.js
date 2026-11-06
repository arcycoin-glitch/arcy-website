'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSynroute, chainIdsFrom } = require('../api/synroute/status');
const success = (data) => ({ ok: true, status: 200, json: async () => data });
const fail = (status) => ({ ok: false, status });
const chains = { chains: [{chainId: 5042},{chainId: 4663}] };
test('detects both mainnets', () => assert.deepEqual(chainIdsFrom(chains), [5042,4663]));
test('fails closed when no key', async () => {
  const r = await checkSynroute({ key: '', fetcher: () => { throw Error('should not call'); } });
  assert.equal(r.status,503);
});
test('fails closed on testnet-only deployment', async () => {
  const r = await checkSynroute({ key: 'private-key', fetcher: async () => success({chains:[{chainId:46630},{chainId:5042002}]}) });
  assert.equal(r.status,424);
  assert.equal(r.body.auth,'not_checked');
});
test('verifies production chain ids and private authentication without exposing secret', async () => {
  const key = 'sk_live_very_secret'; const calls=[];
  const fetcher=async (url, opts) => {
    calls.push({url,opts});
    return url.endsWith('/v1/chains') ? success(chains) : success({balance:'nonpublic',token:key});
  };
  const r = await checkSynroute({key,fetcher});
  assert.equal(r.status,200);
  assert.equal(r.body.auth,'verified');
  assert.equal(r.body.swapExecutionEnabled,false);
  assert.equal(calls[0].opts.headers['x-api-key'], undefined);
  assert.equal(calls[1].opts.headers['x-api-key'], key);
  assert.equal(JSON.stringify(r).includes(key),false);
  assert.equal(JSON.stringify(r).includes('nonpublic'),false);
});
test('non-2xx authentication remains unverified', async () => {
 const r=await checkSynroute({key:'private',fetcher:async (url)=>url.endsWith('/v1/chains')?success(chains):fail(401)});
 assert.equal(r.status,424); assert.equal(r.body.upstreamStatus,401);
});
test('handles upstream downtime without leaking network details', async () => {
 const r=await checkSynroute({key:'private',fetcher:async()=>{throw Error('private server info')}});
 assert.equal(r.status,502); assert.equal(JSON.stringify(r).includes('private server info'),false);
});
test('GET only handler',async()=>{
 const handler=require('../api/synroute/status');const data={};
 const res={setHeader:()=>{},status:(v)=>{data.status=v;return res},json:(v)=>{data.body=v}};
 await handler({method:'POST'},res);
 assert.equal(data.status,405);
});
