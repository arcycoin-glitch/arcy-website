'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SOURCES, discoverSource, canonicalSourceUrl } = require('../lib/pulse-news-sources');
const { NETWORKS, SLOTS, FRESH_MS, scanNews, newsView, validSnapshot } = require('../lib/pulse-projects');

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 3_600_000;
const checkDate = '2026-11-13T14:00:00Z';
const projectFeed = SOURCES.find(source => source.id === 'ethereum-foundation');
const post = { title: 'Ethereum Mainnet Upgrade Plan', summary: 'The Ethereum Foundation plans to activate the protocol upgrade on November 22, 2026.',
  url: 'https://blog.ethereum.org/en/2026/11/13/mainnet-upgrade-plan', date: checkDate };
const advisory = { state: 'published', withdrawn_at: null, ghsa_id: 'GHSA-abcd-1234-ab12', published_at: checkDate,
  summary: 'Invalid blocks can cause a denial of service vulnerability', description: 'Affected versions allow malicious peers to disrupt the Ethereum client.',
  html_url: 'https://github.com/ethereum/go-ethereum/security/advisories/GHSA-abcd-1234-ab12' };

function rss(items) {
  return `<rss version="2.0"><channel>${items.map(item => `<item><title>${item.title}</title><link>${item.url}</link><pubDate>${item.date}</pubDate><description>${item.summary}</description></item>`).join('')}</channel></rss>`;
}

function gethRelease(version, options = {}) {
  return { tag_name: version, name: version, draft: false, prerelease: false, published_at: checkDate,
    body: 'This stable release adds the new transaction pool validation to the Go Ethereum client.',
    html_url: `https://github.com/ethereum/go-ethereum/releases/tag/${version}`, ...options };
}

function sourceFixture({ articles = [post], advisories = [advisory], releases = [gethRelease('v1.17.12')], overrides = {} } = {}) {
  return async url => {
    const source = SOURCES.find(item => item.url === url);
    if (source?.id in overrides) return overrides[source.id]();
    if (source?.id === 'ethereum-foundation') return new Response(rss(articles));
    if (source?.id === 'geth-releases') return Response.json(releases);
    if (source?.id === 'geth-advisories') return Response.json(advisories);
    return new Response('', { status: 503 });
  };
}

test('new publication, completed release, future plan and official security report fill fixed slots', async () => {
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture() });
  assert.ok(validSnapshot(snapshot));
  const view = newsView(snapshot, 'ethereum', { now: NOW });
  assert.equal(view.freshness, 'PARTIAL');
  assert.equal(view.delivery, 'DURABLE');
  assert.deepEqual(view.projectCards.map(card => card.category), SLOTS);
  assert.ok(view.projectCards.every(card => card.state === 'VERIFIED'));
  const [achieved, upcoming, risk] = view.projectCards.map(card => card.event);
  assert.equal(achieved.evidenceGrade, 'PUBLISHED_RELEASE');
  assert.match(achieved.limitation, /installed/);
  assert.equal(upcoming.targetStatus, 'ANNOUNCED');
  assert.equal(upcoming.targetAt, '2026-11-22');
  assert.equal(risk.evidenceGrade, 'OFFICIAL_ADVISORY');
  assert.equal(risk.incidentStatus, 'PUBLISHED');
  assert.equal(new Set(view.projectCards.map(card => card.event.url)).size, 3);
  const next = await scanNews({ now: NOW + HOUR, fetcher: sourceFixture({ releases: [gethRelease('v1.17.13', {
    published_at: '2026-11-14T12:10:00Z',
  })] }), cooldowns: snapshot.cooldowns });
  assert.match(newsView(next, 'ethereum', { now: NOW + HOUR }).projectCards[0].event.title, /1\.17\.13/);
});

test('undated, expired, future publication, closed target and conflicting completion claims are withheld', async () => {
  const article = (slug, title, summary, date = checkDate) => ({ title, summary, date,
    url: `https://blog.ethereum.org/en/2026/11/13/${slug}` });
  const articles = [
    { ...post, date: '2026-11-15T00:00:00Z' },
    { ...post, date: '' },
    { ...post, date: '2026-10-01T00:00:00Z' },
    article('closed-target', 'Mainnet upgrade scheduling report', 'We plan to activate the protocol upgrade on 2026-11-13.'),
    article('disputed-plan', 'Mainnet upgrade is live', 'We plan to activate the protocol upgrade on 2026-11-18.'),
    article('speculation', 'Is the Ethereum exploit confirmed?', 'The exploit was reportedly found in the Ethereum mainnet contract.'),
    article('role-grant', 'Upgrade admin role granted', 'The owner role was granted. The published notice does not include any exploit or disruption.'),
    article('testnet-upgrade', 'Hoodi testnet is live', 'The client upgrade has launched on the Hoodi testnet.'),
  ];
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture({ articles, advisories: [], releases: [] }) });
  assert.equal(snapshot.events.length, 0);
  assert.ok(newsView(snapshot, 'ethereum', { now: NOW }).projectCards.every(card => card.state === 'NO_VERIFIED_SIGNAL'));
});

test('a reported incident needs structured production-chain evidence and stable provenance', async () => {
  const fixture = structuredClone(advisory);
  const reports = [fixture, { ...fixture, state: 'withdrawn', withdrawn_at: checkDate }, { ...fixture, summary: 'Unconfirmed exploit rumor' }];
  const newsroom = rss([{ ...post, title: 'Reports of Ethereum exploitation', summary: 'The project reports a vulnerability in the Ethereum mainnet contract.' }]);
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture({ advisories: reports, releases: [], overrides: {
    'ethereum-foundation': () => new Response(newsroom),
    'arc-incidents': () => Response.json({ page: { id: 'p89dljhsd44w', url: 'https://status.arc.io' }, incidents: [
      { id: 'incident1234', page_id: 'p89dljhsd44w', impact: 'major', status: 'monitoring', created_at: checkDate,
        name: 'Arc RPC service disruption', components: [{ name: 'Arc public testnet', group_id: 'testnet-id' }],
        incident_updates: [{ status: 'monitoring', body: 'The outage interrupted requests.' }] },
      { id: 'incident5678', page_id: 'p89dljhsd44w', impact: 'major', status: 'monitoring', created_at: checkDate,
        name: 'Arc mainnet RPC service disruption', components: [{ name: 'Arc Mainnet RPC', group_id: '32lclmtz775v' }],
        incident_updates: [{ status: 'monitoring', body: 'The outage interrupted RPC requests for some callers.' }] },
    ] }),
  } }) });
  const keys = snapshot.events.filter(event => event.category === 'RISK_ALERT').map(event => event.eventRef);
  assert.deepEqual(keys, ['arc:incident5678', 'ghsa-abcd-1234-ab12']);
  assert.equal(newsView(snapshot, 'robinhood', { now: NOW }).projectCards[2].state, 'SOURCE_UNAVAILABLE');
});

test('deduplicates cross-posts per network and preserves distinct chain claims', async () => {
  const headline = 'Uniswap Activated the New Routing Protocol';
  const summary = "They're live on Ethereum mainnet and Robinhood Chain with the new routing protocol.";
  const fetcher = async url => {
    if (url === 'https://blog.uniswap.org/') return new Response('<a href="/routing-protocol">Read</a>');
    if (url === 'https://blog.uniswap.org/routing-protocol') return new Response(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'Article', datePublished: checkDate, headline,
    })}</script><article><p>${summary}</p></article>`);
    return sourceFixture({ articles: [{ ...post, title: headline, summary }], advisories: [], releases: [] })(url);
  };
  const snapshot = await scanNews({ now: NOW, fetcher });
  assert.equal(snapshot.events.filter(item => item.chains.includes('ethereum')).length, 1);
  assert.equal(snapshot.events.filter(item => item.chains.includes('robinhood')).length, 1);
  assert.equal(snapshot.events.filter(item => item.chains.includes('arc')).length, 0);
  assert.equal(newsView(snapshot, 'robinhood', { now: NOW }).projectCards[0].event.project, 'Uniswap');
});

test('429 suppresses the shared host and honors persisted Retry-After while outages never replace slots', async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes('api.github.com')) return new Response('', { status: 429, headers: { 'retry-after': '7200' } });
    return new Response('', { status: 503 });
  };
  const snapshot = await scanNews({ now: NOW, fetcher });
  assert.ok(validSnapshot(snapshot));
  assert.equal(calls.filter(url => url.includes('api.github.com')).length, 1);
  assert.equal(snapshot.cooldowns['geth-releases'], NOW + 2 * HOUR);
  for (const chain of Object.keys(NETWORKS)) {
    const view = newsView(snapshot, chain, { now: NOW });
    assert.deepEqual(view.projectCards.map(card => card.category), SLOTS);
    assert.ok(view.projectCards.every(card => card.state === 'SOURCE_UNAVAILABLE' && card.event === null));
  }
  calls.length = 0;
  await scanNews({ now: NOW + HOUR, fetcher, cooldowns: snapshot.cooldowns });
  assert.ok(calls.every(url => !url.includes('api.github.com')));
});

test('closed snapshot and event expiration clear cards without recycling prior research', async () => {
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture({ releases: [gethRelease('v1.17.12', {
    published_at: new Date(NOW - 28 * 86400000 + 1000).toISOString(),
  })] }) });
  const first = newsView(snapshot, 'ethereum', { now: NOW });
  assert.equal(first.expiresAt, new Date(NOW + 1000).toISOString());
  assert.equal(newsView(snapshot, 'ethereum', { now: NOW + 1000 }).projectCards[0].event, null);
  const expired = newsView(snapshot, 'ethereum', { now: NOW + FRESH_MS, lastSuccessfulAt: snapshot.checkedAt });
  assert.equal(expired.freshness, 'STALE');
  assert.equal(expired.lastSuccessfulAt, snapshot.checkedAt);
  assert.ok(expired.projectCards.every(card => card.state === 'STALE' && card.event === null));
});

test('source URL injection and signed-snapshot shape errors fail closed before projection', async () => {
  for (const url of ['javascript:alert(1)', 'https://blog.ethereum.org@evil.example/en/2026/11/13/unsafe',
    'https://blog.ethereum.org:444/en/2026/11/13/unsafe', 'https://blog.ethereum.org/en/2026/11/13/fake%2fpage']) {
    assert.equal(canonicalSourceUrl(url, projectFeed), null);
  }
  const items = await discoverSource(projectFeed, async () => new Response(rss([{ ...post, url: 'https://evil.example' }])));
  assert.deepEqual(items, []);
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture() });
  snapshot.events[0].url = 'https://evil.example';
  assert.equal(validSnapshot(snapshot), false);
  assert.ok(newsView(snapshot, 'ethereum', { now: NOW }).projectCards.every(card => card.event === null));
});

test('Arc uses the original visible date and excludes unrelated article teasers', async () => {
  const arcSource = SOURCES.find(source => source.id === 'arc-blog');
  const storyUrl = 'https://www.arc.io/blog/arc-feature';
  const html = (date, body) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Article',
    headline: 'Arc Router Update', datePublished: checkDate })}</script><div class="blog_date-time">${date}</div><main>${body}</main>`;
  const run = async page => scanNews({ now: NOW, fetcher: async url => {
    if (url === arcSource.url) return new Response(`<a href="${storyUrl}">Article</a>`);
    if (url === storyUrl) return new Response(page);
    return new Response('', { status: 503 });
  } });
  const completion = '<p>We launched a new transaction router for the Arc mainnet.</p>';
  const historical = await run(html('September 16, 2026', completion));
  assert.ok(newsView(historical, 'arc', { now: NOW }).projectCards.every(card => card.event === null),
    'a partial scan cannot promote old news to a historical card');
  const recent = await run(html('November 10, 2026', completion));
  assert.equal(recent.events[0].publishedAt, '2026-11-10T00:00:00.000Z');
  const unrelated = await run(html('November 10, 2026', '<p>Neutral discussion.</p><h2>Related Posts</h2>' + completion));
  assert.equal(unrelated.events.length, 0);
});

test('scheduled Arc mainnet maintenance uses the official target timestamp', async () => {
  const snapshot = await scanNews({ now: NOW, fetcher: sourceFixture({ overrides: {
    'arc-incidents': () => Response.json({ page: { id: 'p89dljhsd44w', url: 'https://status.arc.io' }, incidents: [] }),
    'arc-maintenance': () => Response.json({ page: { id: 'p89dljhsd44w', url: 'https://status.arc.io' }, scheduled_maintenances: [
      { id: 'scheduled123', page_id: 'p89dljhsd44w', status: 'scheduled', created_at: checkDate,
        name: 'Arc mainnet maintenance notice', components: [{ name: 'Arc Mainnet RPC', group_id: '32lclmtz775v' }],
        scheduled_for: '2026-11-16T03:00:00Z', incident_updates: [{ status: 'scheduled', body: 'Arc plans to upgrade the mainnet RPC service.' }] },
    ] }),
  } }) });
  const upcoming = newsView(snapshot, 'arc', { now: NOW }).projectCards[1];
  assert.equal(upcoming.state, 'VERIFIED');
  assert.equal(upcoming.event.targetStatus, 'SCHEDULED');
  assert.equal(upcoming.event.targetAt, '2026-11-16T03:00:00.000Z');
});

test('official roadmap uses the mainnet quarter, preserves an unconfirmed date, and expires the closed quarter', async () => {
  const primary = 'https://ethereum.org/roadmap/';
  const fetcher = async url => {
    if (url === primary) return new Response('<h1>Ethereum roadmap</h1><section id="releases"><a href="/roadmap/old-fork/">Learn more</a><a href="/roadmap/future-fork/">Learn more</a><a href="https://forkcast.org/upgrade/future-fork">Progress</a></section>');
    if (url === primary + 'future-fork/') return new Response('<h1>Future Fork</h1><dl><dt>Expected on mainnet</dt><dd>Q4 2026 <span>· Date not yet confirmed</span></dd><dt>Next milestone</dt><dd>Hoodi fork, October 27, 2026</dd></dl><p>Page last update:<!-- --> October 16, 2026</p>');
    return sourceFixture({ articles: [], advisories: [], releases: [] })(url);
  };
  const snapshot = await scanNews({ now: NOW, fetcher });
  const view = newsView(snapshot, 'ethereum', { now: NOW });
  assert.equal(view.projectCards[1].event.targetWindow, 'Q4 2026');
  assert.equal(view.projectCards[1].event.targetStatus, 'TENTATIVE');
  assert.equal(view.projectCards[1].event.targetAt, null);
  assert.equal(view.projectCards[1].event.dateBasis, 'SOURCE_UPDATED');
  assert.match(view.projectCards[1].event.implication, /compatibility/);
  assert.equal(view.sources.find(row => row.id === 'ethereum-roadmap').diagnostics.accepted, 1);
  const closed = Date.parse('2027-01-01T00:00:00Z');
  const next = await scanNews({ now: closed, fetcher });
  assert.equal(newsView(next, 'ethereum', { now: closed }).projectCards[1].event, null);
});

test('official terminal records retire a replayed maintenance plan without promoting it to completed news', async () => {
  const { combineHistory, validHistory } = require('../lib/pulse-projects');
  const maintenance = { id: 'scheduled123', page_id: 'p89dljhsd44w', status: 'scheduled', created_at: checkDate,
    name: 'Arc mainnet maintenance notice', components: [{ name: 'Arc Mainnet RPC', group_id: '32lclmtz775v' }],
    scheduled_for: '2026-11-16T03:00:00Z', incident_updates: [{ status: 'scheduled', body: 'Arc plans to upgrade the mainnet RPC service.' }] };
  const page = { id: 'p89dljhsd44w', url: 'https://status.arc.io' };
  const at = Date.parse('2026-11-14T13:00:00Z');
  const run = (items, now) => scanNews({ now, fetcher: sourceFixture({ overrides: {
    'arc-incidents': () => Response.json({ page, incidents: [] }),
    'arc-maintenance': () => Response.json({ page, scheduled_maintenances: items }),
  } }) });
  const scheduled = await run([maintenance], NOW);
  assert.equal(newsView(scheduled, 'arc', { now: NOW }).projectCards[1].state, 'VERIFIED');
  let history = combineHistory(null, scheduled);
  const cancelled = await run([{ ...maintenance, status: 'cancelled', updated_at: new Date(at).toISOString() }], at);
  history = combineHistory(history, cancelled);
  assert.ok(validHistory(history, cancelled.checkedAt));
  assert.equal(history.lifecycles[0].status, 'CANCELLED');
  const oldFeed = await run([maintenance], at + HOUR);
  assert.equal(newsView(oldFeed, 'arc', { now: at + HOUR, history }).projectCards[1].event, null);
  assert.equal(newsView(cancelled, 'arc', { now: at, history }).projectCards[0].event, null);
});
