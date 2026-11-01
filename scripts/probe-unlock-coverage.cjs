'use strict';
// One read-only public API request. No provider purchase, scheduler or state mutation.
const view = require('../unlock-view');

function measure(body) {
  const counts = view.coverage(body?.windows);
  if (!body?.ok || !body.live || !counts) throw Error('UNLOCK_FEED_UNAVAILABLE_OR_MALFORMED');
  const events = view.uniqueEvents(Object.values(body.windows).flat());
  const identities = new Map();
  for (const event of events) {
    const key = view.tokenKey(event);
    if (!identities.has(key)) identities.set(key, { name: event.name, symbol: event.symbol, events: 0, dates: new Set() });
    const entry = identities.get(key);
    entry.events++;
    entry.dates.add(event.date);
  }
  return {
    ok: true, measuredAt: new Date().toISOString(), sourceCheckedAt: body.generatedAt || body.updatedAt || null,
    partial: !!body.partial, completeMarketCoverage: false,
    identityNote: 'Token entries are calendar identities, not independently verified contracts.',
    counts, reportedPublishers: body.coverage?.independentPublishers ?? null,
    sourceViews: (body.coverage?.sources || []).map(source => ({ status: source.status, rows: source.rowCount })),
    evidence: {
      projectConfirmed: events.filter(event => event.verification === 'project-confirmed').length,
      calendarReported: events.filter(event => event.verification === 'source-published').length,
      scheduleTypeUnavailable: events.filter(event => view.scheduleLabel(event) === 'Type not supplied').length,
      sourceLinkUnavailable: events.filter(event => !view.sourceUrl(event.sourceUrl)).length
    },
    quarantinedRecords: body.coverage?.quarantined?.length || 0,
    tokens: [...identities.values()].map(entry => ({ ...entry, dates: entry.dates.size }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.symbol.localeCompare(b.symbol))
  };
}
async function probe(base = 'https://www.arcyusdc.xyz', fetcher = fetch) {
  const url = new URL('/api/unlocks', base);
  const response = await fetcher(url, { headers: { accept: 'application/json', referer: url.origin + '/', 'sec-fetch-site': 'same-origin' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw Error('UNLOCK_HTTP_' + response.status);
  return measure(await response.json());
}
if (require.main === module) probe(process.env.ARCY_BASE).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
module.exports = { measure, probe };
