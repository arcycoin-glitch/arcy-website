'use strict';
// Browser verification of owner-traffic exclusion: counts the actual network requests a
// Vercel-Web-Analytics-compatible tracker sends to /_vercel/insights/* with and without opt-out.
// /_vercel/insights/script.js only exists on Vercel, so locally it is served by a stand-in that
// follows the documented contract (drain window.vaq, honour beforeSend → null, send a pageview on
// load and on history navigation). Production must additionally be checked against the real script.
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const port = Number(process.env.PORT || 3121);
const origin = `http://127.0.0.1:${port}`;

const TRACKER = `(() => {
  const q = window.vaq || [];
  let beforeSend = null;
  const handle = (name, fn) => { if (name === 'beforeSend') beforeSend = fn; };
  q.forEach(args => handle(...args));
  window.va = (...args) => handle(...args);
  const send = type => {
    let event = { type, url: location.href };
    if (beforeSend) { event = beforeSend(event); if (!event) { window.__vaDropped = (window.__vaDropped || 0) + 1; return; } }
    fetch('/_vercel/insights/' + (type === 'pageview' ? 'view' : 'event'), { method: 'POST', keepalive: true, body: JSON.stringify({ o: event.url }) });
  };
  const push = history.pushState;
  history.pushState = function (...a) { push.apply(this, a); send('pageview'); };
  addEventListener('popstate', () => send('pageview'));
  window.__vaLoaded = true;
  send('pageview');
})();`;

async function newContext(browser, options) {
  const context = await browser.newContext(options);
  const sent = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 204, body: '' }); // no third-party traffic in tests
    if (url.pathname === '/_vercel/insights/script.js') return route.fulfill({ contentType: 'application/javascript', body: TRACKER });
    if (url.pathname.startsWith('/_vercel/insights/')) { sent.push(url.pathname); return route.fulfill({ status: 200, body: 'ok' }); }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { ok: false, error: 'DATA UNAVAILABLE' } });
    return route.continue();
  });
  return { context, sent };
}

const layout = page => page.evaluate(() => [...document.querySelectorAll('header, nav, main, section, .card, .home-search, footer')]
  .map(n => { const r = n.getBoundingClientRect(); return [n.tagName, n.className, Math.round(r.x), Math.round(r.width), Math.round(r.height)].join(':'); }).join('|'));

async function visitHome(page) {
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vaLoaded === true);
  await page.waitForTimeout(300);
}

async function scenario(browser, label, options) {
  const { context, sent } = await newContext(browser, options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. Baseline: an ordinary browser is counted.
  await visitHome(page);
  assert.ok(sent.filter(p => p === '/_vercel/insights/view').length >= 1, `${label}: normal browser sends a pageview`);
  const layoutTracked = await layout(page);

  // 2. Owner opts out on the standalone page (which itself sends nothing).
  sent.length = 0;
  await page.goto(origin + '/owner-analytics.html');
  assert.match(await page.locator('#status').innerText(), /Tracking active/);
  await page.locator('#exclude').click();
  assert.match(await page.locator('#status').innerText(), /Excluded/);
  assert.equal(await page.locator('#exclude').isDisabled(), true);
  assert.equal(sent.length, 0, `${label}: owner page never contacts the tracker`);

  // 3. Opted-out browser: zero requests on load, reload, in-page navigation and back/forward.
  await visitHome(page);
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.__vaLoaded === true);
  await page.evaluate(() => history.pushState({}, '', '/?pulseEdition=1#pulse'));
  await page.goto(origin + '/radar.html'); await page.goBack({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__vaLoaded === true);
  await page.evaluate(() => { history.pushState({}, '', '/#search'); history.back(); });
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => window.__vaDropped >= 1), `${label}: tracker ran and its events were dropped by beforeSend`);
  assert.deepEqual(sent, [], `${label}: opted-out browser sent zero analytics requests`);
  assert.equal(await page.evaluate(() => localStorage.getItem('va-disable')), '1');
  assert.ok((await context.cookies()).some(c => c.name === 'va_disable' && c.value === '1'));
  const layoutExcluded = await layout(page);

  // 4. Owner page reflects persisted state after navigation; re-enable restores tracking.
  await page.goto(origin + '/owner-analytics.html');
  assert.match(await page.locator('#status').innerText(), /Excluded/);
  await page.locator('#include').click();
  assert.match(await page.locator('#status').innerText(), /Tracking active/);
  await visitHome(page);
  assert.ok(sent.filter(p => p === '/_vercel/insights/view').length >= 1, `${label}: re-enabled browser is counted again`);
  assert.equal(await page.evaluate(() => localStorage.getItem('va-disable')), null);
  assert.ok(!(await context.cookies()).some(c => c.name === 'va_disable'));

  // 5. Exclusion must not change anything visible.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no horizontal overflow`);
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await context.close();
  assert.equal(layoutExcluded, layoutTracked, `${label}: identical layout with and without exclusion`);
  return { label, layoutNodes: layoutTracked.split('|').length, viewRequestsWhileExcluded: 0 };
}

(async () => {
  const server = spawn(process.execPath, ['dev.cjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error('Local preview startup timeout')), 10000);
      server.stdout.once('data', () => { clearTimeout(t); resolve(); });
      server.once('error', reject);
    });
    browser = await chromium.launch({ headless: true, ...(process.env.ARCY_BROWSER_CHANNEL ? { channel: process.env.ARCY_BROWSER_CHANNEL } : {}) });
    const results = [];
    results.push(await scenario(browser, 'desktop 1440', { viewport: { width: 1440, height: 900 } }));
    results.push(await scenario(browser, 'mobile iPhone 13', { ...devices['iPhone 13'], defaultBrowserType: undefined }));
    results.push(await scenario(browser, 'mobile Pixel 7', { ...devices['Pixel 7'], defaultBrowserType: undefined }));

    // Independence: one browser opting out never affects another.
    const a = await newContext(browser, {}); const b = await newContext(browser, {});
    const pa = await a.context.newPage(); const pb = await b.context.newPage();
    await pa.goto(origin + '/owner-analytics.html'); await pa.locator('#exclude').click();
    await visitHome(pa); await visitHome(pb);
    assert.deepEqual(a.sent, []);
    assert.ok(b.sent.includes('/_vercel/insights/view'), 'other visitors remain counted');

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
