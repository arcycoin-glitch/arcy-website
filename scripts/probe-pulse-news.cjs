'use strict';

// Read-only acceptance run against official HTTP feeds. No RPC, worker writes, or production config.
const assert = require('node:assert/strict');
const { NETWORKS, SLOTS, scanNews, validSnapshot, newsView } = require('../lib/pulse-projects');

async function main() {
  const started = Date.now();
  const snapshot = await scanNews({ now: started });
  assert.ok(validSnapshot(snapshot), 'Live scan must produce a valid snapshot');
  const views = Object.keys(NETWORKS).map(chain => newsView(snapshot, chain, { mode: 'ON_DEMAND' }));
  const result = { commit: process.env.GITHUB_SHA || null, checkedAt: snapshot.checkedAt,
    durationMs: Date.now() - started, httpRequests: snapshot.requests, rpcRequests: 0,
    sources: snapshot.sources, networks: views.map(({ chain, chainId, freshness, sourceCoverage, projectCards }) =>
      ({ chain, chainId, freshness, sourceCoverage, projectCards })) };
  console.log(JSON.stringify(result, null, 2));
  for (const view of views) {
    assert.deepEqual(view.projectCards.map(card => card.category), SLOTS);
    assert.ok(view.sourceCoverage.checked > 0, `No reviewed sources could be reached for ${view.chain}`);
    const populated = view.projectCards.filter(card => card.state === 'VERIFIED');
    assert.equal(new Set(populated.map(card => card.event.url)).size, populated.length);
    assert.ok(view.projectCards.every(card => (card.state === 'VERIFIED') === Boolean(card.event)));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
