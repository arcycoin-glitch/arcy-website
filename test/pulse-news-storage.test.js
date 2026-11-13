'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const pulse = require('../api/pulse');
const news = require('../lib/pulse-projects');
const { createStore, createClient, INTERVAL_MS, unpack } = require('../lib/pulse-news-storage');
const networkHttp = require('../lib/pulse-network-http');
const worker = require('../lib/pulse-worker-refresh');

const START = Date.parse('2026-11-14T12:00:00.000Z');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PRIVATE = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' });
const workerOrigin = 'https://pulse-worker.example';

function signature(state, key = privateKey) {
  const payload = JSON.stringify(state);
  return { payload, signature: crypto.sign(null, Buffer.from(payload), key).toString('base64') };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
    end(body) { this.body = JSON.parse(body); }
  };
}

async function fixture(t, scan) {
  const root = await fs.mkdtemp(path.join(__dirname, '.pulse-news-'));
  t.after(async () => {
    const target = await fs.realpath(root);
    assert.equal(path.dirname(target), await fs.realpath(__dirname));
    assert.match(path.basename(target), /^\.pulse-news-/);
    await fs.rm(target, { recursive: true, force: true });
  });
  let time = START;
  const env = { ARC_HOLDER_PUBLISHED_DIR: root, ARC_HOLDER_SIGNING_KEY: PRIVATE };
  const now = () => time;
  return {
    root, env, now, advance(ms) { time += ms; },
    store: () => createStore({ env, now, scan }),
    file: path.join(root, 'pulse-news.v1.json')
  };
}

function outage(options) {
  return news.scanNews({ ...options, fetcher: async () => new Response('', { status: 503 }) });
}

function checkedEthereum(options) {
  return news.scanNews({ ...options, fetcher: async url => String(url).startsWith('https://blog.ethereum.org/')
    ? new Response('<rss version="2.0"><channel></channel></rss>')
    : new Response('', { status: 503 }) });
}

test('one worker cohort reserves cadence before scanning and survives restart', async t => {
  let calls = 0;
  let begin;
  let proceed;
  const started = new Promise(resolve => { begin = resolve; });
  const wait = new Promise(resolve => { proceed = resolve; });
  const fixtureData = await fixture(t, async options => {
    calls++;
    begin();
    await wait;
    return outage(options);
  });
  const { store, now, advance, root } = fixtureData;
  const first = store();
  const running = first.refreshIfDue();
  await started;
  const concurrent = first.refreshIfDue();
  const restarted = store();
  const reserved = unpack(await restarted.latest(), PUBLIC, now());
  assert.equal(reserved.attempt, 'CHECKING');
  assert.equal(reserved.snapshot, null);
  assert.equal(Date.parse(reserved.nextAttemptAt), START + INTERVAL_MS);
  assert.equal(await restarted.refreshIfDue(), null);
  assert.equal(calls, 1);
  proceed();
  assert.deepEqual(await concurrent, await running);
  assert.equal((await first.refreshIfDue()), null);
  assert.deepEqual(await fs.readdir(root), ['pulse-news.v1.json']);

  const state = unpack(await restarted.latest(), PUBLIC, now());
  assert.equal(state.attempt, 'CHECKED');
  assert.deepEqual(state.lastSuccessfulAt, { arc: null, ethereum: null, robinhood: null });
  assert.equal(state.snapshot.checkedAt, new Date(START).toISOString());
  advance(INTERVAL_MS);
  await restarted.refreshIfDue();
  assert.equal(calls, 2);
});

test('a corrupt or wrong-key publication is rejected and an incomplete newer atomic write is ignored', async t => {
  const { file, store, now, advance } = await fixture(t, outage);
  const fresh = store();
  await fresh.refreshIfDue();
  const saved = await fresh.latest();
  const unrelated = crypto.generateKeyPairSync('ed25519').publicKey;
  assert.equal(unpack(saved, unrelated, now()), null);
  const state = unpack(saved, PUBLIC, now());
  assert.ok(state);
  assert.equal(unpack(signature({ ...state, snapshot: { ...state.snapshot, events: ['fake'] } }), PUBLIC, now()), null);
  assert.equal(unpack(signature({ ...state, nextAttemptAt: new Date(START + 48 * INTERVAL_MS).toISOString() }), PUBLIC, now()), null);

  await fs.writeFile(file + '.pending', '{orphaned write');
  assert.deepEqual(await store().latest(), saved);
  await fs.writeFile(file, JSON.stringify({ ...saved, payload: saved.payload.replace('CHECKED', 'FAILED') }));
  assert.equal(await store().latest(), null);
  advance(INTERVAL_MS);
  await store().refreshIfDue();
  assert.equal(unpack(await fresh.latest(), PUBLIC, now()).snapshot.checkedAt, new Date(now()).toISOString());
});

test('outage and hard failure preserve per-chain success and cooldown through restart', async t => {
  let fail = false;
  let reject = false;
  let captured;
  const { store, now, advance } = await fixture(t, async options => {
    captured = options.cooldowns;
    if (reject) throw Error('simulated scanner failure');
    return fail ? outage(options) : checkedEthereum(options);
  });
  const first = store();
  await first.refreshIfDue();
  const saved = unpack(await first.latest(), PUBLIC, now());
  const success = { arc: null, ethereum: new Date(START).toISOString(), robinhood: null };
  assert.deepEqual(saved.lastSuccessfulAt, success);
  assert.ok(Object.keys(saved.snapshot.cooldowns).length > 0);

  advance(INTERVAL_MS);
  fail = true;
  await store().refreshIfDue();
  assert.deepEqual(captured, saved.snapshot.cooldowns);
  const unavailable = unpack(await first.latest(), PUBLIC, now());
  assert.deepEqual(unavailable.lastSuccessfulAt, success);
  assert.deepEqual(unavailable.lastVerifiedSnapshot, saved.snapshot);
  assert.ok(unavailable.snapshot.sources.every(source => source.state !== 'CHECKED'));
  const view = createClient({ env: { ARC_PULSE_PUBLISHED_URL: workerOrigin, ARC_PULSE_PUBLIC_KEY: PUBLIC }, now,
    fetcher: async () => Response.json(await first.latest()) });
  const response = await view('ethereum');
  assert.equal(response.lastSuccessfulAt, success.ethereum);
  assert.ok(response.projectCards.every(card => card.state === 'SOURCE_UNAVAILABLE'));

  advance(INTERVAL_MS);
  reject = true;
  const failed = await store().refreshIfDue();
  assert.deepEqual(failed, { state: 'FAILED', reasonCode: 'PULSE_NEWS_REFRESH_FAILED' });
  const history = unpack(await first.latest(), PUBLIC, now());
  assert.equal(history.attempt, 'FAILED');
  assert.deepEqual(history.lastSuccessfulAt, success);
  assert.deepEqual(history.lastVerifiedSnapshot, saved.snapshot);
  assert.equal((await view('ethereum')).freshness, 'STALE');
});

test('due browser reads coalesce and use an authenticated bounded worker-only refresh', async t => {
  const { store, now, advance } = await fixture(t, outage);
  const disk = store();
  await disk.refreshIfDue();
  const saved = await disk.latest();
  const env = { ARC_PULSE_PUBLISHED_URL: workerOrigin, ARC_PULSE_PUBLIC_KEY: PUBLIC,
    ARC_PULSE_QUEUE_URL: workerOrigin, ARC_PULSE_QUEUE_TOKEN: 'secret' };
  const calls = [];
  let reachable = true;
  const view = createClient({ env, now, fetcher: async (url, options) => {
    assert.equal(url.origin, workerOrigin);
    assert.equal(options.redirect, 'error');
    calls.push([url.pathname, options.method]);
    if (options.method === 'POST') {
      assert.equal(options.headers.authorization, 'Bearer secret');
      return Response.json({ ok: true }, { status: 202 });
    }
    assert.equal(options.headers, undefined);
    return reachable ? Response.json(saved) : new Response('', { status: 503 });
  } });
  advance(INTERVAL_MS);
  const chainViews = await Promise.all(Object.keys(news.NETWORKS).map(view));
  assert.deepEqual(calls, [['/pulse/news/latest', undefined], ['/pulse/news/refresh', 'POST']]);
  for (const chainView of chainViews) assert.equal(chainView.projectCards.length, 3);

  advance(50 * 60_000);
  reachable = false;
  const stale = await view('arc');
  assert.equal(stale.projectCards.length, 3);
  assert.equal(stale.freshness, 'STALE');
  assert.equal(stale.checkedAt, new Date(START).toISOString());
  assert.ok(stale.projectCards.every(card => card.source?.url === undefined || card.source === null));
  assert.equal(calls.length, 4);
});

test('worker on-demand wake requires timing-safe auth and starts the existing bounded poll', async t => {
  const key = 'ARC_PULSE_QUEUE_TOKEN';
  const previous = process.env[key];
  process.env[key] = 'worker-secret';
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const storage = require('../lib/pulse-news-storage');
  t.mock.method(storage, 'configured', () => true);
  const run = t.mock.method(storage.worker, 'refreshIfDue', async () => null);
  const req = { method: 'POST', url: '/pulse/news/refresh', headers: { authorization: 'Bearer wrong' } };
  const denied = response();
  assert.equal(networkHttp.matches(req), true);
  await networkHttp.handle(req, denied);
  assert.equal(denied.statusCode, 401);
  assert.equal(run.mock.callCount(), 0);
  const accepted = response();
  await networkHttp.handle({ ...req, headers: { authorization: 'Bearer worker-secret' } }, accepted);
  assert.equal(accepted.statusCode, 202);
  assert.equal(run.mock.callCount(), 1);
});

test('weekly worker trigger starts news without waiting or changing existing weekly failure', async () => {
  let calls = 0;
  const result = await worker.refreshIfDue({
    now: 8 * 3600000,
    env: { ARC_PULSE_EDITION_DIR: '/data', ARC_PULSE_SIGNING_KEY: 'test-key' },
    newsRefresh: () => { calls++; return new Promise(() => {}); },
    storage: { latest: async () => null, audit: async () => null, failure: async () => {} },
    edition: { cycle: () => ({ start: 0 }), number: () => 1, generate: async () => {
      throw Object.assign(Error(), { code: 'PULSE_SOURCE_COVERAGE_INCOMPLETE' });
    } }
  });
  assert.equal(calls, 1);
  assert.equal(result.component, 'SIGNED_EDITION');
  assert.equal(result.reasonCode, 'PULSE_SOURCE_COVERAGE_INCOMPLETE');
});

test('the existing API route uses signed worker reads and leaves archive routing untouched', async t => {
  const storage = require('../lib/pulse-news-storage');
  const read = t.mock.method(storage, 'latestNews', async chain => news.emptyView(chain));
  const result = response();
  await pulse({ method: 'GET', query: { view: 'projects', chain: 'ethereum' } }, result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.body.projectCards.length, 3);
  assert.equal(read.mock.callCount(), 1);
  assert.deepEqual(read.mock.calls[0].arguments, ['ethereum']);
  const archive = response();
  await pulse({ method: 'GET', query: { action: 'edition', number: '-1', view: 'projects' } }, archive);
  assert.equal(archive.statusCode, 400);
  assert.equal(archive.body.error, 'INVALID_EDITION');
  assert.equal(read.mock.callCount(), 1);
  read.mock.mockImplementation(async () => { throw Error('worker transport failed'); });
  const failed = response();
  await pulse({ method: 'GET', query: { view: 'projects', chain: 'ethereum' } }, failed);
  assert.equal(failed.statusCode, 200);
  assert.deepEqual(failed.body.projectCards.map(card => card.category), news.SLOTS);
  assert.ok(failed.body.projectCards.every(card => card.state === 'SOURCE_UNAVAILABLE' && card.event === null));
});
