'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NETWORKS, createProjectCollector } = require('../lib/pulse-projects');
const { PROJECTS } = require('../lib/pulse-project-catalog');
const { now, publication } = require('./helpers/pulse-project-fixtures.cjs');

test('three distinct reviewed projects per network, ordered by evidence date and with historical claims separated', async () => {
  const collect = createProjectCollector({ fetcher: publication, now: () => now });
  for (const [chain, chainId] of Object.entries(NETWORKS)) {
    const view = await collect(chain);
    assert.equal(view.chainId, chainId);
    assert.equal(view.projectCards.length, 3);
    assert.equal(new Set(view.projectCards.map(card => card.projectId)).size, 3);
    for (const card of view.projectCards) {
      assert.ok(card.purpose && card.change && card.implication && card.limitation);
      assert.match(card.source.date, /^2026-\d\d-\d\d$/);
      assert.match(card.source.url, /^https:\/\//);
      assert.equal(card.source.evidence, 'SOURCE_VERIFIED_PUBLICATION');
      assert.equal(card.contentType, now - Date.parse(card.source.date) >= 28 * 86400000 ? 'PROJECT_PROFILE' : 'DATED_DEVELOPMENT');
    }
    assert.deepEqual(view.projectCards.map(c => c.source.date), view.projectCards.map(c => c.source.date).sort().reverse());
  }
  assert.equal((await collect('arc')).projectCards.at(-1).developmentStatus, 'HISTORICAL');
  assert.equal((await collect('robinhood')).projectCards.at(-1).developmentStatus, 'HISTORICAL');
  await assert.rejects(() => collect('polygon'), TypeError);
});

test('403 and 429 retain profiles and share cache across chains and simultaneous reads', async () => {
  let hits = 0, time = now;
  const fetcher = async url => {
    hits++;
    if (url.includes('aave.com')) return new Response(null, { status: 403 });
    if (url.includes('morpho.org')) return new Response(null, { status: 429, headers: { 'retry-after': '7200' } });
    return publication(url);
  };
  const collect = createProjectCollector({ fetcher, now: () => time });
  const [arc, ethereum] = await Promise.all([collect('arc'), collect('ethereum'), collect('arc')]);
  assert.equal(hits, 4);
  for (const view of [arc, ethereum]) {
    assert.equal(view.projectCards.length, 3);
    assert.equal(view.projectCards.find(c => c.projectId === 'aave').reason, 'SOURCE_BLOCKED');
    const limited = view.projectCards.find(c => c.projectId === 'morpho');
    assert.equal(limited.reason, 'RATE_LIMITED');
    assert.equal(limited.developmentStatus, 'SOURCE_UNAVAILABLE');
    assert.equal(limited.source.date, null);
  }
  time += 65 * 60000;
  await collect('arc');
  assert.equal(hits, 5, '403 may recover after one hour while 429 honors Retry-After');
  time += 60 * 60000;
  await collect('arc');
  assert.equal(hits, 7);
});

test('wrong-chain body, fake markup and a forum reply cannot verify an event', async () => {
  const collect = createProjectCollector({ now: () => now, fetcher: async url => {
    if (url.includes('morpho.org')) return new Response('<h1>Morpho Effect October 2026</h1>05 Nov 2026<p>Available on Base</p>');
    if (url.includes('aave.com')) return Response.json({ title: PROJECTS.arc[0].developments[0].title, post_stream: { posts: [
      { post_number: 2, username: 'AaveLabs', created_at: '2026-11-02T00:00:00Z', cooked: PROJECTS.arc[0].developments[0].marker },
    ] } });
    return new Response('<script>Uniswap Is Live on Arc 2026-09-16</script><p>Uniswap v2, v3, v4 and UniswapX are live on Arc</p>');
  } });
  assert.ok((await collect('arc')).projectCards.every(card => card.developmentStatus === 'UNVERIFIED' && card.source.date === null));
});

test('duplicate projects are one slot, older updates remain background and no candidates produce honest empty slots', async () => {
  const [project] = PROJECTS.arc;
  const collect = createProjectCollector({ fetcher: publication, now: () => now + 50 * 86400000,
    catalog: { arc: [project, { ...project, developments: [] }], ethereum: [] } });
  const arc = await collect('arc');
  assert.equal(arc.projectCards[0].developmentStatus, 'HISTORICAL');
  assert.equal(arc.projectCards[0].projectId, 'aave');
  assert.equal(arc.projectCards.filter(c => c.reason === 'INSUFFICIENT_REVIEWED_PROJECTS').length, 2);
  assert.equal((await collect('ethereum')).projectCards.filter(c => c.contentType === 'COVERAGE_EMPTY').length, 3);
  const future = createProjectCollector({ now: () => Date.parse('2026-08-01T00:00:00Z'),
    fetcher: () => assert.fail('Future source must not be fetched') });
  assert.ok((await future('arc')).projectCards.every(card => card.reason === 'NO_DATED_SOURCE'));
});

test('existing Pulse handler exposes the isolated project view without replacing legacy response fields', async t => {
  t.mock.method(globalThis, 'fetch', publication);
  const pulse = require('../api/pulse');
  const make = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  const result = make();
  await pulse({ method: 'GET', query: { view: 'projects', chain: 'ethereum' } }, result);
  assert.equal(result.code, 200);
  assert.equal(result.body.projectCards.length, 3);
  assert.ok(!Object.hasOwn(result.body, 'cards'));
  const archive = make();
  await pulse({ method: 'GET', query: { action: 'edition', number: '-1', view: 'projects' } }, archive);
  assert.equal(archive.body.error, 'INVALID_EDITION');
  const wrongChain = make();
  await pulse({ method: 'GET', query: { view: 'projects', chain: 'base' } }, wrongChain);
  assert.equal(wrongChain.body.error, 'INVALID_PULSE_CHAIN');
});
