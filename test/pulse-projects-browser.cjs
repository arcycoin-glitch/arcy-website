'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createProjectCollector } = require('../lib/pulse-projects');
const { now, publication } = require('./helpers/pulse-project-fixtures.cjs');

const origin = 'http://127.0.0.1:3187';
const legacy = { ok: true, number: 3, take: 'Archived research fixture', cards: [
  { kind: 'week', title: 'Historical Pulse #003 fixture', summary: 'This is an archived article.', url: 'https://www.circle.com/' },
] };

async function main() {
  const collect = createProjectCollector({ fetcher: publication, now: () => now });
  const server = spawn(process.execPath, ['dev.cjs'], { cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: '3187' }, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let browser;
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw Error('Preview exited'); })]);
    browser = await chromium.launch({ headless: true, channel: process.env.PULSE_BROWSER_CHANNEL || undefined });
    for (const width of [1440, 800, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const requested = [];
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname !== '/api/pulse') return route.fulfill({ status: 503, json: { ok: false } });
        if (url.searchParams.get('view') !== 'projects') {
          const chain = url.searchParams.get('networkArchive');
          return route.fulfill({ json: chain === 'ethereum' ? { ...legacy, chains: { ethereum: {
            chain, chainId: 1, number: 3, contentNotice: 'Archived Ethereum fixture', take: 'Archived Ethereum take',
            cards: Array.from({ length: 3 }, (_, index) => ({ ...legacy.cards[0], title: 'Historical Ethereum card ' + (index + 1) })),
          } } } : legacy });
        }
        const chain = url.searchParams.get('chain');
        requested.push(chain);
        return route.fulfill({ json: await collect(chain) });
      });
      await page.goto(origin + '/#pulse', { waitUntil: 'domcontentloaded' });
      for (const chain of ['arc', 'ethereum', 'robinhood']) {
        const tab = page.getByRole('tab', { name: { arc: 'Arc', ethereum: 'Ethereum', robinhood: 'Robinhood Chain' }[chain], exact: true });
        if (chain !== 'arc') await page.keyboard.press('ArrowRight');
        else await tab.focus();
        assert.equal(await tab.getAttribute('aria-selected'), 'true');
        const panel = page.locator('#pulse-panel-' + chain);
        await panel.locator('[data-project-id]').nth(2).waitFor();
        const cards = panel.locator('.pulse-card');
        assert.equal(await cards.count(), 3);
        assert.equal(new Set(await cards.locator('h4').allTextContents()).size, 3);
        assert.equal(await panel.locator('.pulse-take').count(), 1);
        for (const card of await cards.all()) {
          assert.deepEqual(await card.locator('dt').allTextContents(), ['What changed', 'Why it matters', 'Risk / not proven']);
          assert.match(await card.locator('time').getAttribute('datetime'), /^2026-\d\d-\d\d$/);
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
      console.log(`PASS ${width}px: three project cards per chain, safe sources, keyboard tabs, no overflow and legacy archive`);
    }

    const page = await browser.newPage();
    const value = await collect('arc');
    value.projectCards[0].name = '<img src=x onerror="window.injected=1">';
    value.projectCards[1].source.url = 'https://blog.uniswap.org@evil.example/';
    value.projectCards[2] = { ...value.projectCards[0] };
    await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('view=projects') ? value : legacy }));
    await page.goto(origin + '/#pulse', { waitUntil: 'domcontentloaded' });
    await page.locator('#pulseProjectGrid [data-project-id]').waitFor();
    assert.equal(await page.locator('#pulseProjectGrid img[onerror]').count(), 0);
    assert.equal(await page.locator('#pulseProjectGrid [data-project-id] h4').textContent(), value.projectCards[0].name);
    assert.equal(await page.locator('#pulseProjectGrid a').count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'Project coverage unavailable' }).count(), 2);
    await page.close();
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
