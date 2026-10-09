const { VERIFIED_EVENTS, COVERAGE_REVIEWS } = require('./unlock-evidence.cjs');

const SOURCE_URL = 'https://api.coinbell.in/token-unlocks?sort=soonest&window=30';
const SOURCE_URLS = ['soonest', 'impact', 'value'].map(sort => `https://api.coinbell.in/token-unlocks?sort=${sort}&window=30`);
const REFRESH_MS = 6 * 60 * 60 * 1000;

function stripTags(value = '') {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}

function isoDate(text = '') {
  const match = String(text).match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\b/i);
  if (!match) return null;
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const date = new Date(Date.UTC(Number(match[3]), months[match[2].toLowerCase()], Number(match[1])));
  return date.getUTCDate() === Number(match[1]) ? date.toISOString().slice(0, 10) : null;
}

function utcToday(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }
function dayDiff(date, today) { return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000); }
function nextRefresh(now = Date.now()) { return new Date(now + REFRESH_MS).toISOString(); }
async function request(fetcher, url, options = {}) { return fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }

function parseRows(html, sourceUrl = SOURCE_URL, now = Date.now()) {
  const result = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => stripTags(cell[1]));
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue;
    const date = isoDate(cells[2]), amount = cells[3] || '', symbolMatch = amount.match(/\s([A-Z0-9][A-Z0-9._-]{0,14})\s*$/);
    const symbol = symbolMatch?.[1] || '';
    if (!date || !symbol || !/^\d+(?:[.,]\d+)*(?:[KMB])?\s+[A-Z0-9._-]+$/.test(amount)) continue;
    let name = cells[1] || symbol;
    if (name.toUpperCase().endsWith(symbol)) name = name.slice(0, -symbol.length).trim() || symbol;
    result.push({ name, symbol, date, amount, percent: cells[5] || '', value: cells[4] || '', allocation: cells[6] || '', source: 'CoinBell / DefiLlama', sourceUrl, verification: 'source-published', evidence: [{ url: sourceUrl, kind: 'published-calendar', checkedAt: new Date(now).toISOString() }] });
  }
  return result;
}

function mergeEvents(rows) {
  const groups = new Map(), conflicts = [];
  for (const row of rows) {
    const review = COVERAGE_REVIEWS.find(item => item.symbols.includes(row.symbol));
    if (review && row.verification !== 'project-confirmed') continue;
    const key = JSON.stringify([row.name.toLowerCase().trim(), row.symbol, row.tokenVersion || 'calendar-unspecified', row.date, row.allocation.toLowerCase().trim()]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const events = [];
  for (const [key, group] of groups) {
    const amounts = new Set(group.map(row => row.amount.replace(/,/g, '').replace(/\s+/g, ' ').trim()));
    if (amounts.size !== 1) { conflicts.push({ identity: JSON.parse(key), reason: 'Conflicting published amounts', sources: [...new Set(group.map(row => row.sourceUrl))] }); continue; }
    const event = { ...group[0], evidence: group.flatMap(row => row.evidence || []) };
    if (new Set(group.map(row => row.percent)).size > 1) event.percent = '';
    events.push(event);
  }
  return { events, conflicts };
}

async function collectVerifiedEvents(records, fetcher, now) {
  const events = [], rejected = [];
  await Promise.all(records.map(async record => {
    try {
      const url = new URL(record.sourceUrl);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(record.date) && new Date(record.date + 'T00:00:00Z').toISOString().slice(0, 10) === record.date;
      if (url.protocol !== 'https:' || url.hostname !== record.allowedHost || !validDate || !record.projectId || !record.tokenVersion || !record.allocation || !record.name || !/^[A-Z0-9._-]+$/.test(record.symbol) || !/^\d+(?:\.\d+)?$/.test(record.amountTokens) || !/[1-9]/.test(record.amountTokens)) throw Error('INVALID_SUPPLEMENT');
      if (/\b(?:estimated|approximately|proposed|forecast|assume)\b/i.test(record.evidenceText || '') || !record.evidenceText?.includes(record.publishedDateText) || !record.evidenceText?.includes(record.publishedAmountText)) throw Error('INCOMPLETE_EVIDENCE');
      const reviewed = Date.parse(record.reviewedAt), expires = Date.parse(record.reviewExpiresAt);
      if (!Number.isFinite(reviewed) || !Number.isFinite(expires) || reviewed > now || expires <= now || expires - reviewed > 30 * 86400000) throw Error('EXPIRED_REVIEW');
      const response = await request(fetcher, record.sourceUrl);
      if (!response.ok || new URL(response.url || record.sourceUrl).hostname !== record.allowedHost || !stripTags(await response.text()).includes(stripTags(record.evidenceText))) throw Error('EVIDENCE_UNAVAILABLE');
      events.push({ name: record.name, symbol: record.symbol, projectId: record.projectId, tokenVersion: record.tokenVersion, date: record.date, amount: record.amountTokens + ' ' + record.symbol, percent: '', value: '', allocation: record.allocation, source: record.name + ' official schedule', sourceUrl: record.sourceUrl, verification: 'project-confirmed', evidence: [{ url: record.sourceUrl, kind: 'explicit-event', checkedAt: new Date(now).toISOString(), reviewedAt: record.reviewedAt }] });
    } catch { rejected.push({ projectId: record.projectId || 'unknown', status: 'evidence-unavailable-or-invalid' }); }
  }));
  return { events, rejected };
}

async function fetchLogos(events, fetcher) {
  const symbols = [...new Set(events.map(event => event.symbol).filter(Boolean))];
  if (!symbols.length) return {};
  const key = process.env.CMC_API_KEY, query = new URLSearchParams({ symbol: symbols.join(','), aux: 'logo', skip_invalid: 'true' });
  try {
    const response = await request(fetcher, `https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?${query}`, { headers: { accept: 'application/json', ...(key ? { 'X-CMC_PRO_API_KEY': key } : {}) } });
    if (!response.ok) return {};
    const data = await response.json(), logos = {};
    for (const symbol of symbols) {
      const raw = data?.data?.[symbol], candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const names = events.filter(event => event.symbol === symbol).map(event => String(event.name || '').toLowerCase());
      const chosen = candidates.find(item => names.includes(String(item.name || '').toLowerCase())) || (candidates.length === 1 ? candidates[0] : null);
      if (chosen?.logo && /^https:\/\//i.test(chosen.logo)) logos[symbol] = chosen.logo;
    }
    return logos;
  } catch { return {}; }
}

async function generate({ now = Date.now(), fetcher = fetch, trigger = 'worker' } = {}) {
  const collected = await Promise.all(SOURCE_URLS.map(async url => {
    try {
      const response = await request(fetcher, url, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'ARCY-Unlocks/2.0 (+https://arcyusdc.xyz)' } });
      if (!response.ok) throw Error('SOURCE_HTTP_' + response.status);
      const rows = parseRows(await response.text(), url, now);
      if (!rows.length) throw Error('SOURCE_EMPTY');
      return { url, status: 'available', rows };
    } catch { return { url, status: 'unavailable', rows: [] }; }
  }));
  const supplemental = await collectVerifiedEvents(VERIFIED_EVENTS, fetcher, now);
  if (!collected.some(source => source.status === 'available') && !supplemental.events.length) throw Object.assign(Error('UNLOCK_DISCOVERY_UNAVAILABLE'), { code: 'UNLOCK_DISCOVERY_UNAVAILABLE' });
  const today = utcToday(now), merged = mergeEvents([...collected.flatMap(source => source.rows), ...supplemental.events]);
  const events = merged.events.map(event => ({ ...event, daysFromToday: dayDiff(event.date, today) })).filter(event => event.daysFromToday >= 0 && event.daysFromToday <= 30).sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name) || left.allocation.localeCompare(right.allocation));
  const logos = await fetchLogos(events, fetcher), enriched = events.map(event => ({ ...event, logo: logos[event.symbol] || '' }));
  const partial = collected.some(source => source.status !== 'available') || supplemental.rejected.length > 0 || merged.conflicts.length > 0;
  return { schemaVersion: 1, success: true, trigger, generatedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), refreshAt: nextRefresh(now), live: true, source: 'CoinBell published calendar (DefiLlama attribution); project-confirmed supplements when available', sourceUrl: SOURCE_URL, partial, coverage: { complete: false, sources: collected.map(({ url, status, rows }) => ({ url, status, rowCount: rows.length })), reviews: COVERAGE_REVIEWS, conflicts: merged.conflicts, rejectedSupplements: supplemental.rejected }, windowTimeZone: 'UTC', windows: { today: enriched.filter(event => event.daysFromToday === 0), next7: enriched.filter(event => event.daysFromToday >= 1 && event.daysFromToday <= 7), days8to30: enriched.filter(event => event.daysFromToday >= 8 && event.daysFromToday <= 30) }, events: enriched };
}

module.exports = { SOURCE_URL, SOURCE_URLS, REFRESH_MS, parseRows, mergeEvents, generate, nextRefresh };
