'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const view = require('../unlock-view'), { measure, probe } = require('../scripts/probe-unlock-coverage.cjs');
const event = (overrides = {}) => ({ name: 'Celestia', symbol: 'TIA', date: '2026-11-01', amount: '100K TIA', value: '$40K', percent: '0.02%', allocation: 'Ecosystem', verification: 'source-published', sourceUrl: 'https://api.coinbell.in/token-unlocks?sort=soonest&window=30', ...overrides });
const feed = (rows = []) => ({ ok: true, live: true, updatedAt: '2026-11-01T18:00:00Z', windows: { today: rows, next7: [], days8to30: [] } });

test('calendar coverage counts token entries separately from dates and allocation events', () => {
  const first = event(), next = event({ date: '2026-11-02' }), otherAllocation = event({ allocation: 'Team' });
  const windows = { today: [first, { ...first, sourceUrl: 'https://api.coinbell.in/token-unlocks?sort=value' }, otherAllocation], next7: [next], days8to30: [] };
  assert.deepEqual(view.coverage(windows), { tokenEntries: 1, events: 3, today: { tokenEntries: 1, events: 2 }, next7: { tokenEntries: 1, events: 1 }, days8to30: { tokenEntries: 0, events: 0 } });
});
test('same ticker never merges different calendar names, versions, networks or documented projects', () => {
  const rows = [event(), event({ name: 'Another TIA' }), event({ tokenVersion: 'v2' }), event({ network: 'other' }), event({ projectId: 'official-tia' })];
  assert.equal(view.groupEvents(rows).length, 5);
  assert.equal(view.coverage(feed(rows).windows).tokenEntries, 5);
});
test('value ranking displays the largest single event without summing or mutating amounts', () => {
  const rows = [event({ date: '2026-11-02', value: '$5K' }), event({ date: '2026-11-03', value: '$2M', amount: '5M TIA' }), event({ name: 'Another', symbol: 'A', value: '$1.5M' })];
  const original = JSON.stringify(rows), grouped = view.groupEvents(rows, 'value');
  assert.equal(grouped[0].representative.amount, '5M TIA');
  assert.equal(grouped[0].representative.value, '$2M');
  assert.equal(grouped[0].dateCount, 2);
  assert.equal(grouped[0].events[0].date, '2026-11-02');
  assert.equal(JSON.stringify(rows), original);
});
test('soonest and impact ranking choose their own representative; unknown metrics sort last', () => {
  const rows = [event({ value: '', percent: '' }), event({ date: '2026-11-04', value: '$1M', percent: '2%' }), event({ name: 'Other', symbol: 'OTH', value: '$0', percent: '1%' }), event({ name: 'Unknown', symbol: 'UNK', value: '', percent: '' })];
  assert.equal(view.groupEvents(rows, 'soonest')[0].representative.date, '2026-11-01');
  const groups = view.groupEvents(rows, 'impact');
  assert.equal(groups[0].representative.percent, '2%');
  assert.equal(groups.at(-1).representative.symbol, 'UNK');
  assert.equal(view.groupEvents(rows, 'value')[1].representative.symbol, 'OTH');
});
test('sorting handles published compact USD and percentages without treating missing or rounded zero as zero', () => {
  assert.equal(view.metric('$1,234.50K', 'value'), 1234500);
  assert.equal(view.metric('$0', 'value'), 0);
  assert.equal(view.metric('0,02%', 'percent'), 0.02);
  for (const value of ['', '—', '0.00%', 'approx 2%', '2M%', '2,1234%']) assert.equal(view.metric(value, 'percent'), null);
  for (const value of ['', '€1M', '$1.234,56', '$1e3', '$Infinity']) assert.equal(view.metric(value, 'value'), null);
});
test('search keeps all matching project events and does not inflate token counts', () => {
  const rows = [event(), event({ date: '2026-11-02' }), event({ name: 'Other', symbol: 'OTH' })];
  const groups = view.groupEvents(rows, 'soonest', 'CELESTIA');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].events.length, 2);
  assert.equal(view.groupEvents(rows, 'soonest', 'missing').length, 0);
});
test('repeated dates, daily-sounding allocations and unsupported schedule labels never imply linear vesting', () => {
  assert.equal(view.scheduleLabel(event({ allocation: 'Daily rewards', scheduleType: 'linear' })), 'Type not supplied');
  const proof = { kind: 'explicit-schedule-type', url: event().sourceUrl };
  assert.equal(view.scheduleLabel(event({ scheduleType: 'linear', evidence: [proof] })), 'Linear release');
  assert.equal(view.scheduleLabel(event({ scheduleType: 'linear', evidence: [{ ...proof, url: 'https://example.test' }] })), 'Type not supplied');
});
test('source links reject script schemes, lookalike hosts, credentials and unreviewed publishers', () => {
  for (const value of ['javascript:alert(1)', 'http://api.coinbell.in', 'https://api.coinbell.in.evil.test', 'https://defillama.com@evil.test', 'https://user:pass@defillama.com', 'https://defillama.com:8080', 'https://example.test']) assert.equal(view.sourceUrl(value), '');
  assert.equal(view.sourceUrl('https://defillama.com/unlocks/celestia'), 'https://defillama.com/unlocks/celestia');
});
test('coverage probe rejects failed HTTP and incomplete windows instead of reporting zero tokens', async () => {
  assert.throws(() => measure({ ok: true, live: true, windows: { today: [] } }), /UNAVAILABLE_OR_MALFORMED/);
  await assert.rejects(probe('https://example.test', async () => ({ ok: false, status: 503 })), /UNLOCK_HTTP_503/);
  let calls = 0;
  const measured = await probe('https://example.test', async url => { calls++; assert.equal(url.pathname, '/api/unlocks'); return { ok: true, json: async () => feed([event()]) }; });
  assert.equal(calls, 1);
  assert.equal(measured.counts.tokenEntries, 1);
  assert.equal(measured.evidence.projectConfirmed, 0);
  assert.equal(measured.evidence.scheduleTypeUnavailable, 1);
});

function browser(fetcher) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', value: '', dataset: { days: '1' }, addEventListener() {}, querySelectorAll() { return []; } });
    return elements.get(id);
  }
  const document = { getElementById: element, querySelector: selector => selector === '.tab.active' ? element('tab') : element(selector), querySelectorAll: () => [] };
  const context = vm.createContext({ fetch: fetcher, document, URL, AbortSignal, console, Intl, setTimeout });
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1].replace(/^loadUnlocks\(\);$/m, '');
  vm.runInContext(script, context);
  return { context, element };
}
test('classic calendar clears rows after outage and recovers without stale data', async () => {
  let healthy = true;
  const b = browser(async () => ({ ok: healthy, status: healthy ? 200 : 503, json: async () => feed([event()]) }));
  await b.context.loadUnlocks();
  assert.match(b.element('unlockRows').innerHTML, /100K TIA/);
  healthy = false;
  await b.context.loadUnlocks({ silent: true });
  assert.doesNotMatch(b.element('unlockRows').innerHTML, /100K TIA/);
  assert.match(b.element('unlockRows').innerHTML, /temporarily unavailable/);
  healthy = true;
  await b.context.loadUnlocks({ silent: true });
  assert.match(b.element('unlockRows').innerHTML, /100K TIA/);
});
test('malformed successful response is unavailable rather than an empty healthy calendar', async () => {
  const b = browser(async () => ({ ok: true, json: async () => ({ ok: true, live: true }) }));
  await b.context.loadUnlocks();
  assert.match(b.element('unlockRows').innerHTML, /temporarily unavailable/);
});
test('classic calendar renders without loading the audit-only presentation module', async () => {
  const b = browser(async () => ({ ok: true, json: async () => feed([event()]) }));
  assert.equal(typeof b.context.ARCYUnlockView, 'undefined');
  await b.context.loadUnlocks();
  assert.match(b.element('unlockRows').innerHTML, /100K TIA/);
});
test('classic pagination survives silent refresh and clamps after search; event markup is escaped', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => event({ name: 'Project ' + i, symbol: 'T' + i, amount: '1 T' + i }));
  rows.push(event({ name: 'Project 0', symbol: 'T0', date: '2026-11-02', amount: '<img src=x onerror=alert(1)>' }));
  const b = browser(async () => ({ ok: true, json: async () => feed(rows) }));
  await b.context.loadUnlocks();
  vm.runInContext('unlockPage=2', b.context);
  await b.context.loadUnlocks({ silent: true });
  assert.equal(b.element('unlockPage').textContent, '2 / 2');
  assert.match(b.element('unlockRows').innerHTML, /&lt;img/);
  assert.doesNotMatch(b.element('unlockRows').innerHTML, /<img src=x/);
  b.element('unlockSearch').value = 'Project 0';
  b.context.renderUnlocks(1);
  assert.equal(b.element('unlockPage').textContent, '1 / 1');
  assert.match(b.element('unlockRows').innerHTML, /1 T0/);
  assert.match(b.element('unlockRows').innerHTML, /&lt;img/);
});
