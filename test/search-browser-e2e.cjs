const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fixtureArt = 'https://cdn.dexscreener.com/cms/images/arcy-search-browser-fixture.webp';

const root = path.join(__dirname, '..');
const origin = 'http://127.0.0.1:3111';
const addresses = {
  arc: '0x73e5f588d27d6b5ec89c89c82692d1e7fecbd38b',
  ethereum: '0x1111111111111111111111111111111111111111',
  robinhood: '0x2222222222222222222222222222222222222222',
};
const chains = { arc: 5042, ethereum: 1, robinhood: 4663 };
const tokens = {
  arc: ['ARCY Token', 'ARCY'],
  ethereum: ['Wrapped Ether', 'WETH'],
  robinhood: ['Tesla Token', 'TSLA'],
};
const fieldKeys = {
  supply: ['totalSupply', 'circulatingSupply', 'burnAddressBalance', 'burnAddressPct'],
  holders: ['holderCount', 'largestWalletPct', 'top10Pct', 'top20Pct'],
  liquidity: ['liquidityUsd', 'volume24h', 'dexPairCount', 'lpStatus'],
  activity: ['priceUsd', 'valuation', 'change24h', 'volume24h'],
  mechanics: ['tradingTaxes', 'mintCapability', 'ownerAdmin', 'contractArchitecture'],
};

function report(network, address) {
  const [name, symbol] = tokens[network];
  const cards = {};
  for (const [card, keys] of Object.entries(fieldKeys)) {
    cards[card] = { description: 'Browser fixture; not real market evidence.', fields: {} };
    for (const key of keys) {
      const missing = key === 'valuation';
      cards[card].fields[key] = {
        value: missing ? null : key === 'lpStatus' ? 'NOT VERIFIED' : key === 'tradingTaxes' ? 'NOT VERIFIED' : 1,
        dataState: missing ? 'NOT_VERIFIED' : 'DATA_FOUND',
        status: missing ? 'NOT_VERIFIED' : 'BROWSER_FIXTURE',
        kind: key === 'valuation' ? 'FDV' : undefined,
        reason: missing ? 'Fixture leaves valuation unknown.' : undefined,
        source: 'Browser-only fixture', evidence: [],
      };
    }
  }
  return {
    ok: true, chainId: chains[network], network, address, cardCount: 5, cards,
    token: { name, symbol, logoUrl: network === 'ethereum' ? fixtureArt : null },
    tokenIdentity: { status: 'NOT_VERIFIED' },
    block: '0x10', scannedAt: '2026-10-13T00:00:00.000Z',
  };
}

function candidate(network) {
  const [name, symbol] = tokens[network];
  return {
    name, symbol, network, chainId: chains[network], address: addresses[network],
    source: 'Browser fixture', logoUrl: network === 'ethereum' ? fixtureArt : null,
    identity: { status: 'NOT_VERIFIED' },
  };
}

(async () => {
  const server = spawn(process.execPath, ['dev.cjs'], {
    cwd: root, env: { ...process.env, PORT: '3111' },
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
    const seen = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/api/search?**', async route => {
      const url = new URL(route.request().url());
      const network = url.searchParams.get('chain');
      const action = url.searchParams.get('action');
      seen.push({ network, action, query: url.searchParams.get('q') });
      if (action === 'discover') {
        return route.fulfill({ json: { ok: true, chainId: chains[network], network, matches: [candidate(network)] } });
      }
      if (action === 'report') {
        return route.fulfill({ json: report(network, url.searchParams.get('address')) });
      }
      return route.fulfill({ status: 400, json: { ok: false } });
    });
    await page.route('https://cdn.dexscreener.com/**', route => route.fulfill({
      status: 200, contentType: 'image/webp',
      body: fs.readFileSync(path.join(root, 'search/assets/arcy-owl-reference.webp')),
    }));
    await page.route('https://www.geckoterminal.com/**', route => route.fulfill({
      status: 200, contentType: 'text/html', body: '<title>GeckoTerminal controlled iframe fixture</title>',
    }));

    for (const viewport of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(origin + '/#search');
      assert.equal(await page.locator('.home-search').count(), 1, 'homepage search card appears');
      assert.equal(await page.locator('.home-search-owl').count(), 1, 'homepage shows a single Search owl');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `homepage horizontal overflow at ${viewport}px`);

      for (const network of ['arc', 'ethereum', 'robinhood']) {
        if (network !== 'arc') {
          await page.locator(`.home-network-option[data-network="${network}"]`).click();
        }
        const [name, symbol] = tokens[network];
        const query = network === 'arc' ? name : symbol;
        await page.locator('#homeSearchQuery').fill(query);
        await page.locator('.home-search-form').evaluate(form => form.requestSubmit());
        await page.locator('.home-search-result').waitFor({ state: 'visible' });
        assert.match(await page.locator('.home-search-result').innerText(), new RegExp(name));
        assert.match(await page.locator('.home-search-result .home-result-status').innerText(), /NOT VERIFIED/);
        assert.equal(await page.locator('.home-token-placeholder').count(), 1, 'all logos retain a fallback avatar');
        if (network === 'ethereum') {
          const remote = page.locator('.home-token-placeholder img');
          assert.equal(await remote.count(), 1, 'Ethereum token loads provider art from an exact-contract result');
          await remote.evaluate(img => img.decode());
          assert.ok(await remote.evaluate(img => img.naturalWidth > 0), 'provider artwork rendered correctly');
        }
        await page.locator('.home-search-result').click();
        await page.waitForURL(`**/search/token/${network}/${addresses[network]}`);
        await page.waitForFunction(() => document.querySelector('#detailState')?.textContent.includes('Snapshot complete'));
        assert.equal(await page.locator('#cards > .card').count(), 5);
        await page.locator('#deepResearch').evaluate(node => { node.open = true; });
        assert.equal(await page.locator('#cards > .card > .metric').count(), 19, '19 sourced rows render; valuation remains withheld in the missing group');
        assert.equal(await page.locator('#cards > .card .missingGroup').count(), 1);
        assert.match(await page.locator('#evidenceCount').innerText(), /20 checks/);
        const detailLogo = page.locator('#tokenDetail img.token-title-logo');
        assert.equal(await detailLogo.count(), network === 'robinhood' ? 0 : 1, 'site-owned and permitted provider artwork appear on detail while missing stock art stays absent');
        if (network !== 'robinhood') {
          await detailLogo.evaluate(img => img.decode());
          assert.ok(await detailLogo.evaluate(img => img.complete && img.naturalWidth > 0), 'exact-contract token art loads');
        }
        const expected = { '4H': '15m', '1D': '1h', '1W': '4h', '30D': '1d' };
        for (const [range, resolution] of Object.entries(expected)) {
          await page.locator(`#chartRanges [data-range="${range}"]`).click();
          const frame = page.locator('#officialChartFallback iframe');
          await frame.waitFor({ state: 'attached' });
          const source = new URL(await frame.getAttribute('src'));
          assert.equal(source.searchParams.get('resolution'), resolution);
          assert.match(source.pathname, new RegExp(`/${network === 'robinhood' ? 'robinhood' : network === 'ethereum' ? 'eth' : 'arc'}/tokens/`), 'chart embed stays on the selected chain');
        }
        await page.locator('#detailSearchChain').selectOption(network === 'arc' ? 'ethereum' : 'arc');
        await page.locator('#detailSearchQuery').fill('USDC');
        await page.locator('#detailSearchForm').evaluate(form => form.requestSubmit());
        await page.locator('#detailMatches .detail-match').waitFor({ state: 'visible' });
        assert.match(await page.locator('#detailSearchStatus').innerText(), /candidate/);
        await page.goto(origin + '/#search');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `return to Search overflow at ${viewport}px`);
      }
    }
    assert.deepEqual(pageErrors, []);
    assert.equal(seen.filter(x => x.action === 'discover').length, 24, 'homepage and detail-page discovery each run once per chain/viewport');
    assert.equal(seen.filter(x => x.action === 'report').length, 12);
    console.log('PASS: mocked browser E2E at 320/390/768/1440px; home discovery on all chains; official labels remain unverified; remote Ethereum logo + initials fallback; 5 cards/20 checks; all four GeckoTerminal presets stay on the selected chain; detail-page re-search. All API data in this test is mocked, not real provider evidence.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
