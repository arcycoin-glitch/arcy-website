'use strict';
// Owner-traffic exclusion for Vercel Web Analytics (analytics.js + owner-analytics.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');

// Minimal cookie jar honouring Max-Age=0 deletion; Domain/Path/Secure are ignored (single host).
function makeEnv({ hostname = 'www.arcyusdc.xyz', protocol = 'https:', storage = {}, cookies = {}, dnt = null, throwStorage = false } = {}) {
  const writes = [];
  const store = { ...storage };
  const jar = { ...cookies };
  const localStorage = {
    getItem(k) { if (throwStorage) throw Error('blocked'); return Object.hasOwn(store, k) ? store[k] : null; },
    setItem(k, v) { if (throwStorage) throw Error('blocked'); store[k] = String(v); },
    removeItem(k) { if (throwStorage) throw Error('blocked'); delete store[k]; },
  };
  const document = {};
  Object.defineProperty(document, 'cookie', {
    get() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    set(raw) {
      writes.push(raw);
      const [pair, ...attrs] = raw.split(';').map(s => s.trim());
      const [name, value] = pair.split('=');
      const maxAge = attrs.find(a => /^max-age=/i.test(a));
      if (maxAge && Number(maxAge.split('=')[1]) <= 0) delete jar[name]; else jar[name] = value;
    },
  });
  const window = {};
  const ctx = { window, localStorage, document, location: { hostname, protocol }, navigator: { doNotTrack: dnt }, URL, Object };
  window.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const beforeSend = window.vaq.find(args => args[0] === 'beforeSend')[1];
  return { window, store, jar, writes, beforeSend, api: window.arcyAnalyticsOptOut };
}

const pageview = { type: 'pageview', url: 'https://www.arcyusdc.xyz/?q=secret#search' };

test('queues exactly one beforeSend hook via the official va() queue', () => {
  const { window } = makeEnv();
  assert.equal(window.vaq.filter(a => a[0] === 'beforeSend').length, 1);
  assert.equal(typeof window.va, 'function');
});

test('ordinary visitors are still tracked (query and hash stripped as before)', () => {
  const { beforeSend, api } = makeEnv();
  assert.equal(api.isExcluded(), false);
  assert.deepEqual({ ...beforeSend(pageview) }, { type: 'pageview', url: 'https://www.arcyusdc.xyz/' });
});

test('Do Not Track behaviour is unchanged', () => {
  assert.equal(makeEnv({ dnt: '1' }).beforeSend(pageview), null);
});

test('exclude() drops every event and persists in localStorage and a shared cookie', () => {
  const env = makeEnv();
  assert.equal(env.api.exclude(), true);
  assert.equal(env.store['va-disable'], '1');
  assert.equal(env.jar.va_disable, '1');
  assert.ok(env.writes.some(w => /Domain=arcyusdc\.xyz/.test(w) && /Secure/.test(w) && /SameSite=Lax/.test(w)), 'cookie shared across apex and www');
  assert.equal(env.beforeSend(pageview), null);
  assert.equal(env.beforeSend({ type: 'event', url: pageview.url }), null, 'custom events are dropped too');
});

test('exclusion survives a reload (fresh script run) via either store', () => {
  assert.equal(makeEnv({ storage: { 'va-disable': '1' } }).beforeSend(pageview), null);
  const viaCookie = makeEnv({ hostname: 'arcyusdc.xyz', cookies: { va_disable: '1' } });
  assert.equal(viaCookie.beforeSend(pageview), null, 'cookie set on www is honoured on apex');
  assert.equal(viaCookie.store['va-disable'], '1', 'cookie-only exclusion is synced back into localStorage');
});

test('include() re-enables tracking and clears both stores', () => {
  const env = makeEnv({ storage: { 'va-disable': '1' }, cookies: { va_disable: '1' } });
  assert.equal(env.api.include(), true);
  assert.equal(env.store['va-disable'], undefined);
  assert.equal(env.jar.va_disable, undefined);
  assert.notEqual(env.beforeSend(pageview), null);
});

test('blocked localStorage falls back to the cookie and never throws', () => {
  const env = makeEnv({ throwStorage: true });
  assert.equal(env.api.exclude(), true);
  assert.equal(env.beforeSend(pageview), null);
  assert.equal(env.api.include(), true);
  assert.notEqual(env.beforeSend(pageview), null);
});

test('no Domain attribute outside arcyusdc.xyz (previews, localhost)', () => {
  const env = makeEnv({ hostname: 'arcy-website-git-x.vercel.app' });
  env.api.exclude();
  assert.ok(env.writes.every(w => !/Domain=/.test(w)));
  const local = makeEnv({ hostname: '127.0.0.1', protocol: 'http:' });
  local.api.exclude();
  assert.ok(local.writes.every(w => !/Secure/.test(w)), 'Secure only on https');
});

test('homepage loads analytics config once, before the Vercel script, without duplicates', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cfg = [...html.matchAll(/src="\/analytics\.js"/g)];
  const va = [...html.matchAll(/\/_vercel\/insights\/script\.js/g)];
  assert.equal(cfg.length, 1);
  assert.equal(va.length, 1);
  assert.ok(html.indexOf('/analytics.js') < html.indexOf('/_vercel/insights/script.js'));
});

test('owner page is standalone, noindex, unlinked, and never loads the tracker', () => {
  const html = fs.readFileSync(path.join(root, 'owner-analytics.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /Exclude This Device/);
  assert.match(html, /Enable Tracking Again/);
  assert.doesNotMatch(html, /_vercel\/insights/);
  assert.doesNotMatch(html, /token|secret|password|api[_-]?key/i);
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rule = vercel.headers.find(h => h.source === '/owner-analytics.html');
  assert.match(rule.headers.find(h => h.key === 'X-Robots-Tag').value, /noindex/);
  for (const file of fs.readdirSync(root).filter(f => /\.(html|js|xml|txt)$/.test(f) && f !== 'owner-analytics.html')) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /owner-analytics\.html/, `${file} must not link the owner page`);
  }
});
