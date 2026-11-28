'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../search/server/lib/market-discovery'), X = require('../search/server/lib/market-cross');
const O = require('../search/server/lib/market-onchain');
const TOKEN = '0x' + '11'.repeat(20), WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', POOL = '0x' + 'aa'.repeat(20), FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const w = x => BigInt(x).toString(16).padStart(64, '0'), addrw = a => a.replace('0x', '').padStart(64, '0');
const NOW = Date.parse('2026-11-28T10:00:00Z');
function abiStr(s) { const hex = Buffer.from(s).toString('hex').padEnd(64, '0'); return '0x' + w(32) + w(s.length) + hex; }
const sqrt = BigInt(Math.floor(Math.sqrt(1000) * 2 ** 96)); // pool price = token1/token0 = 1000 TOKEN per WETH (1 TOKEN = 0.001 WETH); token0 = WETH
function chainRpc({ pools = { 3000: POOL }, failFactory = false } = {}) {
  return async (m, p) => {
    if (m === 'eth_blockNumber') return '0x64';
    if (m !== 'eth_call') throw new Error('unexpected ' + m);
    const { to, data } = p[0], sel = data.slice(0, 10), t = to.toLowerCase();
    if (t === FACTORY) { if (failFactory) throw Object.assign(new Error('x'), { code: 'RPC_DOWN' }); const fee = parseInt(data.slice(-64), 16); const q = data.slice(10 + 64, 10 + 128); return '0x' + addrw(pools[fee] && q.endsWith(WETH.slice(2)) ? pools[fee] : '0x0'); }
    if (t === POOL) { if (sel === '0x0dfe1681') return '0x' + addrw(WETH); if (sel === '0xd21220a7') return '0x' + addrw(TOKEN); if (sel === '0x0902f1ac') throw Object.assign(new Error('revert'), { code: 'CALL_REVERTED' }); if (sel === '0x3850c7bd') return '0x' + w(sqrt) + w(0).repeat(6); }
    if (sel === '0x313ce567') return '0x' + w(18);
    if (sel === '0x70a08231') return '0x' + w(t === WETH ? 100n * 10n ** 18n : 100000n * 10n ** 18n);
    throw new Error('unhandled ' + t + ' ' + sel);
  };
}
function ethRpc(price = 2000) {
  return async (m, p) => {
    if (m === 'eth_blockNumber') return '0x1';
    const { data } = p[0];
    if (data.startsWith('0x7284e416')) return abiStr('ETH / USD');
    if (data.startsWith('0xfeaf968c')) return '0x' + w(1) + w(BigInt(price) * 10n ** 8n) + w(Math.floor(NOW / 1000)) + w(Math.floor(NOW / 1000)) + w(1);
    throw new Error('unhandled feed ' + data.slice(0, 10));
  };
}
const env = { SEARCH_MARKET_ONCHAIN_CHECK: 'on' };
test('discovers a V3 pool from the reviewed factory and derives price, liquidity and pool count on-chain', async () => {
  D._reset();
  const r = await D.inspect('robinhood', TOKEN, { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env });
  assert.equal(r.fields.priceUsd.value.toFixed(3), '2.000');
  assert.equal(Math.round(r.fields.liquidityUsd.value), 400000);
  assert.match(r.fields.dexPairCount.value, /^1 discovered pool /);
  assert.equal(r.fields.priceUsd.status, 'ON_CHAIN_DERIVED'); assert.equal(r.fields.priceUsd.evidence[0].block, '0x64');
  assert.match(r.fields.liquidityUsd.evidence[0].scope, /Lower bound/); assert.deepEqual(r.fields.liquidityUsd.evidence[0].pairs, [POOL]);
});
test('fails closed: no pool, no reviewed factory (Arc), disabled flag, RPC failure, unsupported quote', async () => {
  D._reset();
  assert.equal(Object.keys((await D.inspect('robinhood', TOKEN, { rpc: chainRpc({ pools: {} }), ethRpc: ethRpc(), now: NOW, env })).fields).length, 0);
  D._reset();
  assert.equal((await D.inspect('arc', TOKEN, { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env })).profile.reasons.all, 'NO_REVIEWED_FACTORY_FOR_NETWORK');
  assert.equal((await D.inspect('robinhood', TOKEN, { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env: {} })).profile.reasons.all, 'DISCOVERY_DISABLED');
  D._reset();
  assert.equal(Object.keys((await D.inspect('robinhood', TOKEN, { rpc: chainRpc({ failFactory: true }), ethRpc: ethRpc(), now: NOW, env })).fields).length, 0);
  assert.equal(Object.keys((await D.inspect('robinhood', 'not-an-address', { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env })).fields).length, 0);
});
test('market-cross: provider outage is filled from the chain; a healthy provider is never replaced; no discovery keeps the original error', async () => {
  const discovery = async () => D.inspect('robinhood', TOKEN, { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env });
  D._reset();
  const down = await X.inspect('robinhood', TOKEN, { dexInspect: async () => { throw new Error('DEX down'); }, discoveryInspect: (n, a, o) => D.inspect(n, a, { ...o, rpc: chainRpc(), ethRpc: ethRpc(), now: NOW }), env, now: () => NOW });
  assert.equal(down.priceUsd.dataState, 'DATA_FOUND'); assert.equal(down.priceUsd.source, O.SOURCE.robinhood);
  assert.equal(down.volume24h.dataState, 'NOT_VERIFIED'); assert.equal(down.change24h.dataState, 'NOT_VERIFIED');
  await assert.rejects(X.inspect('robinhood', TOKEN, { dexInspect: async () => { throw new Error('DEX down'); }, discoveryInspect: async () => ({ fields: {}, profile: {} }), env, now: () => NOW }), /DEX down/);
  const healthy = { priceUsd: { dataState: 'DATA_FOUND', value: 5, source: 'DEX Screener', evidence: [{ pairs: ['p'] }] }, liquidityUsd: { dataState: 'DATA_FOUND', value: 9, source: 'DEX Screener', evidence: [{ pairs: ['p'] }] }, dexPairCount: { dataState: 'DATA_FOUND', value: '1 DEX', source: 'DEX Screener', evidence: [] } };
  let called = 0;
  const kept = await X.inspect('robinhood', TOKEN, { dexInspect: async () => healthy, onchainInspect: null, discoveryInspect: async () => { called++; return { fields: {} }; }, env: {}, now: () => NOW });
  assert.equal(kept.priceUsd.value, 5); assert.equal(called, 0);
  D._reset(); void discovery;
});

test('classification: discovered price and liquidity are on-chain verified, the pool count is single-source (lower bound), nothing is cross-verified', async () => {
  const { classify } = require('../search/server/lib/evidence-class');
  D._reset();
  const r = await D.inspect('robinhood', TOKEN, { rpc: chainRpc(), ethRpc: ethRpc(), now: NOW, env });
  assert.equal(classify(r.fields.priceUsd, { card: 'activity', now: NOW }).evidenceClass, 'ON_CHAIN_VERIFIED');
  assert.equal(classify(r.fields.liquidityUsd, { card: 'liquidity', now: NOW }).evidenceClass, 'ON_CHAIN_VERIFIED');
  assert.equal(classify(r.fields.dexPairCount, { card: 'liquidity', now: NOW }).evidenceClass, 'SINGLE_SOURCE');
  // a provider-listed pool set still caps a derived value at SINGLE_SOURCE (unchanged rule)
  const providerPriced = { ...r.fields.priceUsd, evidence: [{ provider: 'DEX Screener', sourceUrl: 'https://dexscreener.com/x', pairs: ['p'], method: 'baseToken priceUsd' }] };
  assert.equal(classify(providerPriced, { card: 'activity', now: NOW }).evidenceClass, 'SINGLE_SOURCE');
});
