'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../search/server/lib/market-verify-snapshot'), X = require('../search/server/lib/market-cross'), D = require('../search/server/lib/derived-metrics');
const TOKEN = '0x' + '1'.repeat(40), P1 = '0x' + '3'.repeat(40), P2 = '0x' + '4'.repeat(40), NOW = Date.parse('2026-11-28T12:00:00Z');
const field = (over = {}) => ({ value: 40, status: 'ON_CHAIN_DERIVED', dataState: 'DATA_FOUND', source: 'Arc RPC pool state', network: 'arc',
  evidence: [{ method: 'arcy-market-volume-1', pairs: [P1, P2], fromBlockHash: '0x' + 'a'.repeat(64), toBlockHash: '0x' + 'b'.repeat(64), toBlock: 100,
    pools: [{ pool: P1, usd: 30, liquidityUsd: 100 }, { pool: P2, usd: 10, liquidityUsd: 300 }], ...over }] });
const doc = (f, at = NOW - 3600000, registry) => ({ schema: S.SCHEMA, generatedAt: new Date(at).toISOString(), entries: { ['arc:' + TOKEN]: { volumeDiscovered: f } }, registry });
test('registry volume: fresh, valid, provider-free record is used; stale/invalid/absent are not', () => {
  assert.equal(S.discoveredVolumeField(doc(field()), 'arc', TOKEN, { now: NOW }).field.freshness.state, 'SNAPSHOT');
  assert.equal(S.discoveredVolumeField(doc(field(), NOW - 4 * 3600000), 'arc', TOKEN, { now: NOW }).reason, 'VOLUME_SNAPSHOT_STALE');
  assert.equal(S.discoveredVolumeField(doc(field({ method: 'x' })), 'arc', TOKEN, { now: NOW }).reason, 'VOLUME_REGISTRY_RECORD_INVALID');
  assert.equal(S.discoveredVolumeField(doc(field({ pools: [] })), 'arc', TOKEN, { now: NOW }).reason, 'VOLUME_REGISTRY_RECORD_INVALID');
  assert.equal(S.discoveredVolumeField(doc(undefined), 'arc', TOKEN, { now: NOW }).reason, 'VOLUME_REGISTRY_NO_RECORD');
  assert.equal(S.discoveredVolumeField(null, 'arc', TOKEN, { now: NOW }).reason, 'VOLUME_SNAPSHOT_UNAVAILABLE');
});
test('registry pools expire after 14 days and must be well-formed', () => {
  const reg = { ['arc:' + TOKEN]: { pools: [{ pool: P1, lastSeen: new Date(NOW - 86400000).toISOString() }, { pool: P2, lastSeen: new Date(NOW - 15 * 86400000).toISOString() }, { pool: 'bad', lastSeen: new Date(NOW).toISOString() }] } };
  assert.deepEqual(S.registryPools({ registry: reg }, 'arc', TOKEN, { now: NOW }), [P1]);
});
test('provider outage: volume comes from the registry record and turnover is on-chain self-scoped; a healthy provider volume is never replaced', async () => {
  const snap = async () => doc(field(), NOW - 600000);
  const down = { priceUsd: { dataState: 'DATA_FOUND', value: 1 }, liquidityUsd: { dataState: 'DATA_FOUND', value: 2 }, dexPairCount: { dataState: 'DATA_FOUND', value: '1' } };
  const r = await X.fillFromChain('arc', TOKEN, down, { discoveryInspect: async () => ({ fields: {} }), env: {}, now: () => NOW, snapshotLoad: snap });
  assert.deepEqual(r.filled, ['volume24h']); assert.equal(r.fields.volume24h.value, 40);
  const t = D.liquidity({ liquidityUsd: r.fields.liquidityUsd, volume24h: r.fields.volume24h }, { network: 'arc', chainId: 5042, address: TOKEN });
  assert.equal(t.dataState, 'DATA_FOUND'); assert.equal(t.value, 10);
  const healthy = { ...down, volume24h: { dataState: 'DATA_FOUND', value: 7 } };
  const k = await X.fillFromChain('arc', TOKEN, healthy, { discoveryInspect: async () => { throw Error('must not run'); }, env: {}, now: () => NOW, snapshotLoad: snap });
  assert.equal(k.filled.length, 0); assert.equal(k.fields.volume24h.value, 7);
});
test('registry candidates feed discovery on a network with no reviewed factory (Arc)', async () => {
  const MD = require('../search/server/lib/market-discovery');
  const r = await MD.inspect('arc', TOKEN, { rpc: async (m) => { if (m === 'eth_blockNumber') return '0x10'; throw Object.assign(Error('revert'), { code: 'X' }); }, ethRpc: async () => { throw Error('x'); }, now: NOW, env: { SEARCH_MARKET_ONCHAIN_CHECK: 'on' }, registry: async () => [P1] });
  assert.notEqual(r.profile.reasons.all, 'NO_REVIEWED_FACTORY_FOR_NETWORK');
  const none = await MD.inspect('arc', TOKEN, { rpc: async () => '0x10', now: NOW + 99999, env: { SEARCH_MARKET_ONCHAIN_CHECK: 'on' }, registry: async () => [] });
  assert.equal(none.profile.reasons.all, 'NO_REVIEWED_FACTORY_FOR_NETWORK');
});
