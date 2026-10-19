const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGMUrLjPAANMDEgANwcARoYBcHIb//MAAAAASUVORK5CYII=', 'base64');
const fixtureArt = 'https://cdn.dexscreener.com/cms/images/y7ril8c3Y0da5KIP?width=64&height=64&quality=85&format=auto';

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
    browser = await chromium.launch({ headless: true,channel:'msedge' });
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
        const q = url.searchParams.get('q')?.toLowerCase();
        if (q === 'floki' && network === 'ethereum') {
          return route.fulfill({ json: { ok: true, chainId: 1, network, matches: [{
            network, chainId: 1, address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e',
            name: 'Floki', symbol: 'FLOKI', logoUrl: fixtureArt,
            identity: { status: 'OFFICIAL_CONTRACT_MATCHED' }
          }] } });
        }
        if (q === 'pons' && network === 'robinhood') {
          return route.fulfill({ json: { ok: true, chainId: 4663, network, matches: [{
            network, chainId: 4663, address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
            name: 'Pons', symbol: 'PONS', logoUrl: fixtureArt,
            identity: { status: 'NOT_VERIFIED' }
          }] } });
        }
        return route.fulfill({ json: { ok: true, chainId: chains[network], network, matches: [candidate(network)] } });
      }
      if ((action === 'report' || action === 'progress')) {
        return route.fulfill({ json: report(network, url.searchParams.get('address')) });
      }
      return route.fulfill({ status: 400, json: { ok: false } });
    });
    await page.route('https://cdn.dexscreener.com/**', route => route.fulfill({
      status: 200, contentType: 'image/png', body: FIXTURE_PNG,
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
          // Search thumbnails are loading=lazy; force the image into view before decoding.
          await remote.scrollIntoViewIfNeeded();
          await page.waitForFunction(() => {
            const img=document.querySelector('.home-token-placeholder img');
            return Boolean(img && img.complete && img.naturalWidth>0);
          },null,{timeout:10000});
          assert.ok(await remote.evaluate(img => img.complete && img.naturalWidth > 0), 'provider artwork rendered correctly');
        }
        await page.locator('.home-search-result').click();
        await page.waitForURL(`**/search/token/${network}/${addresses[network]}`);
        await page.waitForFunction(() => document.querySelector('#detailState')?.textContent.includes('Snapshot complete'));
        assert.equal(await page.locator('#cards > .card').count(), 5);
        assert.equal(await page.locator('#deepResearch').getAttribute('open'),'');
        assert.equal(await page.locator('#cards > .card > .metric').count(), 19, 'only source-backed rows remain directly visible');
        assert.equal(await page.locator('#cards > .card .missingGroup').count(), 1);
        for(const row of await page.locator('#cards > .card > .metric').all())assert.ok(await row.isVisible());
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
        // Regression: images in the detail-page secondary search must overlay
        // initial-letter fallbacks, never become a second clipped grid row.
        if (network === 'arc') {
          const avatar = page.locator('#detailMatches .detail-match-avatar').first();
          const image = avatar.locator('img');
          await avatar.scrollIntoViewIfNeeded();
          await page.waitForFunction(() => {
            const img=document.querySelector('#detailMatches .detail-match-avatar img');
            return Boolean(img && img.complete && img.naturalWidth>0);
          },null,{timeout:10000});
          const layout=await avatar.evaluate(el=>{
            const img=el.querySelector('img'),a=el.getBoundingClientRect(),b=img.getBoundingClientRect();
            return {avatarWidth:a.width,avatarHeight:a.height,imageWidth:b.width,
              imageHeight:b.height,imageTop:b.top-a.top,position:getComputedStyle(img).position,
              initialsHidden:el.classList.contains('has-logo')};
          });
          assert.equal(layout.position,'absolute','detail image must cover initials without consuming a grid row');
          assert.equal(layout.initialsHidden,true,'loaded detail image hides initial letters');
          assert.ok(layout.imageWidth>20&&layout.imageHeight>20&&layout.imageTop>=0&&layout.imageTop<3,
            'detail-page token artwork is fitted inside avatar');
        }
        await page.goto(origin + '/#search');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `return to Search overflow at ${viewport}px`);
      }
    }
    assert.deepEqual(pageErrors, []);
    assert.equal(seen.filter(x => x.action === 'discover').length, 24, 'homepage and detail-page discovery each run once per chain/viewport');
    assert.equal(seen.filter(x => ['report','progress'].includes(x.action)).length, 12);
    // Two real-world failure modes: an issuer-known static FLOKI suggestion
    // receives art asynchronously; a Robinhood non-stock PONS gets DEX art.
    await page.goto(origin + '/#search');
    await page.locator('.home-network-option[data-network="ethereum"]').click();
    await page.locator('#homeSearchQuery').fill('Floki');
    await page.waitForFunction(() => {
      const result=[...document.querySelectorAll('#homeSearchSuggestions .home-search-result')]
        .find(x=>x.textContent.includes('Floki')&&x.textContent.includes('OFFICIAL CONTRACT'));
      return Boolean(result?.querySelector('img'));
    },null,{timeout:12000});
    assert.match(await page.locator('#homeSearchSuggestions').innerText(),/OFFICIAL CONTRACT/);
    await page.locator('.home-network-option[data-network="robinhood"]').click();
    await page.locator('#homeSearchQuery').fill('Pons');
    await page.waitForFunction(() => {
      const result=[...document.querySelectorAll('#homeSearchSuggestions .home-search-result')]
        .find(x=>x.textContent.includes('Pons'));
      return Boolean(result?.querySelector('img'));
    },null,{timeout:12000});
    assert.match(await page.locator('#homeSearchSuggestions').innerText(),/NOT VERIFIED/);
    assert.deepEqual(pageErrors, []);
    console.log('PASS: mocked browser E2E at 320/390/768/1440px; home discovery on all chains; official labels remain unverified; remote Ethereum logo + initials fallback; 5 cards/20 checks; all four GeckoTerminal presets stay on the selected chain; detail-page re-search. All API data in this test is mocked, not real provider evidence.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
