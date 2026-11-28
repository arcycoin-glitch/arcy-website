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
