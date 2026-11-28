'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { install, parse, blockedBy } = require('../scripts/provider-outage-shim.cjs');
test('parse: names, all, unknown ignored', () => {
  assert.deepEqual(parse('dexscreener, blockscout'), ['dexscreener', 'blockscout']);
  assert.equal(parse('all').length, 3); assert.deepEqual(parse('nonsense'), []); assert.deepEqual(parse(''), []);
});
test('hosts map to the right provider and RPC/Chainlink/Sourcify are never blocked', () => {
  const n = parse('all');
  assert.equal(blockedBy('https://api.dexscreener.com/latest/dex/tokens/0x1', n), 'dexscreener');
  assert.equal(blockedBy('https://api.geckoterminal.com/api/v2/networks', n), 'geckoterminal');
  assert.equal(blockedBy('https://eth.blockscout.com/api/v2/tokens/0x1', n), 'blockscout');
  assert.equal(blockedBy('https://robinhoodchain.blockscout.com/api', n), 'blockscout');
  for (const u of ['https://sepolia.rpc.example/', 'https://repo.sourcify.dev/x', 'https://assets.coingecko.com/img.png', 'https://evil-dexscreener.com.example.org/']) assert.equal(blockedBy(u, n), null);
});
test('install blocks only selected providers, counts calls, others pass through', async () => {
  const calls = [], fake = { fetch: async u => { calls.push(String(u)); return 'real'; } };
  const r = install('dexscreener', fake);
  await assert.rejects(fake.fetch('https://api.dexscreener.com/x'), /fetch failed/);
  assert.equal(await fake.fetch('https://api.geckoterminal.com/y'), 'real');
  assert.equal(r.blocked.dexscreener, 1); assert.deepEqual(calls, ['https://api.geckoterminal.com/y']);
});
