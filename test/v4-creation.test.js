'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { creationBlock } = require('../search/server/lib/v4-creation');
const ID = '0x' + 'ab'.repeat(32), SV = '0x' + '77'.repeat(20);
const word = n => BigInt(n).toString(16).padStart(64, '0');
function rpcWith(created, { prunedBelow = -1, calls = [] } = {}) {
  return async (m, p) => {
    calls.push(parseInt(p[1], 16));
    const b = parseInt(p[1], 16);
    if (b < prunedBelow) throw Object.assign(new Error('missing trie node (pruned state)'), { code: 'RPC_ERROR' });
    if (b < created) return '0x' + word(0) + word(0) + word(0) + word(0);
    return '0x' + word(2n ** 90n) + word(5) + word(0) + word(0);
  };
}
test('finds the exact creation block in ~log2(head) calls', async () => {
  for (const created of [1, 2, 12345, 29_500_000 - 1, 29_500_000]) {
    const calls = [], b = await creationBlock(rpcWith(created, { calls }), { stateView: SV, poolId: ID, head: 29_500_000 });
    assert.equal(b, created); assert.ok(calls.length <= 28, 'calls ' + calls.length);
  }
});
test('fails closed: not initialised at head, pruned history, revert before deployment counts as not initialised', async () => {
  await assert.rejects(creationBlock(rpcWith(100), { stateView: SV, poolId: ID, head: 50 }), /V4_POOL_NOT_INITIALISED/);
  await assert.rejects(creationBlock(rpcWith(10, { prunedBelow: 1000 }), { stateView: SV, poolId: ID, head: 5000 }), /V4_HISTORY_UNAVAILABLE/);
  const reverting = async (m, p) => { const b = parseInt(p[1], 16); if (b < 40) throw Object.assign(new Error('execution reverted'), { code: 'CALL_REVERTED' }); return '0x' + word(2n ** 90n) + word(1) + word(0) + word(0); };
  assert.equal(await creationBlock(reverting, { stateView: SV, poolId: ID, head: 1000 }), 40);
});
test('a valid lowerBound that is already initialised returns it', async () => {
  assert.equal(await creationBlock(rpcWith(500), { stateView: SV, poolId: ID, head: 1000, lowerBound: 900 }), 900);
});
test('resolveKey: Initialize log found OUTSIDE the bisected block (real Arc/Robinhood skew), hash-proven; wrong key or ambiguity fail closed', async () => {
  const { resolveKey, INITIALIZE } = require('../search/server/lib/v4-creation'), O = require('../search/server/lib/market-onchain');
  const k = { currency0: '0x' + '11'.repeat(20), currency1: '0x' + '22'.repeat(20), fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) };
  const id = O.poolId(k), PM = '0x' + '99'.repeat(20), created = 5000, logBlock = created - 41;
  const t = a => '0x' + a.slice(2).padStart(64, '0');
  const mk = (key, n = 1) => ({ address: PM, removed: false, blockNumber: '0x' + logBlock.toString(16), topics: [INITIALIZE, id, t(key.currency0), t(key.currency1)],
    data: '0x' + [BigInt(key.fee), BigInt(key.tickSpacing), BigInt(key.hooks), 1n, 0n].map(x => x.toString(16).padStart(64, '0')).join('') });
  const rpc = (logs) => async (m, p) => {
    if (m === 'eth_call') return parseInt(p[1], 16) < created ? '0x' + word(0).repeat(4) : '0x' + word(2n ** 90n) + word(1) + word(0) + word(0);
    const f = p[0], from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
    return logBlock >= from && logBlock <= to ? logs : [];
  };
  const args = { stateView: SV, poolManager: PM, poolId: id, head: 9000, chunk: 5000, windows: 3, hash: O.poolId };
  const r = await resolveKey(rpc([mk(k)]), args);
  assert.equal(r.fee, 3000); assert.equal(r.initializeBlock, logBlock); assert.equal(r.bisectedBlock, created);
  await assert.rejects(resolveKey(rpc([mk({ ...k, fee: 500 })]), args), /V4_KEY_HASH_MISMATCH/);
  await assert.rejects(resolveKey(rpc([mk(k), mk(k)]), args), /V4_INITIALIZE_LOG_AMBIGUOUS/);
  await assert.rejects(resolveKey(rpc([]), args), /V4_INITIALIZE_LOG_NOT_FOUND/);
});
test('persisted PoolKeys: validated shape, re-proved by hash before use, a poisoned entry is ignored', async () => {
  const S = require('../search/server/lib/market-verify-snapshot'), O = require('../search/server/lib/market-onchain');
  const k = { currency0: '0x' + '11'.repeat(20), currency1: '0x' + '22'.repeat(20), fee: 3000, tickSpacing: 60, hooks: '0x' + '00'.repeat(20) }, id = O.poolId(k);
  const doc = { v4Keys: { ['arc:' + id]: { ...k, resolvedVia: 'x' }, ['arc:0x' + 'cd'.repeat(32)]: { ...k, fee: 'x' } } };
  assert.deepEqual(S.v4KeyFor(doc, 'arc', id), k); assert.equal(S.v4KeyFor(doc, 'arc', '0x' + 'cd'.repeat(32)), null); assert.equal(S.v4KeyFor(null, 'arc', id), null);
  O._reset(); O._seedKey('arc', id, { ...k, fee: 500 }); // wrong key for this id: must not be cached
  const rpc = async () => { throw Object.assign(new Error('x'), { code: 'X' }); }, call = async () => { throw Error('x'); };
  await assert.rejects(O.v4Key(id, { network: 'arc', rpc, call, block: '0x1' }));
  O._seedKey('arc', id, k); assert.equal((await O.v4Key(id, { network: 'arc', rpc, call, block: '0x1' })).fee, 3000); O._reset();
});
