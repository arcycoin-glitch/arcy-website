'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');

const origin = 'http://127.0.0.1:3187';
const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const MINUTE = 60000;
const categories = ['ACHIEVED', 'UPCOMING', 'RISK_ALERT'];
const chains = { arc: [5042, 'Arc'], ethereum: [1, 'Ethereum'], robinhood: [4663, 'Robinhood Chain'] };
const editionCard = { kind: 'week', title: 'Historical Pulse #003 fixture', summary: 'This is an archived article.', url: 'https://www.circle.com/' };
const legacy = { ok: true, number: 3, take: 'Archived research fixture', cards: [
  editionCard,
] };
const currentWeekly = {
  ...legacy, take: 'Current Arc weekly take', chains: Object.fromEntries(Object.entries(chains).slice(1).map(([chain, [chainId, name]]) => [chain, {
    chain, chainId, number: 4, take: 'Current ' + name + ' weekly take', cards: Array.from({ length: 3 }, () => editionCard),
  }]))
};

function snapshot(chain, { revision = 'First', checked = NOW, expires = checked + 15 * MINUTE } = {}) {
  return { ok: true, projectSchemaVersion: 2, chain, chainId: chains[chain][0], freshness: 'FRESH', delivery: 'DURABLE',
    lastSuccessfulAt: new Date(checked).toISOString(), checkedAt: new Date(checked).toISOString(), expiresAt: new Date(expires).toISOString(),
    projectCards: categories.map((category, index) => ({
      category, state: 'VERIFIED', reasonCode: 'ATTRIBUTED_PUBLICATION', event: {
        project: 'Fixture project ' + (index + 1), publisher: 'Fixture publisher', title: `${revision} ${chains[chain][1]} ${category}`,
        summary: 'Primary-source summary fixture.', url: `https://www.arc.io/blog/fixture-${chain}-${index}`, publishedAt: '2026-11-13T07:30:00.000Z',
        targetAt: index === 1 ? '2026-11-20' : null, targetStatus: index === 1 ? 'SCHEDULED' : null,
        evidenceGrade: ['MERGED_CODE', 'OFFICIAL_ANNOUNCEMENT', 'OFFICIAL_ADVISORY'][index],
        incidentStatus: index === 2 ? 'MONITORING' : null, reference: index === 2 ? 'fixture-advisory' : null,
        limitation: ['The merge provides repository evidence. Live deployment remains unconfirmed.', 'The scheduled date may change.',
          'The publisher reported the incident. Independent on-chain confirmation is unavailable.'][index],
      }
    }))
  };
}

function routePulse(page, projects) {
  return page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/pulse') return route.fulfill({ status: 503, json: { ok: false } });
    if (url.searchParams.get('view') === 'projects') return projects(route, url.searchParams.get('chain'));
    const chain = url.searchParams.get('networkArchive');
    if (chain === 'ethereum') return route.fulfill({ json: { ...legacy, chains: { ethereum: {
      chain, chainId: 1, number: 3, contentNotice: 'Archived Ethereum fixture', take: 'Archived Ethereum take',
      cards: Array.from({ length: 3 }, (_, index) => ({ ...editionCard, title: 'Historical Ethereum card ' + (index + 1) })),
    } } } });
    return route.fulfill({ json: url.searchParams.has('action') ? legacy : currentWeekly });
  });
}

async function verifyRefresh(browser) {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.clock.install({ time: NOW });
    await page.addInitScript(() => {
      let hidden = false;
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      window.setVisibilityFixture = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
    });
    let requests = 0;
    await routePulse(page, async (route, chain) => {
      requests++;
      if (requests === 1) return route.fulfill({ json: snapshot(chain, { expires: NOW + 6 * MINUTE }) });
      if (requests === 2) return route.fulfill({ status: 429, headers: { 'retry-after': '120' }, json: { ok: false } });
      const checked = await page.evaluate(() => Date.now());
      const value = snapshot(chain, { checked, revision: 'Refreshed' });
      value.freshness = 'PARTIAL';
      value.projectCards[1] = { category: 'UPCOMING', state: 'NO_VERIFIED_SIGNAL', reasonCode: 'PARTIAL_SOURCE_COVERAGE', event: null };
      value.projectCards[2] = { category: 'RISK_ALERT', state: 'SOURCE_UNAVAILABLE', reasonCode: 'SOURCE_COVERAGE_UNAVAILABLE', event: null };
      return route.fulfill({ json: value });
    });
    await page.goto(origin + '/#pulse', { waitUntil: 'domcontentloaded' });
    const grid = page.locator('#pulseProjectGrid');
    await grid.getByRole('heading', { name: 'First Arc ACHIEVED' }).waitFor();
    await page.evaluate(() => window.setVisibilityFixture(true));
    await page.clock.fastForward(7 * MINUTE);
    assert.equal(requests, 1);
    await page.evaluate(() => window.setVisibilityFixture(false));
    await grid.getByRole('heading', { name: 'Sources unavailable' }).nth(2).waitFor();
    assert.equal(requests, 2);
    assert.equal(await grid.getByRole('link').count(), 0);
    assert.deepEqual(await grid.locator('.pulse-card > span > span:last-child').allTextContents(), categories);
    await page.evaluate(() => { window.setVisibilityFixture(true); window.setVisibilityFixture(false); });
    await page.clock.fastForward(MINUTE);
    assert.equal(requests, 2);
    await page.clock.fastForward(MINUTE + 1000);
    await grid.getByRole('heading', { name: 'Refreshed Arc ACHIEVED' }).waitFor();
    assert.equal(requests, 3);
    assert.equal(await grid.getByRole('heading', { name: 'No verified signal' }).count(), 1);
    assert.equal(await grid.getByRole('heading', { name: 'Sources unavailable' }).count(), 1);
    assert.equal(await grid.getByRole('link').count(), 1);
    assert.equal(await page.locator('#pulseTake').textContent(), 'Current Arc weekly take');
    console.log('PASS visibility-aware refresh, expiry, 429 cooldown, recovery, and partial coverage');
  } finally {
    await page.close();
  }
}

async function main() {
  const server = spawn(process.execPath, ['dev.cjs'], { cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: '3187' }, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let browser;
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('Preview exited'); })]);
    browser = await chromium.launch({ headless: true, channel: process.env.PULSE_BROWSER_CHANNEL || undefined });
    for (const width of [1440, 800, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const requested = [];
      await page.clock.setFixedTime(NOW);
      await routePulse(page, (route, chain) => {
        requested.push(chain);
        return route.fulfill({ json: snapshot(chain) });
      });
      await page.goto(origin + '/#pulse', { waitUntil: 'domcontentloaded' });
      for (const chain of ['arc', 'ethereum', 'robinhood']) {
        const tab = page.getByRole('tab', { name: { arc: 'Arc', ethereum: 'Ethereum', robinhood: 'Robinhood Chain' }[chain], exact: true });
        if (chain !== 'arc') await page.keyboard.press('ArrowRight');
        else await tab.focus();
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        const panel = page.locator('#pulse-panel-' + chain);
        await panel.locator('.pulse-card[data-pulse-state="VERIFIED"]').nth(2).waitFor();
        const cards = panel.locator('.pulse-card');
        assert.equal(await cards.count(), 3);
        assert.deepEqual(await cards.locator(':scope > span > span:last-child').allTextContents(), categories);
        assert.equal(new Set(await cards.locator('h4').allTextContents()).size, 3);
        assert.equal(await panel.locator('.pulse-take').count(), 1);
        const take = 'Current ' + chains[chain][1] + ' weekly take';
        await panel.locator('.pulse-take p').filter({ hasText: take }).waitFor();
        const upcoming = cards.nth(1);
        assert.deepEqual(await upcoming.locator('dt').allTextContents(), ['Plan status', 'Announced target', 'Evidence limits']);
        assert.match(await upcoming.locator('dl').textContent(), /Scheduled.*2026-11-20.*scheduled date may change/);
        assert.match(await cards.nth(0).locator('footer').textContent(), /Merged code/);
        assert.match(await cards.nth(2).locator('footer').textContent(), /Official advisory or incident report/);
        assert.match(await cards.nth(2).locator('dl').textContent(), /Publisher statusMonitoringSource referencefixture-advisory/);
        for (const card of await cards.all()) {
          assert.equal(await card.locator('footer time').getAttribute('datetime'), '2026-11-13T07:30:00.000Z');
          const link = card.getByRole('link', { name: /primary source/ });
          assert.equal(await link.getAttribute('target'), '_blank');
          assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
          assert.match(await link.getAttribute('href'), /^https:\/\//);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width < 760) {
          const counter = panel.locator('.pulse-card-counter');
          assert.equal(await counter.innerText(), '1 / 3');
          await panel.getByRole('button', { name: 'Next Pulse research card' }).click();
          await page.waitForFunction(chain => document.querySelector('#pulse-panel-' + chain + ' .pulse-card-counter').textContent === '2 / 3', chain);
          await panel.getByRole('button', { name: 'Previous Pulse research card' }).click();
          await page.waitForFunction(chain => document.querySelector('#pulse-panel-' + chain + ' .pulse-card-counter').textContent === '1 / 3', chain);
          await tab.focus();
        } else {
          const boxes = await cards.evaluateAll(nodes => nodes.map(node => ({ x: node.offsetLeft, y: node.offsetTop })));
          assert.equal(new Set(boxes.map(box => box.y)).size, 1);
          assert.equal(new Set(boxes.map(box => box.x)).size, 3);
        }
      }
      assert.deepEqual(requested, ['arc', 'ethereum', 'robinhood']);
      await page.goto(origin + '/?pulseEdition=3#pulse', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Historical Pulse #003 fixture' }).waitFor();
      await page.goto(origin + '/?pulseChain=ethereum&pulseEdition=3#pulse', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Historical Ethereum card 1' }).waitFor();
      assert.equal(await page.getByRole('tab', { name: 'Ethereum' }).getAttribute('aria-selected'), 'true');
      assert.deepEqual(requested, ['arc', 'ethereum', 'robinhood']);
      await page.close();
      console.log(`PASS ${width}px: three fixed categories per chain, safe sources, keyboard tabs, ARCY Take, no overflow and weekly archives`);
    }

    const page = await browser.newPage();
    await page.clock.setFixedTime(NOW);
    const value = snapshot('arc');
    value.projectCards[0].event.title = '<img src=x onerror="window.injected=1">';
    value.projectCards[1].event.url = 'https://blog.uniswap.org@evil.example/';
    value.projectCards[2].event.url = value.projectCards[0].event.url;
    await routePulse(page, route => route.fulfill({ json: value }));
    await page.goto(origin + '/#pulse', { waitUntil: 'domcontentloaded' });
    const grid = page.locator('#pulseProjectGrid');
    await grid.getByRole('heading', { name: value.projectCards[0].event.title }).waitFor();
    assert.equal(await grid.locator('img[onerror]').count(), 0);
    assert.equal(await grid.getByRole('link').count(), 1);
    assert.equal(await grid.getByRole('heading', { name: 'Sources unavailable' }).count(), 2);
    await page.close();
    await verifyRefresh(browser);
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
