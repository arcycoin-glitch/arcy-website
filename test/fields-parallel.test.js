const { test } = require('node:test'), assert = require('node:assert/strict');
const fields = require('../lib/fields');

const empty = { value: null, status: 'NOT_VERIFIED', dataState: 'SOURCE_HAS_NO_DATA' };

test('parallel fallbacks start together and retain source-tier selection', async () => {
  const started = [];
  const result = await fields.resolveParallel([
    { name: 'highest', tier: 'ONCHAIN_VERIFIED', read: async () => { started.push('highest'); await new Promise(resolve => setTimeout(resolve, 25)); return { value: 'onchain', status: 'ONCHAIN_VERIFIED', dataState: 'DATA_FOUND' }; } },
    { name: 'lower', tier: 'MARKET_API_VERIFIED', read: async () => { started.push('lower'); await new Promise(resolve => setTimeout(resolve, 1)); return { value: 'market', status: 'MARKET_API_VERIFIED', dataState: 'DATA_FOUND' }; } }
  ]);
  assert.deepEqual(started.sort(), ['highest', 'lower']);
  assert.equal(result.value, 'onchain');
  assert.deepEqual(result.attempts.map(attempt => attempt.source), ['highest']);
});

test('parallel fallbacks use an already-completed lower-tier result after an unavailable preferred source', async () => {
  const started = [];
  const result = await fields.resolveParallel([
    { name: 'preferred', tier: 'ONCHAIN_VERIFIED', read: async () => { started.push('preferred'); await new Promise(resolve => setTimeout(resolve, 20)); return empty; } },
    { name: 'fallback', tier: 'MARKET_API_VERIFIED', read: async () => { started.push('fallback'); return { value: 42, status: 'MARKET_API_VERIFIED', dataState: 'DATA_FOUND' }; } }
  ]);
  assert.deepEqual(started.sort(), ['fallback', 'preferred']);
  assert.equal(result.value, 42);
  assert.deepEqual(result.attempts.map(attempt => attempt.source), ['preferred', 'fallback']);
});
