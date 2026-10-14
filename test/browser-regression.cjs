const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const origin = 'http://127.0.0.1:3110';
const addresses = {
  arc: '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',
  ethereum: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  robinhood: '0x322f0929c4625ed5bad873c95208d54e1c003b2d',
};
const chains = { arc: 5042, ethereum: 1, robinhood: 4663 };
const tokens = {
  arc: ['ARCY', 'ARCY'],
  ethereum: ['USD Coin', 'USDC'],
  robinhood: ['Tesla Token', 'TSLA'],
};
const fields = {
  supply: ['totalSupply', 'circulatingSupply', 'burnAddressBalance', 'burnAddressPct'],
  holders: ['holderCount', 'largestWalletPct', 'top10Pct', 'top20Pct'],
  liquidity: ['liquidityUsd', 'volume24h', 'dexPairCount', 'lpStatus'],
  activity: ['priceUsd', 'valuation', 'change24h', 'volume24h'],
  mechanics: ['tradingTaxes', 'mintCapability', 'ownerAdmin', 'contractArchitecture'],
};
const missing = new Set(['circulatingSupply', 'top20Pct', 'lpStatus', 'valuation', 'mintCapability']);

function report(network, address) {
  const [name, symbol] = tokens[network];
  const cards = {};
  for (const [card, keys] of Object.entries(fields)) {
    cards[card] = { description: 'Browser regression fixture; not live provider evidence.', fields: {} };
    for (const key of keys) {
      const unavailable = missing.has(key);
      cards[card].fields[key] = {
        value: unavailable ? null : key === 'tradingTaxes' ? 'NOT VERIFIED' : 1,
        dataState: unavailable ? 'NOT_VERIFIED' : 'DATA_FOUND',
        status: unavailable ? 'NOT_VERIFIED' : 'BROWSER_FIXTURE',
        reason: unavailable ? 'Regression fixture has no source evidence for this field.' : undefined,
        source: unavailable ? undefined : 'Browser-only fixture', evidence: [],
      };
    }
  }
  return {
    ok: true, chainId: chains[network], network, address,
    cardCount: 5, cards, token: { name, symbol },
    tokenIdentity: { status: 'NOT_VERIFIED' }, block: '0x10',
    scannedAt: '2026-10-13T00:00:00.000Z',
  };
}

function candidate(network) {
  const [name, symbol] = tokens[network];
  return { name, symbol, network, chainId: chains[network], address: addresses[network],
    source: 'Browser fixture', logoUrl: null, identity: { status: 'NOT_VERIFIED' } };
}

(async () => {
  const server = spawn(process.execPath, ['dev.cjs'], {
    cwd: root, env: { ...process.env, PORT: '3110' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Local preview startup timeout')), 10000);
      server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      server.once('error', reject);
    });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    const requests = [];
    let discoveryStatus = 200;
    let reportStatus = 200;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/search') requests.push(new URL(request.url()));
    });
    await page.route('**/api/search?**', async route => {
      const url = new URL(route.request().url());
      const network = url.searchParams.get('chain');
      const action = url.searchParams.get('action');
      if (!Object.hasOwn(chains, network)) return route.fulfill({ status: 400, json: { ok: false } });
      if (action === 'discover') {
        if (discoveryStatus !== 200) return route.fulfill({ status: discoveryStatus, json: { ok: false, reason: 'RATE_LIMITED' } });
        return route.fulfill({ json: { ok: true, chainId: chains[network], network, matches: [candidate(network)] } });
      }
      if (action === 'report') {
        if (reportStatus !== 200) return route.fulfill({ status: reportStatus, json: { ok: false, reason: 'REPORT_UNAVAILABLE' } });
        return route.fulfill({ json: report(network, url.searchParams.get('address')) });
      }
      if (action === 'chart') return route.fulfill({ status: 503, json: { ok: false, reason: 'CHART_SOURCE_UNAVAILABLE' } });
      return route.fulfill({ status: 400, json: { ok: false } });
    });
    await page.route('https://www.geckoterminal.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<title>Controlled chart iframe fixture</title>',
    }));

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + '/#search');
      assert.equal(await page.locator('.home-search').count(), 1, 'current homepage Search module appears');
      assert.equal(await page.locator('.home-search-owl').count(), 1, 'Search module keeps one owl');
      assert.equal(await page.locator('#contract').isVisible(), false, 'legacy contract input remains hidden after Search upgrade');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `home overflow at ${width}px`);

      await page.locator('#homeSearchQuery').fill('x');
      await page.locator('.home-search-form').evaluate(form => form.requestSubmit());
      assert.match(await page.locator('#homeSearchState').innerText(), /at least 2 characters/);

      for (const network of ['arc', 'ethereum', 'robinhood']) {
        if (network !== 'arc') await page.locator(`.home-network-option[data-network="${network}"]`).click();
        discoveryStatus = 429;
        await page.locator('#homeSearchQuery').fill(tokens[network][1]);
        await page.locator('.home-search-form').evaluate(form => form.requestSubmit());
        await page.waitForFunction(() => document.querySelector('#homeSearchState')?.textContent.includes('Search unavailable'));
        discoveryStatus = 200;
        await page.locator('.home-search-form').evaluate(form => form.requestSubmit());
        const result = page.locator('.home-search-results .home-search-result');
        await result.waitFor({ state: 'visible' });
        assert.match(await result.innerText(), new RegExp(tokens[network][0]));
        assert.match(await result.locator('.home-result-status').innerText(), /NOT VERIFIED/);
        assert.equal(await result.locator('.home-token-placeholder').count(), 1, 'no-logo result has a visible fallback avatar');
        await result.click();
        await page.waitForURL(`**/search/token/${network}/${addresses[network]}`);
        await page.waitForFunction(() => document.querySelector('#detailState')?.textContent.includes('Snapshot complete'));
        await page.locator('#deepResearch').evaluate(node => { node.open = true; });
        assert.equal(await page.locator('#cards > .card').count(), 5);
        assert.equal(await page.locator('#cards .metric').count(), 20, 'all twenty schema fields render');
        assert.equal(await page.locator('#cards .metric b.no').count(), 5, 'unsupported fixture fields remain visibly unverified');
        assert.match(await page.locator('#evidenceCount').innerText(), /20 checks/);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `detail overflow at ${width}px`);
        assert.equal(await page.locator('.token-title-logo').count(), network === 'arc' ? 1 : 0,
          'only the site-owned ARCY artwork is shown without an issuer artwork match');
        await page.goto(origin + '/#search');
      }

      reportStatus = 503;
      await page.locator('#homeSearchQuery').fill(addresses.arc);
      await page.locator('.home-search-form').evaluate(form => form.requestSubmit());
      await page.waitForFunction(() => document.querySelector('#detailState')?.textContent.includes('Scan unavailable'));
      assert.equal(await page.locator('#cards > .card').count(), 5, 'failed report preserves the five-card shell');
      assert.deepEqual(await page.locator('#cards .metric b').allTextContents(), Array(20).fill('—'),
        'failed report clears prior token metrics instead of displaying stale values');
      reportStatus = 200;
      await page.goto(origin + '/#search');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `home return overflow at ${width}px`);
    }

    assert.deepEqual(pageErrors, []);
    assert.equal(requests.filter(url => url.searchParams.get('action') === 'discover').length, 18);
    assert.equal(requests.filter(url => url.searchParams.get('action') === 'report').length, 12);
    assert.ok(requests.some(url => url.searchParams.get('chain') === 'arc'));
    assert.ok(requests.some(url => url.searchParams.get('chain') === 'ethereum'));
    assert.ok(requests.some(url => url.searchParams.get('chain') === 'robinhood'));
    console.log('PASS: current homepage Search -> exact-chain candidate -> separate detail flow; 429 and report failures; five cards/twenty fields; 320/390/1440px layout; all API responses are mocked fixtures, not live provider evidence.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
