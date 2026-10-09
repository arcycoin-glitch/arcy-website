const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const calendar = require('../lib/unlock-calendar'), storage = require('../lib/unlock-storage');

function response(body, url = 'https://api.coinbell.in/token-unlocks?sort=soonest&window=30') { return { ok: true, url, text: async () => body, json: async () => ({}) }; }
function calendarHtml() { return '<table><tr><th>#</th></tr><tr><td>1</td><td>Example Token AAA</td><td>12 Oct 2026</td><td>1.5M AAA</td><td>$1</td><td>2%</td><td>Team</td></tr></table>'; }

test('durable unlock editions retain the last valid six-hour snapshot after a source failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcy-unlocks-'));
  const old = { directory: process.env.ARC_UNLOCK_EDITION_DIR, signing: process.env.ARC_UNLOCK_SIGNING_KEY, public: process.env.ARC_UNLOCK_PUBLIC_KEY };
  const pair = crypto.generateKeyPairSync('ed25519');
  process.env.ARC_UNLOCK_EDITION_DIR = directory;
  process.env.ARC_UNLOCK_SIGNING_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.ARC_UNLOCK_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' });
  try {
    const now = Date.parse('2026-10-09T00:00:00Z');
    const edition = await calendar.generate({ now, trigger: 'worker', fetcher: async () => response(calendarHtml()) });
    assert.equal(edition.events.length, 1);
    assert.equal(edition.windows.next7.length, 1);
    assert.equal(Date.parse(edition.refreshAt) - now, calendar.REFRESH_MS);
    await storage.publish(edition);
    const current = await storage.latest();
    assert.equal(current.events[0].symbol, 'AAA');
    await assert.rejects(calendar.generate({ now, fetcher: async () => { throw Error('offline'); } }), error => error.code === 'UNLOCK_DISCOVERY_UNAVAILABLE');
    await storage.failure(Object.assign(Error('offline'), { code: 'UNLOCK_DISCOVERY_UNAVAILABLE' }), now + 1, 'worker');
    assert.equal((await storage.latest()).generatedAt, edition.generatedAt);
    assert.equal((await storage.audit()).lastFailure.code, 'UNLOCK_DISCOVERY_UNAVAILABLE');
  } finally {
    if (old.directory === undefined) delete process.env.ARC_UNLOCK_EDITION_DIR; else process.env.ARC_UNLOCK_EDITION_DIR = old.directory;
    if (old.signing === undefined) delete process.env.ARC_UNLOCK_SIGNING_KEY; else process.env.ARC_UNLOCK_SIGNING_KEY = old.signing;
    if (old.public === undefined) delete process.env.ARC_UNLOCK_PUBLIC_KEY; else process.env.ARC_UNLOCK_PUBLIC_KEY = old.public;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('unlock calendar rejects expired and conflicting source records instead of publishing them', () => {
  const now = Date.parse('2026-10-09T00:00:00Z');
  const rows = calendar.parseRows(calendarHtml(), 'https://api.coinbell.in/token-unlocks?sort=soonest', now);
  assert.equal(rows.length, 1);
  const conflicting = { ...rows[0], amount: '2M AAA', sourceUrl: 'https://api.coinbell.in/token-unlocks?sort=value' };
  const merged = calendar.mergeEvents([rows[0], conflicting]);
  assert.equal(merged.events.length, 0);
  assert.equal(merged.conflicts.length, 1);
});

test('worker exposes only a signed latest-good unlock edition without authentication', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'arcy-unlock-http-'));
  const before = { directory: process.env.ARC_UNLOCK_EDITION_DIR, signing: process.env.ARC_UNLOCK_SIGNING_KEY, public: process.env.ARC_UNLOCK_PUBLIC_KEY, token: process.env.ARC_HOLDER_QUEUE_TOKEN, port: process.env.PORT };
  const pair = crypto.generateKeyPairSync('ed25519');
  process.env.ARC_UNLOCK_EDITION_DIR = directory;
  process.env.ARC_UNLOCK_SIGNING_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.ARC_UNLOCK_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' });
  process.env.ARC_HOLDER_QUEUE_TOKEN = 'test-only-worker-token';
  process.env.PORT = '0';
  let server;
  try {
    const edition = await calendar.generate({ now: Date.parse('2026-10-09T00:00:00Z'), fetcher: async () => response(calendarHtml()) });
    await storage.publish(edition);
    server = require('../lib/holder-worker-http').start();
    await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
    const responseValue = await fetch(`http://127.0.0.1:${server.address().port}/unlocks/latest`);
    assert.equal(responseValue.status, 200);
    const envelope = await responseValue.json();
    assert.equal(crypto.verify(null, Buffer.from(envelope.payload), process.env.ARC_UNLOCK_PUBLIC_KEY, Buffer.from(envelope.signature, 'base64')), true);
    assert.equal(JSON.parse(envelope.payload).events[0].symbol, 'AAA');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(before)) {
      const name = { directory: 'ARC_UNLOCK_EDITION_DIR', signing: 'ARC_UNLOCK_SIGNING_KEY', public: 'ARC_UNLOCK_PUBLIC_KEY', token: 'ARC_HOLDER_QUEUE_TOKEN', port: 'PORT' }[key];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Vercel Unlocks API returns a verified worker edition before attempting legacy live collection', async () => {
  const old = { url: process.env.ARC_UNLOCK_PUBLISHED_URL, key: process.env.ARC_UNLOCK_PUBLIC_KEY };
  const pair = crypto.generateKeyPairSync('ed25519');
  process.env.ARC_UNLOCK_PUBLISHED_URL = 'https://unlock-publication.example/';
  process.env.ARC_UNLOCK_PUBLIC_KEY = pair.publicKey.export({ type: 'spki', format: 'pem' });
  try {
    const edition = { schemaVersion: 1, success: true, events: [], windows: { today: [], next7: [], days8to30: [] }, generatedAt: '2026-10-09T00:00:00.000Z', refreshAt: '2026-10-09T06:00:00.000Z', trigger: 'worker' };
    const payload = JSON.stringify(edition), envelope = { payload, signature: crypto.sign(null, Buffer.from(payload), pair.privateKey).toString('base64') };
    const root = path.resolve(__dirname, '..'), evidence = (await fs.readFile(path.join(root, 'lib/unlock-evidence.js'), 'utf8')).replaceAll('export const', 'const'), source = (await fs.readFile(path.join(root, 'api/unlocks.js'), 'utf8')).replace(/^import .*unlock-evidence.*;\r?\n/m, '').replace('export default async function handler', 'async function handler');
    let fetches = 0;
    const context = vm.createContext({ process, AbortSignal, URL, URLSearchParams, Date, TextEncoder, atob, crypto: crypto.webcrypto, fetch: async () => { fetches++; return { ok: true, json: async () => envelope }; } });
    vm.runInContext(evidence, context); vm.runInContext(source, context);
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return value; } };
    await context.handler({}, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.audit.lastSuccessful.trigger, 'worker');
    assert.equal(fetches, 1);
  } finally {
    if (old.url === undefined) delete process.env.ARC_UNLOCK_PUBLISHED_URL; else process.env.ARC_UNLOCK_PUBLISHED_URL = old.url;
    if (old.key === undefined) delete process.env.ARC_UNLOCK_PUBLIC_KEY; else process.env.ARC_UNLOCK_PUBLIC_KEY = old.key;
  }
});

